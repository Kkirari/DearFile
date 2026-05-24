/**
 * Daily summary — Phase 6 of the "LINE-native Second Brain" vision: an
 * end-of-day brief of the files a user captured *today* (their ICT calendar
 * day), delivered via the LINE OA.
 *
 * Two entry points share this engine:
 *   - the daily cron (app/api/cron/daily-summary) — pushes to every active user
 *   - the DM "/summary" command (webhook) — replies on demand
 *
 * Scope is the user's personal index (the vision's personal brief). The engine
 * is intentionally small and scope-shaped so a workspace variant can be added
 * later without reshaping callers.
 *
 * AI synthesis routes through the same model resolver as Ask — the Vercel AI
 * Gateway by default, or a direct Anthropic call when ASK_DIRECT_ANTHROPIC=1
 * (a billing-free escape hatch for local testing). Default model is Haiku for
 * cost; set SUMMARY_MODEL_ID to upgrade (e.g. anthropic/claude-sonnet-4-6, the
 * vision's "Sonnet for quality"). A template fallback covers any model error so
 * a brief always goes out.
 *
 * Env:
 *   SUMMARY_MODEL_ID  — override the synthesis model (default Haiku 4.5)
 */

import { generateText } from "ai";
import { getAllEntries, type IndexEntry } from "./search-index";
import { getAiFolder } from "./ai-folders";
import { resolveModel } from "./ask";
import { listReadyItemsBetween, type ContentItem } from "./db";

const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";
const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;   // Thailand is UTC+7, no DST
const MAX_HIGHLIGHTS = 3;                    // tappable file rows in the bubble
const MAX_FILES_TO_MODEL = 40;              // cap prompt size on heavy days

export interface DailySummary {
  /** ICT calendar date the brief covers, YYYY-MM-DD. */
  date: string;
  /** Number of files captured in the window. */
  count: number;
  /** Synthesized brief (Thai-first, with a short English line). */
  text: string;
  /** Up to MAX_HIGHLIGHTS notable files to show as tappable citations. */
  highlights: IndexEntry[];
  /** Every file in the window (newest first). */
  captures: IndexEntry[];
}

// ── Time window (ICT calendar day) ─────────────────────────────────────────

/** Start of *today* in ICT, returned as epoch ms (UTC). */
export function ictDayStartMs(nowMs = Date.now()): number {
  const ict = new Date(nowMs + ICT_OFFSET_MS);
  const midnightUtc = Date.UTC(ict.getUTCFullYear(), ict.getUTCMonth(), ict.getUTCDate());
  return midnightUtc - ICT_OFFSET_MS;
}

