/**
 * Capture engine — Phase 7. Two stages, decoupled so the LINE webhook can ack
 * instantly and the heavy work runs in the background (see the webhook's
 * `after()` and the reconciliation cron):
 *
 *   ingestLink / ingestNote  → insert a `pending` row, return its id (no model)
 *   processCapture(id)       → extract → summarize+classify → embed → `ready`
 *
 * Summarization routes through the same model resolver as Ask (Gateway by
 * default, ASK_DIRECT_ANTHROPIC for local). YouTube uses transcript text
 * (lib/youtube.ts) — never Gemini video ingestion. A model hiccup degrades to a
 * template summary so a capture is never lost.
 *
 * Env: CAPTURE_MODEL_ID (default anthropic/claude-haiku-4-5).
 */

import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel } from "./ask";
import { getUserKeys } from "./byok";
import {
  insertPendingItem,
  claimForProcessing,
  markReady,
  markFailed,
  getItem,
  insertChunk,
  listDueItemIds,
  type ContentItem,
} from "./db";
import { embedOne, embeddingsEnabled } from "./embeddings";
import { isYouTubeUrl, fetchYouTubeContent } from "./youtube";

const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";
const MAX_ANALYZE_CHARS = 24_000; // cap model input (cost) — plenty for the main idea
const WEB_BODY_CHARS = 6_000;

type Style = "video" | "article" | "note";

interface Analysis {
  summary: string;
  category: string | null;
  tags: string[];
  lang: string | null;
}

// ── Ingest (fast, synchronous) ──────────────────────────────────────────────

export function ingestLink(userId: string, url: string): Promise<string> {
  return insertPendingItem({ userId, type: "link", sourceUrl: url, rawText: url });
}

export function ingestNote(userId: string, text: string): Promise<string> {
  return insertPendingItem({ userId, type: "note", rawText: text });
}

// ── Web (non-YouTube link) extraction — light, fetch-only ───────────────────

function metaContent(html: string, key: string, attr: "property" | "name"): string | null {
  const re = new RegExp(`<meta\\s+${attr}=["']${key}["']\\s+content=["']([^"']+)["']`, "i");
  return html.match(re)?.[1] ?? null;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWebContent(url: string): Promise<{ title: string | null; text: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DearFileBot/1.0)" },
    });
    if (!res.ok) return { title: null, text: url };
    const html = await res.text();
    const title =
      metaContent(html, "og:title", "property") ??
      html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ??
      null;
    const description =
      metaContent(html, "og:description", "property") ??
      metaContent(html, "description", "name") ??
      "";
    const body = stripTags(html).slice(0, WEB_BODY_CHARS);
    const text = [title, description, body].filter(Boolean).join("\n").trim();
    return { title, text: text || url };
  } catch {
    return { title: null, text: url };
  }
}

// ── Summarize + classify ────────────────────────────────────────────────────

const AnalysisSchema = z.object({
  summary: z.string().describe("A structured Thai summary using the 📌 สรุป / 💡 ข้อมูลสำคัญ / ✨ เคล็ดลับเพิ่มเติม (จาก DearFile) / 🎯 เอาไปใช้ sections — or, for a short note, a cleaned 1–2 sentences plus one 🎯 tip."),
  category: z.string().describe("One short category, e.g. article, video, tech, finance, study, news."),
  // No hard .max() — Haiku sometimes returns more, which would fail schema
  // validation and drop the whole (good) summary. We clamp in code instead.
  tags: z.array(z.string()).describe("Up to 8 short topical tags."),
  lang: z.string().describe('BCP-47-ish language code of the SOURCE content, e.g. "th" or "en".'),
});

function systemFor(style: Style): string {
  const base = [
    "You are DearFile (น้องกวาง), a helpful second-brain assistant. The user saved this to come back to later — help them get real value from it.",
    "ALWAYS write in Thai (ภาษาไทย), even if the source is in another language — render the key points in natural Thai.",
    "Never output a person's, pet's, or individual's name.",
    "Plain text only: no markdown headings (#), no raw URLs. Use the emoji section labels and '• ' bullets exactly as told.",
  ];

  // A user's own short note: keep it light — don't over-explain a reminder.
  if (style === "note") {
    base.push(
      "This is the user's own note. Clean it into 1–2 clear Thai sentences (keep their intent),",
      "then on a new line add '🎯 ' with ONE short practical suggestion for acting on it. No other sections.",
    );
    return base.join("\n");
  }

  base.push(
    style === "video"
      ? "This is a YouTube transcript; it may have messy/auto-generated typos — ignore the spelling and extract the real meaning."
      : "This is a web page / article.",
    "Write the summary in EXACTLY these four sections, in this order, each starting on its own line:",
    "📌 สรุป",
    "  • 3–5 bullets — the main context / key steps. Faithful to the SOURCE only.",
    "💡 ข้อมูลสำคัญ",
    "  • 1–3 bullets — the most important things to know or remember from it.",
    "✨ เคล็ดลับเพิ่มเติม (จาก DearFile)",
    "  • 1–3 bullets of YOUR OWN useful tips or background knowledge that are NOT in the source but help with this topic. This section is explicitly your addition — using general knowledge here is fine; keep it accurate and practical.",
    "🎯 เอาไปใช้",
    "  • 1–2 bullets — infer what the user likely wants this for and how to apply it.",
    "Keep bullets concise. If the source lacks material for a section, write a brief best-effort line rather than inventing facts about the source.",
  );
  return base.join("\n");
}

