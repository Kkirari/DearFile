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
import { searchChunks, getUserProfile, type CaptureSearchHit } from "./db";
import { embedOne, embeddingsEnabled } from "./embeddings";

export type AskScope =
  | { kind: "user"; userId: string }
  | { kind: "workspace"; workspaceId: string };

/**
 * A cited source in an answer: an S3 file, or a captured note/link (Phase 8).
 * The webhook turns each into a tappable bubble row (file → ?file= deep link,
 * link → its source URL, note → the Timeline tab).
 */
export type AskCitation =
  | { kind: "file"; entry: IndexEntry }
  | { kind: "capture"; id: string; itemType: "note" | "link"; title: string; sourceUrl: string | null };

export interface AskResult {
  answer: string;
  citations: AskCitation[];
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
  "You are DearFile (น้องกวาง), a friendly assistant that helps a user find things in their own second brain:",
  "their saved FILES (photos, docs, PDFs) and their saved NOTES & LINKS (incl. summarized YouTube/articles).",
  "",
  "RULES:",
  "- ALWAYS call `search` first for EVERY request — even a single word or a vague one. NEVER ask the user for clarification before searching.",
  "- `search` returns both matching files AND notes/links; use whichever answers the question (e.g. \"that clip about X\" is usually a saved link).",
  "- Search with the key nouns/keywords from the question (in the user's language). If the first search finds nothing, try again with different or simpler keywords before concluding nothing exists.",
  "- Use `get_file_detail` only if you need a file's full metadata after searching.",
  "- Answer ONLY from what the tools return. Never invent files, notes, links, dates, or details.",
  "- Reply in the SAME language as the user's question (Thai or English). Keep it short and chat-sized.",
  "- When you found something, briefly say what it is. The app shows tappable links separately, so you don't need to print URLs or keys.",
  "- If searches genuinely return nothing, say so plainly and suggest the user send that file/note/link to DearFile to save it.",
  "- Do not answer general/off-topic questions; you only help with the user's own saved content.",
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
 * Semantic search over the user's captured notes/links (Phase 8). Embeds the
 * query (Voyage) and cosine-searches the pgvector chunks. Best-effort: returns
 * [] when embeddings aren't configured or on any error, so Ask still answers
 * over files. Captures are personal, so this is user-scope only.
 */
async function searchCaptures(userId: string, query: string, limit: number): Promise<CaptureSearchHit[]> {
  if (!embeddingsEnabled()) return [];
  try {
    const vec = await embedOne(query, "query");
    return await searchChunks(userId, vec, limit);
  } catch (err) {
    console.warn("[ask] capture search skipped:", err);
    return [];
  }
}

/** Did the model actually name this source in its answer? (ranks citations) */
function isMentioned(c: AskCitation, answerLower: string): boolean {
  if (c.kind === "file") {
    return (!!c.entry.filename && answerLower.includes(c.entry.filename.toLowerCase()))
        || (!!c.entry.subject && answerLower.includes(c.entry.subject.toLowerCase()));
  }
  return !!c.title && answerLower.includes(c.title.toLowerCase());
}

/**
 * Run the agentic retrieval loop and return the answer plus up to 3 citations.
 * Throws on a generation/Gateway error — the caller decides the fallback.
 */
export async function askDearFile(scope: AskScope, question: string): Promise<AskResult> {
  // key → { citation, score }. Tools fill this as they surface files/captures;
  // we rank it into the final citation list after generation. Keeping the max
  // score lets a stronger hit win over an incidental get_file_detail lookup.
  const citationMap = new Map<string, { citation: AskCitation; score: number }>();

  function recordFile(entry: IndexEntry, score: number) {
    const prev = citationMap.get(entry.key);
    if (!prev || score > prev.score) {
      citationMap.set(entry.key, { citation: { kind: "file", entry }, score });
    }
  }

  function recordCapture(hit: CaptureSearchHit, score: number) {
    const key = `cap:${hit.id}`;
    const prev = citationMap.get(key);
    if (!prev || score > prev.score) {
      const title = hit.title?.trim() || (hit.type === "link" ? hit.sourceUrl ?? "Link" : "Note");
      citationMap.set(key, {
        citation: { kind: "capture", id: hit.id, itemType: hit.type, title, sourceUrl: hit.sourceUrl },
        score,
      });
    }
  }

  const search = tool({
    description:
      "Search the user's saved FILES (by keyword) and their NOTES & LINKS (by meaning). Returns the most relevant items to answer the question.",
    inputSchema: z.object({
      query: z.string().describe("Keywords or a short phrase, in the user's language."),
      filter: z
        .enum(FILTERS)
        .optional()
        .describe("Restrict FILES to a category. Default 'all'."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(SEARCH_LIMIT_MAX)
        .optional()
        .describe(`Max results per source (default ${SEARCH_LIMIT_DEFAULT}).`),
    }),
    execute: async ({ query, filter, limit }) => {
      const n = limit ?? SEARCH_LIMIT_DEFAULT;
      const [fileResults, noteResults] = await Promise.all([
        runSearch(scope, query, (filter ?? "all") as FilterMode),
        scope.kind === "user"
          ? searchCaptures(scope.userId, query, n)
          : Promise.resolve([] as CaptureSearchHit[]),
      ]);
      const files = fileResults.slice(0, n);
      for (const r of files) recordFile(r, r.score);
      for (const h of noteResults) recordCapture(h, h.score);
      return {
        files: files.map((e) => ({
          key:      e.key,
          filename: e.filename,
          subject:  e.subject,
          detail:   truncate(e.detail, DETAIL_TRUNCATE),
          date:     e.date,
          folder:   folderName(e),
        })),
        notes: noteResults.map((h) => ({
          type:    h.type,
          title:   h.title,
          summary: truncate(h.summary ?? "", DETAIL_TRUNCATE),
          url:     h.sourceUrl,
        })),
      };
    },
  });

  const get_file_detail = tool({
    description:
      "Get the full saved metadata for one file by its key (from a search result).",
    inputSchema: z.object({
      key: z.string().describe("The file key returned by search."),
    }),
    execute: async ({ key }) => {
      const all = await loadAll(scope);
      const entry = all.find((e) => e.key === key);
      if (!entry) return { found: false as const };
      recordFile(entry, citationMap.get(key)?.score ?? 0);
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

  // Personalize with the user's interest profile (best-effort, user scope only).
  let system = SYSTEM_PROMPT;
  if (scope.kind === "user") {
    try {
      const profile = await getUserProfile(scope.userId);
      if (profile && (profile.interests.length || profile.about)) {
        system +=
          `\n\nAbout this user (for tailoring suggestions, not for inventing answers):` +
          (profile.interests.length ? `\n- interests: ${profile.interests.join(", ")}` : "") +
          (profile.about ? `\n- ${profile.about}` : "");
      }
    } catch { /* no profile → answer as usual */ }
  }

  const result = await generateText({
    model:           resolveModel(process.env.ASK_MODEL_ID ?? DEFAULT_MODEL),
    system,
    prompt:          question,
    tools:           { search, get_file_detail },
    stopWhen:        stepCountIs(4),
    maxOutputTokens: 700,
    // Haiku is reluctant to call tools for terse/vague inputs and will chat
    // instead. Force a search on the first step so EVERY question is grounded
    // in the user's content; later steps go back to auto (answer or refine).
    prepareStep: async ({ stepNumber }) =>
      stepNumber === 0
        ? { toolChoice: { type: "tool", toolName: "search" }, activeTools: ["search"] }
        : {},
  });

  const answer = result.text.trim();

  // Rank citations: sources the model actually named come first, then by score.
  // Cap at MAX_CITATIONS (mixed files + captures).
  const answerLower = answer.toLowerCase();
  const citations = [...citationMap.values()]
    .sort((a, b) => {
      const am = isMentioned(a.citation, answerLower) ? 1 : 0;
      const bm = isMentioned(b.citation, answerLower) ? 1 : 0;
      if (am !== bm) return bm - am;
      return b.score - a.score;
    })
    .slice(0, MAX_CITATIONS)
    .map((c) => c.citation);

  return {
    answer:
      answer ||
      "ขออภัย ฉันยังตอบไม่ได้ในตอนนี้ / Sorry, I couldn't answer that right now.",
    citations,
  };
}