/** Current ICT calendar date as YYYY-MM-DD (used for labels + dedupe markers). */
export function ictDateLabel(nowMs = Date.now()): string {
  return new Date(nowMs + ICT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Start of a given ICT date (YYYY-MM-DD) as epoch ms (UTC). */
export function ictDayStartMsForDate(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1) - ICT_OFFSET_MS;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Capture collection + breakdown ─────────────────────────────────────────

function folderName(e: IndexEntry): string {
  return getAiFolder(e.ai_folder_id)?.name ?? "📥 Inbox";
}

/** Files whose createdAt falls within [startMs, endMs), newest first. */
function capturesInWindow(entries: IndexEntry[], startMs: number, endMs: number): IndexEntry[] {
  return entries
    .filter((e) => {
      const t = Date.parse(e.createdAt);
      return Number.isFinite(t) && t >= startMs && t < endMs;
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function categoryBreakdown(captures: IndexEntry[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const e of captures) counts.set(folderName(e), (counts.get(folderName(e)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// ── AI synthesis ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You are DearFile (น้องกวาง), a warm personal assistant writing a short end-of-day brief",
  "about the files the user saved today.",
  "",
  "RULES:",
  "- Write a friendly, encouraging recap of 2–3 short sentences.",
  "- Mention the main themes/categories and anything notable, grouped naturally.",
  "- Reply in Thai first (the user's primary language), then ONE short English line.",
  "- Base it ONLY on the provided list. Never invent files, names, dates, or details.",
  "- Never output a person's, pet's, or individual's name.",
  "- No markdown, no bullet symbols, no file keys or URLs. Keep it chat-sized.",
].join("\n");

async function synthesize(files: IndexEntry[], items: ContentItem[], date: string): Promise<string> {
  const fileLines = files
    .slice(0, MAX_FILES_TO_MODEL)
    .map((e) => {
      const label = e.subject || e.filename;
      const detail = e.detail ? ` — ${e.detail}` : "";
      return `- [file/${e.category}] ${label}${detail}`;
    });

  const itemLines = items
    .slice(0, MAX_FILES_TO_MODEL)
    .map((it) => {
      const label = it.title || (it.type === "link" ? it.sourceUrl ?? "link" : "note");
      const detail = it.summary ? ` — ${it.summary.replace(/\s+/g, " ").slice(0, 160)}` : "";
      return `- [${it.type}/${it.category ?? "general"}] ${label}${detail}`;
    });

  const sections: string[] = [`Date: ${date}`];
  if (fileLines.length) sections.push(`Files saved today (${files.length}):\n${fileLines.join("\n")}`);
  if (itemLines.length) sections.push(`Notes & links saved today (${items.length}):\n${itemLines.join("\n")}`);

  const { text } = await generateText({
    model:           resolveModel(process.env.SUMMARY_MODEL_ID ?? DEFAULT_MODEL),
    system:          SYSTEM_PROMPT,
    prompt:          sections.join("\n\n"),
    maxOutputTokens: 500,
  });
  return text.trim();
}

/** Deterministic fallback used when the model errors or returns empty. */
function templateBrief(files: IndexEntry[], items: ContentItem[]): string {
  const parts = categoryBreakdown(files).map(([name, n]) => `${name} ×${n}`);
  if (items.length) parts.push(`📝 Notes & links ×${items.length}`);
  const total = files.length + items.length;
  return (
    `วันนี้คุณบันทึกไว้ ${total} รายการ — ${parts.join(", ")}\n` +
    `Today you saved ${total} item(s): ${parts.join(", ")}.`
  );
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Build the brief for one ICT calendar day (YYYY-MM-DD), or null when that day
 * has no files and no ready notes/links. Covers both S3 files and Neon
 * notes/links; the latter is best-effort so it still works if the DB isn't
 * provisioned. Backs the calendar Timeline's per-day "summary of the past".
 */
/** Collect a day's files (S3 index) + ready notes/links (Neon) — no model call. */
async function collectDayContent(
  userId: string,
  date: string,
): Promise<{ files: IndexEntry[]; items: ContentItem[] }> {
  const startMs = ictDayStartMsForDate(date);
  const endMs   = startMs + DAY_MS;

  const files = capturesInWindow(await getAllEntries(userId), startMs, endMs);

  let items: ContentItem[] = [];
  try {
    items = await listReadyItemsBetween(
      userId,
      new Date(startMs).toISOString(),
      new Date(endMs).toISOString(),
    );
  } catch (err) {
    console.warn("[summary] content_items unavailable (DB not provisioned?):", err);
  }

  return { files, items };
}

/**
 * Cheap content counts for a day (no model call) — used to detect when a cached
 * recap is stale (new files/captures arrived since it was generated).
 */
export async function countDayContent(
  userId: string,
  date: string,
): Promise<{ fileCount: number; itemCount: number }> {
  const { files, items } = await collectDayContent(userId, date);
  return { fileCount: files.length, itemCount: items.length };
}

export async function buildSummaryForDate(
  userId: string,
  date: string,
): Promise<DailySummary | null> {
  const { files, items } = await collectDayContent(userId, date);

  if (files.length === 0 && items.length === 0) return null;

  let text: string;
  try {
    text = await synthesize(files, items, date);
    if (!text) text = templateBrief(files, items);
  } catch (err) {
    console.warn("[summary] synthesis failed, using template:", err);
    text = templateBrief(files, items);
  }

  return {
    date,
    count:      files.length + items.length,
    text,
    highlights: files.slice(0, MAX_HIGHLIGHTS),
    captures:   files,
  };
}

/**
 * Build today's brief for a user, or null when nothing was captured today
 * (callers skip the push/reply entirely — no "you saved nothing" spam). Thin
 * wrapper over buildSummaryForDate for the daily cron + the "/summary" command.
 */
export async function buildDailySummary(
  userId: string,
  nowMs = Date.now(),
): Promise<DailySummary | null> {
  return buildSummaryForDate(userId, ictDateLabel(nowMs));
}
