/**
 * Search index — single JSON file in S3 holding analyzed-file metadata.
 * Lets us full-text search by Thai/English keywords without scanning S3 tags
 * (S3 tags are ASCII-only) and lets AI folders compute counts cheaply.
 *
 * Now supports:
 *   - Relevance scoring (filename > subject > keywords > detail)
 *   - Fuzzy matching (Levenshtein distance for typo tolerance)
 *   - Filtering by category (photos / docs / finance / academic / all)
 *   - Multiple sort modes (relevance / newest / oldest / largest)
 *   - Keyword/filename suggestions for autocomplete
 */

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "./s3";

const INDEX_KEY = "_search-index.json";

export interface IndexEntry {
  key: string;                    // current S3 key (after rename)
  filename: string;               // displayed filename
  category: string;
  type: string;
  subject: string;
  detail: string;
  date: string | null;
  keywords: string[];             // mixed TH + EN
  ai_folder_id: string;
  user_folder_id: string | null;  // physical folder (uploads/ → null)
  size: number;
  mimeType: string;
  createdAt: string;
}

export interface ScoredEntry extends IndexEntry {
  score: number;
  matchedIn: string[];   // ["filename", "keywords:coffee"] etc.
}

export type SortMode = "relevance" | "newest" | "oldest" | "largest";
export type FilterMode = "all" | "photos" | "documents" | "finance" | "academic";

// ── Persistence ───────────────────────────────────────────────────────────────

async function loadIndex(): Promise<IndexEntry[]> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: INDEX_KEY }));
    const body = await res.Body?.transformToString();
    if (!body) return [];
    try {
      const parsed = JSON.parse(body);
      // Defensive: an unexpected shape (e.g. corrupted file) shouldn't take the app down.
      return Array.isArray(parsed) ? (parsed as IndexEntry[]) : [];
    } catch (parseErr) {
      console.warn("[search-index] corrupted index file, treating as empty:", parseErr);
      return [];
    }
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "NoSuchKey") return [];
    throw err;
  }
}

async function saveIndex(entries: IndexEntry[]): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         INDEX_KEY,
    Body:        JSON.stringify(entries),
    ContentType: "application/json",
  }));
}

// Serialize index mutations within a single process so concurrent
// load→mutate→save cycles don't lose updates. Cross-instance races still
// possible — a proper fix needs ETag-conditional writes or a real KV store.
let mutationChain: Promise<unknown> = Promise.resolve();

function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = mutationChain.then(fn, fn);
  mutationChain = next.catch(() => undefined);
  return next;
}

export function upsertEntry(entry: IndexEntry): Promise<void> {
  return withIndexLock(async () => {
    const idx = await loadIndex();
    const existing = idx.findIndex((e) => e.key === entry.key);
    if (existing >= 0) idx[existing] = entry;
    else idx.push(entry);
    await saveIndex(idx);
  });
}

export function removeEntry(key: string): Promise<void> {
  return withIndexLock(async () => {
    const idx = await loadIndex();
    const filtered = idx.filter((e) => e.key !== key);
    if (filtered.length !== idx.length) await saveIndex(filtered);
  });
}

export function renameEntryKey(oldKey: string, newKey: string): Promise<void> {
  return withIndexLock(async () => {
    const idx = await loadIndex();
    const target = idx.find((e) => e.key === oldKey);
    if (!target) return;
    target.key = newKey;
    target.filename = newKey.split("/").pop() ?? target.filename;
    await saveIndex(idx);
  });
}

export async function getAllEntries(): Promise<IndexEntry[]> {
  return loadIndex();
}

export async function countByAiFolder(): Promise<Record<string, number>> {
  const idx = await loadIndex();
  const out: Record<string, number> = {};
  for (const e of idx) out[e.ai_folder_id] = (out[e.ai_folder_id] ?? 0) + 1;
  return out;
}

export async function entriesByAiFolder(folderId: string): Promise<IndexEntry[]> {
  const idx = await loadIndex();
  return idx.filter((e) => e.ai_folder_id === folderId);
}

// ── Fuzzy match helpers ───────────────────────────────────────────────────────

/**
 * Cheap Levenshtein distance — small strings only (filenames/keywords).
 * Returns 0 for exact match, ascending for more edits required.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const m: number[][] = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = b[i - 1] === a[j - 1]
        ? m[i - 1][j - 1]
        : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
    }
  }
  return m[b.length][a.length];
}

/**
 * Score one field against a query token.
 *   1.0  exact substring match
 *   0.7  starts with query (better than middle match)
 *   0.4  fuzzy match within 1-2 edits (typo tolerance, only for query >= 4 chars)
 *   0    no match
 */
function fieldScore(field: string, q: string): number {
  if (!field) return 0;
  const f = field.toLowerCase();
  if (f === q) return 1.0;
  if (f.startsWith(q)) return 0.7;
  if (f.includes(q)) return 0.6;

  // Fuzzy: only for queries with >=4 chars (avoid noise on short queries)
  if (q.length >= 4) {
    // Check whole field first (good for short fields like keywords)
    if (f.length <= q.length + 3) {
      const dist = levenshtein(f, q);
      const maxDist = q.length <= 5 ? 1 : 2;
      if (dist <= maxDist) return 0.4 - dist * 0.05;
    }
    // Check word-level for longer fields
    for (const word of f.split(/\s+|_|-/)) {
      if (!word) continue;
      if (Math.abs(word.length - q.length) > 2) continue;
      const dist = levenshtein(word, q);
      const maxDist = q.length <= 5 ? 1 : 2;
      if (dist <= maxDist) return 0.4 - dist * 0.05;
    }
  }
  return 0;
}