async function analyze(
  content: string,
  style: Style,
  opts?: { anthropicApiKey?: string },
): Promise<Analysis> {
  try {
    const { object } = await generateObject({
      model:           resolveModel(process.env.CAPTURE_MODEL_ID ?? DEFAULT_MODEL, { anthropicApiKey: opts?.anthropicApiKey }),
      system:          systemFor(style),
      prompt:          content.slice(0, MAX_ANALYZE_CHARS),
      schema:          AnalysisSchema,
      // Thai is far more token-heavy than English; the 4-section structured Thai
      // summary needs generous room or generateObject truncates the JSON and throws.
      maxOutputTokens: 2000,
    });
    return {
      summary:  object.summary.trim(),
      category: object.category?.trim() || null,
      tags:     (object.tags ?? []).slice(0, 8),
      lang:     object.lang?.trim() || null,
    };
  } catch (err) {
    // Never lose a capture to a model hiccup — degrade to a raw excerpt.
    console.warn("[capture] analyze failed, using template summary:", err);
    return {
      summary:  content.slice(0, 280).trim() || "(no preview available)",
      category: style === "video" ? "video" : style === "note" ? "note" : "link",
      tags:     [],
      lang:     null,
    };
  }
}

function deriveTitle(item: ContentItem, fetchedTitle: string | null): string {
  if (fetchedTitle) return fetchedTitle.slice(0, 200);
  if (item.type === "note") {
    const firstLine = item.rawText.split("\n")[0]?.trim() ?? "";
    return (firstLine || "Note").slice(0, 80);
  }
  try {
    return new URL(item.sourceUrl ?? "").hostname.replace(/^www\./, "");
  } catch {
    return "Link";
  }
}

// ── Process (deferred) ──────────────────────────────────────────────────────

/**
 * Run extraction → summarize/classify → embed for one capture and flip it to
 * `ready`. Idempotent: only claims `pending`/`failed` rows; a row already taken
 * or done is returned as-is. Returns the final item (or null if it vanished).
 */
export async function processCapture(id: string): Promise<ContentItem | null> {
  const claimed = await claimForProcessing(id);
  if (!claimed) return getItem(id); // someone else has it, or it's already ready

  try {
    let style: Style;
    let baseText: string;
    let fetchedTitle: string | null = claimed.title;
    let note: string | undefined;

    if (claimed.type === "link") {
      const url = claimed.sourceUrl ?? claimed.rawText;
      if (isYouTubeUrl(url)) {
        const yt = await fetchYouTubeContent(url);
        fetchedTitle = yt.title ?? fetchedTitle;
        baseText = yt.text;
        note = yt.note;
        style = "video";
      } else {
        const web = await fetchWebContent(url);
        fetchedTitle = web.title ?? fetchedTitle;
        baseText = web.text;
        style = "article";
      }
    } else {
      baseText = claimed.rawText;
      style = "note";
    }

    const userKeys = await getUserKeys(claimed.userId);
    const analysis = await analyze(baseText, style, { anthropicApiKey: userKeys.anthropic });
    const summary = note ? `${note}\n\n${analysis.summary}` : analysis.summary;
    const title = deriveTitle(claimed, fetchedTitle);

    const ready = await markReady(id, {
      title,
      summary,
      category: analysis.category,
      tags:     analysis.tags,
      lang:     analysis.lang,
    });

    // Embedding is best-effort — a capture stays usable even before Voyage is set
    // up or if it errors; a later reprocess can backfill the chunk.
    try {
      if (embeddingsEnabled({ apiKey: userKeys.voyage })) {
        const vec = await embedOne([title, summary].filter(Boolean).join("\n"), "document", { apiKey: userKeys.voyage });
        await insertChunk({ contentItemId: id, content: summary, embedding: vec });
      }
    } catch (embedErr) {
      console.warn("[capture] embedding skipped:", embedErr);
    }

    return ready ?? getItem(id);
  } catch (err) {
    // Only unexpected (e.g. DB) errors land here — mark failed so the cron retries.
    console.error("[capture] processing failed:", err);
    await markFailed(id, err instanceof Error ? err.message : String(err)).catch(() => undefined);
    return getItem(id);
  }
}

const DRAIN_CONCURRENCY = 3;

/**
 * Process all captures that still need work (pending / retryable failed / stuck
 * processing). The webhook's `after()` covers the happy path; this is the
 * durable safety net, called by the reconciliation cron and by the daily-summary
 * cron before the 20:00 recap.
 */
export async function drainCaptures(
  limit = 25,
): Promise<{ processed: number; ready: number; failed: number }> {
  const ids = await listDueItemIds(limit);
  let ready = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += DRAIN_CONCURRENCY) {
    const chunk = ids.slice(i, i + DRAIN_CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((id) => processCapture(id)));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value?.status === "ready") ready++;
      else failed++;
    }
  }
  return { processed: ids.length, ready, failed };
}
