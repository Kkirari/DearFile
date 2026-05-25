/**
 * Search index — single JSON file in S3 holding analyzed-file metadata.
 * Lets us full-text search by Thai/English keywords without scanning S3 tags
 * (S3 tags are ASCII-only) and lets AI folders compute counts cheaply.
 *
 * Two scopes share the same code path:
 *   - User scope    — index at `users/{U}/_search-index.json`
 *   - Workspace scope — index at `workspaces/{W}/_search-index.json`
 *
 * Existing per-user callers keep using `upsertEntry(userId, …)` etc; new
 * workspace callers use the `*WorkspaceEntry` twins. Internally both route
 * through the same Scope-aware implementation.
 *
 * Features:
 *   - Relevance scoring (filename > subject > keywords > detail)
 *   - Fuzzy matching (Levenshtein distance for typo tolerance)
 *   - Filtering by category (photos / docs / finance / academic / all)
 *   - Multiple sort modes (relevance / newest / oldest / largest)
 *   - Keyword/filename suggestions for autocomplete
 */

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET, userSearchIndexKey, workspaceSearchIndexKey } from "./s3";

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
  /**
   * Physical folder id derived from the S3 key, or null for the inbox.
   * Field name is historical (`user_folder_id`) — for workspace entries it
   * is the folder id under `workspaces/{W}/folders/{folderId}/`.
   */
  user_folder_id: string | null;
  size: number;
  mimeType: string;
  createdAt: string;
  /** Set on workspace entries — the LINE userId that uploaded the file. */
  uploaderId?: string;
}

export interface ScoredEntry extends IndexEntry {
  score: number;
  matchedIn: string[];   // ["filename", "keywords:coffee"] etc.
}

export type SortMode = "relevance" | "newest" | "oldest" | "largest";
export type FilterMode = "all" | "photos" | "documents" | "finance" | "academic";

// ── Scope abstraction ─────────────────────────────────────────────────────

interface Scope {
  /** Stable in-process key for the per-scope mutation lock. */
  lockKey: string;
  /** S3 key of the index file for this scope. */
  indexKey: string;
}

function userScope(userId: string): Scope {
  return { lockKey: `user:${userId}`, indexKey: userSearchIndexKey(userId) };
}

function workspaceScope(workspaceId: string): Scope {
  return {
    lockKey:  `workspace:${workspaceId}`,
    indexKey: workspaceSearchIndexKey(workspaceId),
  };
}

// ── Persistence ───────────────────────────────────────────────────────────

async function loadIndex(scope: Scope): Promise<IndexEntry[]> {
  try {
    const res = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key:    scope.indexKey,
    }));
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

async function saveIndex(scope: Scope, entries: IndexEntry[]): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         scope.indexKey,
    Body:        JSON.stringify(entries),
    ContentType: "application/json",
  }));
}

// Per-scope serialization. Concurrent writes to the SAME index would
// otherwise lose updates (load→mutate→save with no ETag). Different scopes
// don't block each other. Cross-instance races still possible — a proper
// fix needs ETag-conditional writes or a real KV store.
const mutationChains = new Map<string, Promise<unknown>>();

function withIndexLock<T>(scope: Scope, fn: () => Promise<T>): Promise<T> {
  const prev = mutationChains.get(scope.lockKey) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  mutationChains.set(scope.lockKey, next.catch(() => undefined));
  return next;
}

/**
 * Derive the physical folder id from an S3 key for either scope shape.
 *   users/{U}/folders/{F}/file       → F
 *   workspaces/{W}/folders/{F}/file  → F
 *   users/{U}/uploads/file           → null
 *   workspaces/{W}/inbox/file        → null
 */