// ── Category mapping (analyzer category → filter chip) ────────────────────────

function matchesFilter(entry: IndexEntry, filter: FilterMode): boolean {
  if (filter === "all") return true;
  if (filter === "photos")    return entry.category === "photo";
  if (filter === "documents") return entry.category === "document";
  if (filter === "finance")   return entry.category === "finance";
  if (filter === "academic")  return entry.category === "academic";
  return true;
}

// ── Main search ───────────────────────────────────────────────────────────────

export interface SearchOptions {
  filter?: FilterMode;
  sort?:   SortMode;
}

/**
 * Score-ranked search. Returns entries with `score` and `matchedIn` metadata.
 * Field weights:  filename(2.5) > subject(2.0) > keywords(1.5) > detail(0.8)
 */
export async function searchScored(
  query: string,
  options: SearchOptions = {}
): Promise<ScoredEntry[]> {
  const { filter = "all", sort = "relevance" } = options;
  const q = query.trim().toLowerCase();

  const idx = await loadIndex();
  const filtered = idx.filter((e) => matchesFilter(e, filter));

  // No query → return all (filtered) entries with score 0
  if (!q) {
    const all: ScoredEntry[] = filtered.map((e) => ({ ...e, score: 0, matchedIn: [] }));
    return applySort(all, sort);
  }

  const scored: ScoredEntry[] = [];

  for (const e of filtered) {
    let total = 0;
    const matchedIn: string[] = [];

    // Filename — weight 2.5
    const fnScore = fieldScore(e.filename, q);
    if (fnScore > 0) {
      total += fnScore * 2.5;
      matchedIn.push("filename");
    }

    // Subject — weight 2.0
    const subjScore = fieldScore(e.subject, q);
    if (subjScore > 0) {
      total += subjScore * 2.0;
      matchedIn.push("subject");
    }

    // Keywords — weight 1.5 (best matching keyword)
    let bestKw = 0;
    let bestKwTerm = "";
    for (const kw of e.keywords) {
      const s = fieldScore(kw, q);
      if (s > bestKw) { bestKw = s; bestKwTerm = kw; }
    }
    if (bestKw > 0) {
      total += bestKw * 1.5;
      matchedIn.push(`keyword:${bestKwTerm}`);
    }

    // Detail — weight 0.8
    const detailScore = fieldScore(e.detail, q);
    if (detailScore > 0) {
      total += detailScore * 0.8;
      matchedIn.push("detail");
    }

    if (total > 0) {
      scored.push({ ...e, score: total, matchedIn });
    }
  }

  return applySort(scored, sort);
}

function applySort(entries: ScoredEntry[], sort: SortMode): ScoredEntry[] {
  switch (sort) {
    case "relevance":
      return entries.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    case "newest":
      return entries.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case "oldest":
      return entries.sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    case "largest":
      return entries.sort((a, b) => b.size - a.size);
    default:
      return entries;
  }
}

// ── Legacy plain search (kept for backward compatibility) ─────────────────────

export async function search(query: string): Promise<IndexEntry[]> {
  return searchScored(query);
}

// ── Suggestions for autocomplete ──────────────────────────────────────────────

/**
 * Returns up to N keyword/filename suggestions whose start matches the query.
 * Used by the autocomplete dropdown while user is typing.
 */
export async function suggest(query: string, limit = 6): Promise<string[]> {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 1) return [];

  const idx = await loadIndex();
  const seen = new Set<string>();
  const results: { term: string; weight: number }[] = [];

  for (const e of idx) {
    // Subject (highest priority)
    const subj = e.subject.toLowerCase();
    if (subj.startsWith(q) && !seen.has(subj)) {
      seen.add(subj);
      results.push({ term: e.subject, weight: 3 });
    }

    // Keywords (medium priority)
    for (const kw of e.keywords) {
      const lk = kw.toLowerCase();
      if (lk.startsWith(q) && !seen.has(lk)) {
        seen.add(lk);
        results.push({ term: kw, weight: 2 });
      }
    }

    // Filename word starts (lowest priority)
    const filenameLow = e.filename.toLowerCase();
    if (filenameLow.includes(q) && !seen.has(filenameLow)) {
      // include filename only if the query matches near a word boundary
      const words = filenameLow.split(/[_\-\s.]/);
      if (words.some((w) => w.startsWith(q))) {
        seen.add(filenameLow);
        results.push({ term: e.filename, weight: 1 });
      }
    }
  }

  return results
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((r) => r.term);
}

// ── Category counts (for filter chip badges) ──────────────────────────────────

export async function countByFilter(): Promise<Record<FilterMode, number>> {
  const idx = await loadIndex();
  const out: Record<FilterMode, number> = {
    all: idx.length,
    photos: 0,
    documents: 0,
    finance: 0,
    academic: 0,
  };
  for (const e of idx) {
    if (e.category === "photo")    out.photos++;
    if (e.category === "document") out.documents++;
    if (e.category === "finance")  out.finance++;
    if (e.category === "academic") out.academic++;
  }
  return out;
}
