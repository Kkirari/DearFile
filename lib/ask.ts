/**
 * "Ask DearFile" — agentic, tool-using retrieval over a user's (DM) or a
 * workspace's (group) file index. The model searches the index, optionally
 * reads a file's full metadata, then answers in the user's language with
 * tappable citations that deep-link back into the LIFF app.
 *
 * Routed through the **Vercel AI Gateway**: the model is a plain
 * `anthropic/claude-*` string, resolved by the AI SDK's default gateway
 * provider (auth via AI_GATEWAY_API_KEY locally / Vercel OIDC in prod). This
 * keeps Ask BYOK-ready and multi-model without a provider package.
 *
 * Env:
 *   ASK_MODEL_ID  — override the default model (e.g. anthropic/claude-sonnet-4-6)
 */

import { generateText, tool, stepCountIs, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import {
  searchScored,
  searchWorkspaceScored,
  getAllEntries,
  getAllWorkspaceEntries,
  type IndexEntry,
  type ScoredEntry,
  type FilterMode,
} from "./search-index";
import { getAiFolder } from "./ai-folders";

export type AskScope =
  | { kind: "user"; userId: string }
  | { kind: "workspace"; workspaceId: string };

export interface AskResult {
  answer: string;
  citations: IndexEntry[];
}

const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";
const SEARCH_LIMIT_DEFAULT = 6;
const SEARCH_LIMIT_MAX = 10;
const MAX_CITATIONS = 3;
const DETAIL_TRUNCATE = 160;

const FILTERS = ["all", "photos", "documents", "finance", "academic"] as const;

// FilterMode → analyzer category, for the reverse-contains pass below.
const FILTER_CATEGORY: Record<Exclude<FilterMode, "all">, string> = {
  photos:    "photo",
  documents: "document",
  finance:   "finance",
  academic:  "academic",
};

const SYSTEM_PROMPT = [
  "You are DearFile (น้องกวาง), a friendly assistant that helps a user find their own saved files.",
  "",
  "RULES:",
  "- ALWAYS call `search_files` first for EVERY request — even a single word or a vague one. NEVER ask the user for clarification before searching.",
  "- Search with the key nouns/keywords from the question (in the user's language). If the first search finds nothing, try again with different or simpler keywords before concluding nothing exists.",
  "- Use `get_file_detail` only if you need a file's full metadata after searching.",
  "- Answer ONLY from the files the tools return. Never invent files, filenames, dates, or details.",
  "- Reply in the SAME language as the user's question (Thai or English). Keep it short and chat-sized.",
  "- When you found matching files, briefly say what you found (e.g. which file, when). The app shows tappable file links separately, so you don't need to print URLs or keys.",
  "- If searches genuinely return nothing, say so plainly and suggest the user send that file to DearFile to save it.",
  "- Do not answer general/off-topic questions; you only help with the user's files.",
].join("\n");

/**
 * Resolve a model id into a model the AI SDK can run. By default the
 * `anthropic/claude-*` string routes through the Vercel AI Gateway (the
 * confirmed architecture). Setting `ASK_DIRECT_ANTHROPIC=1` bypasses the Gateway
 * and calls Anthropic directly via ANTHROPIC_API_KEY — a billing-free escape
 * hatch for local testing before a Gateway card is on file. To go back to the
 * Gateway, just unset that env var (no code change). Shared by the Ask engine
 * and the intent classifier.
 */
export function resolveModel(modelId: string): LanguageModel {
  if (process.env.ASK_DIRECT_ANTHROPIC === "1") {
    return anthropic(modelId.replace(/^anthropic\//, ""));
  }
  return modelId;
}

function folderName(entry: IndexEntry): string {
  return getAiFolder(entry.ai_folder_id)?.name ?? "📥 Inbox";
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function searchOne(scope: AskScope, query: string, filter: FilterMode): Promise<ScoredEntry[]> {
  return scope.kind === "user"
    ? searchScored(scope.userId, query, { filter })
    : searchWorkspaceScored(scope.workspaceId, query, { filter });
}

/**
 * The shared index scorer only matches when a FIELD contains the QUERY, and it
 * treats the query as one token. That fails for natural questions in two ways:
 *   1. multi-word English ("movie posters") never matches the per-word keywords;
 *   2. Thai has no word spaces, so a phrase ("การจัดการไฟล์") can't be split and
 *      is always longer than any keyword, so field-contains-query never fires.
 *
 * So we widen recall in the tool (leaving the LIFF search box untouched):
 *   - run the full query AND each whitespace term through the scorer, and
 *   - add a reverse-contains pass — match entries whose subject/keyword appears
 *     INSIDE the query (catches Thai phrases and long natural questions).
 * Results merge by best score.
 */
async function runSearch(
  scope: AskScope,
  query: string,
  filter: FilterMode,
): Promise<ScoredEntry[]> {
  const merged = new Map<string, ScoredEntry>();
  const bump = (key: string, score: number, make: () => ScoredEntry) => {
    const prev = merged.get(key);
    if (!prev) merged.set(key, make());
    else if (score > prev.score) prev.score = score;
  };

  const terms = [...new Set([query, ...query.split(/\s+/)])]
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  for (const term of terms) {
    for (const r of await searchOne(scope, term, filter)) {
      bump(r.key, r.score, () => r);
    }
  }

  // Reverse-contains: does the query mention a file's subject/keyword?
  const qLower = query.toLowerCase();
  const cat = filter === "all" ? null : FILTER_CATEGORY[filter];
  for (const e of await loadAll(scope)) {
    if (cat && e.category !== cat) continue;
    let s = 0;
    const subj = e.subject?.toLowerCase() ?? "";
    if (subj.length >= 3 && qLower.includes(subj)) s = 0.8;
    if (s < 0.6) {
      for (const kw of e.keywords) {
        const k = kw.toLowerCase();
        if (k.length >= 3 && qLower.includes(k)) { s = Math.max(s, 0.6); break; }
      }
    }
    if (s > 0) bump(e.key, s, () => ({ ...e, score: s, matchedIn: ["query-contains"] }));
  }

  return [...merged.values()].sort((a, b) => b.score - a.score);
}

async function loadAll(scope: AskScope): Promise<IndexEntry[]> {
  return scope.kind === "user"
    ? getAllEntries(scope.userId)
    : getAllWorkspaceEntries(scope.workspaceId);
}

/**
 * Run the agentic retrieval loop and return the answer plus up to 3 citations.
 * Throws on a generation/Gateway error — the caller decides the fallback.
 */
export async function askDearFile(scope: AskScope, question: string): Promise<AskResult> {
  // key → { entry, score }. Tools fill this as they surface files; we rank it
  // into the final citation list after generation. Keeping the max score lets
  // a stronger search hit win over an incidental get_file_detail lookup.
  const citationMap = new Map<string, { entry: IndexEntry; score: number }>();

  function record(entry: IndexEntry, score: number) {
    const prev = citationMap.get(entry.key);
    if (!prev || score > prev.score) citationMap.set(entry.key, { entry, score });
  }

  const search_files = tool({
    description:
      "Search the user's saved files by Thai/English keywords. Returns the most relevant files with filename, subject, detail and date.",
    inputSchema: z.object({
      query: z.string().describe("Keywords to search for, in the user's language."),
      filter: z
        .enum(FILTERS)
        .optional()
        .describe("Restrict to a category. Default 'all'."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(SEARCH_LIMIT_MAX)
        .optional()
        .describe(`Max results (default ${SEARCH_LIMIT_DEFAULT}).`),
    }),
    execute: async ({ query, filter, limit }) => {
      const results = await runSearch(scope, query, (filter ?? "all") as FilterMode);
      const top = results.slice(0, limit ?? SEARCH_LIMIT_DEFAULT);
      for (const r of top) record(r, r.score);
      return {
        count: top.length,
        files: top.map((e) => ({
          key:      e.key,
          filename: e.filename,
          subject:  e.subject,
          detail:   truncate(e.detail, DETAIL_TRUNCATE),
          date:     e.date,
          folder:   folderName(e),
        })),
      };
    },
  });

  const get_file_detail = tool({
    description:
      "Get the full saved metadata for one file by its key (from search_files results).",
    inputSchema: z.object({
      key: z.string().describe("The file key returned by search_files."),
    }),
    execute: async ({ key }) => {
      const all = await loadAll(scope);
      const entry = all.find((e) => e.key === key);
      if (!entry) return { found: false as const };
      record(entry, citationMap.get(key)?.score ?? 0);
      return {
        found:    true as const,
        filename: entry.filename,
        subject:  entry.subject,
        detail:   entry.detail,
        date:     entry.date,
        keywords: entry.keywords,
        folder:   folderName(entry),
      };
    },
  });

  const result = await generateText({
    model:           resolveModel(process.env.ASK_MODEL_ID ?? DEFAULT_MODEL),
    system:          SYSTEM_PROMPT,
    prompt:          question,
    tools:           { search_files, get_file_detail },
    stopWhen:        stepCountIs(4),
    maxOutputTokens: 700,
    // Haiku is reluctant to call tools for terse/vague inputs and will chat
    // instead. Force a search on the first step so EVERY question is grounded
    // in the file index; later steps go back to auto (answer or refine).
    prepareStep: async ({ stepNumber }) =>
      stepNumber === 0
        ? { toolChoice: { type: "tool", toolName: "search_files" }, activeTools: ["search_files"] }
        : {},
  });

  const answer = result.text.trim();

  // Rank citations: files whose filename/subject the model actually mentioned
  // come first, then by search score. Cap at MAX_CITATIONS.
  const answerLower = answer.toLowerCase();
  const mentioned = (e: IndexEntry) =>
    (e.filename && answerLower.includes(e.filename.toLowerCase())) ||
    (e.subject && answerLower.includes(e.subject.toLowerCase()));

  const citations = [...citationMap.values()]
    .sort((a, b) => {
      const am = mentioned(a.entry) ? 1 : 0;
      const bm = mentioned(b.entry) ? 1 : 0;
      if (am !== bm) return bm - am;
      return b.score - a.score;
    })
    .slice(0, MAX_CITATIONS)
    .map((c) => c.entry);

  return {
    answer:
      answer ||
      "ขออภัย ฉันยังตอบไม่ได้ในตอนนี้ / Sorry, I couldn't answer that right now.",
    citations,
  };
}