function folderIdFromKey(key: string): string | null {
  const m = key.match(/^(?:users|workspaces)\/[^/]+\/folders\/([^/]+)\//);
  return m?.[1] ?? null;
}

// ── Scoped mutations (internal) ───────────────────────────────────────────

function upsertEntryScoped(scope: Scope, entry: IndexEntry): Promise<void> {
  return withIndexLock(scope, async () => {
    const idx = await loadIndex(scope);
    const existing = idx.findIndex((e) => e.key === entry.key);
    if (existing >= 0) idx[existing] = entry;
    else idx.push(entry);
    await saveIndex(scope, idx);
  });
}

function removeEntryScoped(scope: Scope, key: string): Promise<void> {
  return withIndexLock(scope, async () => {
    const idx = await loadIndex(scope);
    const filtered = idx.filter((e) => e.key !== key);
    if (filtered.length !== idx.length) await saveIndex(scope, filtered);
  });
}

function renameEntryKeyScoped(scope: Scope, oldKey: string, newKey: string): Promise<void> {
  return withIndexLock(scope, async () => {
    const idx = await loadIndex(scope);
    const target = idx.find((e) => e.key === oldKey);
    if (!target) return;
    target.key = newKey;
    target.filename = newKey.split("/").pop() ?? target.filename;
    // Keep user_folder_id in sync with the new path — moves between
    // folders/inbox previously left this stale, which broke folder-delete
    // cascades and AI-folder counts after a move.
    target.user_folder_id = folderIdFromKey(newKey);
    await saveIndex(scope, idx);
  });
}

function removeEntriesByFolderIdScoped(scope: Scope, folderId: string): Promise<number> {
  return withIndexLock(scope, async () => {
    const idx = await loadIndex(scope);
    const filtered = idx.filter((e) => e.user_folder_id !== folderId);
    const removed = idx.length - filtered.length;
    if (removed > 0) await saveIndex(scope, filtered);
    return removed;
  });
}

function bulkRenameEntryKeysScoped(
  scope: Scope,
  renames: { oldKey: string; newKey: string }[],
): Promise<number> {
  return withIndexLock(scope, async () => {
    if (renames.length === 0) return 0;
    const map = new Map(renames.map((r) => [r.oldKey, r.newKey]));
    const idx = await loadIndex(scope);
    let changed = 0;
    for (const e of idx) {
      const newKey = map.get(e.key);
      if (!newKey) continue;
      e.key = newKey;
      e.filename = newKey.split("/").pop() ?? e.filename;
      e.user_folder_id = folderIdFromKey(newKey);
      changed++;
    }
    if (changed > 0) await saveIndex(scope, idx);
    return changed;
  });
}

function bulkRemoveEntriesScoped(scope: Scope, keys: string[]): Promise<number> {
  return withIndexLock(scope, async () => {
    if (keys.length === 0) return 0;
    const drop = new Set(keys);
    const idx = await loadIndex(scope);
    const filtered = idx.filter((e) => !drop.has(e.key));
    const removed = idx.length - filtered.length;
    if (removed > 0) await saveIndex(scope, filtered);
    return removed;
  });
}

// ── Public API: user-scoped (existing callers, unchanged signatures) ──────

export function upsertEntry(userId: string, entry: IndexEntry): Promise<void> {
  // Save to the S3 index, then best-effort embed for semantic file search.
  // Dynamic import avoids a static import cycle with lib/file-search (which
  // reads this module). A Voyage/DB hiccup must never break file indexing.
  return upsertEntryScoped(userScope(userId), entry).then(async () => {
    try {
      const { indexFileEmbedding } = await import("./file-search");
      await indexFileEmbedding(userId, entry);
    } catch (err) {
      console.warn("[search-index] file embed skipped:", err);
    }
  });
}

export function removeEntry(userId: string, key: string): Promise<void> {
  return removeEntryScoped(userScope(userId), key);
}

export function renameEntryKey(userId: string, oldKey: string, newKey: string): Promise<void> {
  return renameEntryKeyScoped(userScope(userId), oldKey, newKey);
}

export function removeEntriesByUserFolderId(userId: string, folderId: string): Promise<number> {
  return removeEntriesByFolderIdScoped(userScope(userId), folderId);
}

export function bulkRenameEntryKeys(
  userId: string,
  renames: { oldKey: string; newKey: string }[],
): Promise<number> {
  return bulkRenameEntryKeysScoped(userScope(userId), renames);
}

export function bulkRemoveEntries(userId: string, keys: string[]): Promise<number> {
  return bulkRemoveEntriesScoped(userScope(userId), keys);
}

export async function getAllEntries(userId: string): Promise<IndexEntry[]> {
  return loadIndex(userScope(userId));
}

export async function countByAiFolder(userId: string): Promise<Record<string, number>> {
  const idx = await loadIndex(userScope(userId));
  const out: Record<string, number> = {};
  for (const e of idx) out[e.ai_folder_id] = (out[e.ai_folder_id] ?? 0) + 1;
  return out;
}

export async function entriesByAiFolder(userId: string, folderId: string): Promise<IndexEntry[]> {
  const idx = await loadIndex(userScope(userId));
  return idx.filter((e) => e.ai_folder_id === folderId);
}

// ── Public API: workspace-scoped twins ────────────────────────────────────

export function upsertWorkspaceEntry(workspaceId: string, entry: IndexEntry): Promise<void> {
  return upsertEntryScoped(workspaceScope(workspaceId), entry);
}

export function removeWorkspaceEntry(workspaceId: string, key: string): Promise<void> {
  return removeEntryScoped(workspaceScope(workspaceId), key);
}

export function renameWorkspaceEntryKey(
  workspaceId: string,
  oldKey: string,
  newKey: string,
): Promise<void> {
  return renameEntryKeyScoped(workspaceScope(workspaceId), oldKey, newKey);
}

export function removeWorkspaceEntriesByFolderId(
  workspaceId: string,
  folderId: string,
): Promise<number> {
  return removeEntriesByFolderIdScoped(workspaceScope(workspaceId), folderId);
}

export function bulkRenameWorkspaceEntryKeys(
  workspaceId: string,
  renames: { oldKey: string; newKey: string }[],
): Promise<number> {
  return bulkRenameEntryKeysScoped(workspaceScope(workspaceId), renames);
}

export function bulkRemoveWorkspaceEntries(
  workspaceId: string,
  keys: string[],
): Promise<number> {
  return bulkRemoveEntriesScoped(workspaceScope(workspaceId), keys);
}

export async function getAllWorkspaceEntries(workspaceId: string): Promise<IndexEntry[]> {
  return loadIndex(workspaceScope(workspaceId));
}

export async function countWorkspaceByAiFolder(
  workspaceId: string,
): Promise<Record<string, number>> {
  const idx = await loadIndex(workspaceScope(workspaceId));
  const out: Record<string, number> = {};
  for (const e of idx) out[e.ai_folder_id] = (out[e.ai_folder_id] ?? 0) + 1;
  return out;
}

export async function workspaceEntriesByAiFolder(
  workspaceId: string,
  folderId: string,
): Promise<IndexEntry[]> {
  const idx = await loadIndex(workspaceScope(workspaceId));
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

// ── Search (scope-aware internal + user-scoped public) ────────────────────

export interface SearchOptions {
  filter?: FilterMode;
  sort?:   SortMode;
}

async function searchScopedScored(
  scope: Scope,
  query: string,
  options: SearchOptions = {},
): Promise<ScoredEntry[]> {
  const { filter = "all", sort = "relevance" } = options;
  const q = query.trim().toLowerCase();

  const idx = await loadIndex(scope);
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

    const fnScore = fieldScore(e.filename, q);
    if (fnScore > 0) { total += fnScore * 2.5; matchedIn.push("filename"); }

    const subjScore = fieldScore(e.subject, q);
    if (subjScore > 0) { total += subjScore * 2.0; matchedIn.push("subject"); }

    let bestKw = 0;
    let bestKwTerm = "";
    for (const kw of e.keywords) {
      const s = fieldScore(kw, q);
      if (s > bestKw) { bestKw = s; bestKwTerm = kw; }
    }
    if (bestKw > 0) { total += bestKw * 1.5; matchedIn.push(`keyword:${bestKwTerm}`); }

    const detailScore = fieldScore(e.detail, q);
    if (detailScore > 0) { total += detailScore * 0.8; matchedIn.push("detail"); }

    if (total > 0) scored.push({ ...e, score: total, matchedIn });
  }

  return applySort(scored, sort);
}

/**
 * Score-ranked search. Returns entries with `score` and `matchedIn` metadata.
 * Field weights:  filename(2.5) > subject(2.0) > keywords(1.5) > detail(0.8)
 */
export function searchScored(
  userId: string,
  query: string,
  options: SearchOptions = {},
): Promise<ScoredEntry[]> {
  return searchScopedScored(userScope(userId), query, options);
}

export function searchWorkspaceScored(
  workspaceId: string,
  query: string,
  options: SearchOptions = {},
): Promise<ScoredEntry[]> {
  return searchScopedScored(workspaceScope(workspaceId), query, options);
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

// ── Suggestions for autocomplete ──────────────────────────────────────────

async function suggestScoped(scope: Scope, query: string, limit = 6): Promise<string[]> {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 1) return [];

  const idx = await loadIndex(scope);
  const seen = new Set<string>();
  const results: { term: string; weight: number }[] = [];

  for (const e of idx) {
    const subj = e.subject.toLowerCase();
    if (subj.startsWith(q) && !seen.has(subj)) {
      seen.add(subj);
      results.push({ term: e.subject, weight: 3 });
    }

    for (const kw of e.keywords) {
      const lk = kw.toLowerCase();
      if (lk.startsWith(q) && !seen.has(lk)) {
        seen.add(lk);
        results.push({ term: kw, weight: 2 });
      }
    }

    const filenameLow = e.filename.toLowerCase();
    if (filenameLow.includes(q) && !seen.has(filenameLow)) {
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

/**
 * Returns up to N keyword/filename suggestions whose start matches the query.
 * Used by the autocomplete dropdown while user is typing.
 */
export function suggest(userId: string, query: string, limit = 6): Promise<string[]> {
  return suggestScoped(userScope(userId), query, limit);
}

export function suggestWorkspace(
  workspaceId: string,
  query: string,
  limit = 6,
): Promise<string[]> {
  return suggestScoped(workspaceScope(workspaceId), query, limit);
}

// ── Category counts (for filter chip badges) ──────────────────────────────

async function countByFilterScoped(scope: Scope): Promise<Record<FilterMode, number>> {
  const idx = await loadIndex(scope);
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

export function countByFilter(userId: string): Promise<Record<FilterMode, number>> {
  return countByFilterScoped(userScope(userId));
}

export function countWorkspaceByFilter(
  workspaceId: string,
): Promise<Record<FilterMode, number>> {
  return countByFilterScoped(workspaceScope(workspaceId));
}
