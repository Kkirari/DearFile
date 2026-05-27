/**
 * Neon Postgres (warm tier) — Phase 7 backbone for the Second Brain pivot.
 *
 * Holds structured captures (notes/links) + their embeddings, so retrieval can
 * grow beyond the S3 keyword index. Files stay on S3 for now (unified in a later
 * phase). Uses the serverless HTTP driver (`@neondatabase/serverless`) — no
 * pooled connection to leak across Vercel function instances.
 *
 * We hand-roll parameterized SQL (no ORM) to match the rest of the repo's
 * dependency-light style. Schema lives in db/migrations/0001_init.sql.
 *
 * Env: DATABASE_URL (Neon pooled connection string).
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;

/** Lazily create the Neon client so importing this module never throws. */
function client(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
  }
  return _sql;
}

/**
 * Run a parameterized query and always return a plain rows array. The driver's
 * return shape has varied across versions ( `rows[]` vs `{ rows }` ), so we
 * normalize defensively.
 */
async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await client().query(text, params);
  if (Array.isArray(res)) return res as T[];
  const maybe = res as { rows?: T[] };
  return maybe.rows ?? [];
}

// ── Types ───────────────────────────────────────────────────────────────────

export type ContentType = "note" | "link";
export type ContentStatus = "pending" | "processing" | "ready" | "failed";

export interface ContentItem {
  id: string;
  userId: string;
  type: ContentType;
  status: ContentStatus;
  sourceUrl: string | null;
  title: string | null;
  rawText: string;
  summary: string | null;
  category: string | null;
  tags: string[] | null;
  lang: string | null;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
}

interface ContentItemRow {
  id: string;
  user_id: string;
  type: ContentType;
  status: ContentStatus;
  source_url: string | null;
  title: string | null;
  raw_text: string;
  summary: string | null;
  category: string | null;
  tags: string[] | null;
  lang: string | null;
  error: string | null;
  created_at: string | Date;
  processed_at: string | Date | null;
}

function toIso(v: string | Date | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function mapItem(r: ContentItemRow): ContentItem {
  return {
    id:          r.id,
    userId:      r.user_id,
    type:        r.type,
    status:      r.status,
    sourceUrl:   r.source_url,
    title:       r.title,
    rawText:     r.raw_text,
    summary:     r.summary,
    category:    r.category,
    tags:        r.tags,
    lang:        r.lang,
    error:       r.error,
    createdAt:   toIso(r.created_at)!,
    processedAt: toIso(r.processed_at),
  };
}

// ── content_items CRUD ──────────────────────────────────────────────────────

/** Insert a raw, unprocessed capture. Returns its id (the webhook acks on this). */
export async function insertPendingItem(input: {
  userId: string;
  type: ContentType;
  sourceUrl?: string | null;
  rawText: string;
}): Promise<string> {
  const rows = await q<{ id: string }>(
    `INSERT INTO content_items (user_id, type, status, source_url, raw_text)
     VALUES ($1, $2, 'pending', $3, $4)
     RETURNING id`,
    [input.userId, input.type, input.sourceUrl ?? null, input.rawText],
  );
  return rows[0].id;
}

export async function getItem(id: string): Promise<ContentItem | null> {
  const rows = await q<ContentItemRow>(`SELECT * FROM content_items WHERE id = $1`, [id]);
  return rows[0] ? mapItem(rows[0]) : null;
}

/**
 * Atomically claim an item for processing: only flips pending/failed → processing.
 * Returns the claimed row, or null if another worker already took it.
 */
export async function claimForProcessing(id: string): Promise<ContentItem | null> {
  const rows = await q<ContentItemRow>(
    `UPDATE content_items SET status = 'processing'
     WHERE id = $1 AND status IN ('pending', 'failed')
     RETURNING *`,
    [id],
  );
  return rows[0] ? mapItem(rows[0]) : null;
}

export async function markReady(
  id: string,
  data: { title: string | null; summary: string; category: string | null; tags: string[]; lang: string | null },
): Promise<ContentItem | null> {
  const rows = await q<ContentItemRow>(
    `UPDATE content_items
     SET status = 'ready', title = $2, summary = $3, category = $4, tags = $5,
         lang = $6, error = NULL, processed_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, data.title, data.summary, data.category, data.tags, data.lang],
  );
  return rows[0] ? mapItem(rows[0]) : null;
}

export async function markFailed(id: string, error: string): Promise<void> {
  await q(
    `UPDATE content_items SET status = 'failed', error = $2, processed_at = now()
     WHERE id = $1`,
    [id, error.slice(0, 500)],
  );
}

/** List a user's captures, newest first (the Timeline tab). */
export async function listItems(
  userId: string,
  opts: { limit?: number; beforeIso?: string } = {},
): Promise<ContentItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  if (opts.beforeIso) {
    const rows = await q<ContentItemRow>(
      `SELECT * FROM content_items
       WHERE user_id = $1 AND created_at < $2
       ORDER BY created_at DESC LIMIT $3`,
      [userId, opts.beforeIso, limit],
    );
    return rows.map(mapItem);
  }
  const rows = await q<ContentItemRow>(
    `SELECT * FROM content_items WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map(mapItem);
}

/** Ready captures created on/after `sinceIso` — folded into the daily recap. */
export async function listReadyItemsSince(userId: string, sinceIso: string): Promise<ContentItem[]> {
  const rows = await q<ContentItemRow>(
    `SELECT * FROM content_items
     WHERE user_id = $1 AND status = 'ready' AND created_at >= $2
     ORDER BY created_at DESC`,
    [userId, sinceIso],
  );
  return rows.map(mapItem);
}

/** Ready captures created within [startIso, endIso) — a single day's recap. */
export async function listReadyItemsBetween(
  userId: string,
  startIso: string,
  endIso: string,
): Promise<ContentItem[]> {
  const rows = await q<ContentItemRow>(
    `SELECT * FROM content_items
     WHERE user_id = $1 AND status = 'ready'
       AND created_at >= $2 AND created_at < $3
     ORDER BY created_at DESC`,
    [userId, startIso, endIso],
  );
  return rows.map(mapItem);
}

export async function deleteItem(userId: string, id: string): Promise<boolean> {
  const rows = await q<{ id: string }>(
    `DELETE FROM content_items WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId],
  );
  return rows.length > 0;
}

/**
 * IDs of items that still need work: pending, retryable failed, or stuck in
 * processing for >10 min (a crashed worker). Drained by the reconciliation cron.
 */
export async function listDueItemIds(limit = 25): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `SELECT id FROM content_items
     WHERE status IN ('pending', 'failed')
        OR (status = 'processing' AND processed_at IS NULL AND created_at < now() - interval '10 minutes')
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}

/** Distinct users who have any captures — unioned into the daily-summary sweep. */
export async function listUserIdsWithContent(): Promise<string[]> {
  const rows = await q<{ user_id: string }>(`SELECT DISTINCT user_id FROM content_items`);
  return rows.map((r) => r.user_id);
}

// ── chunks (embeddings) ─────────────────────────────────────────────────────

/** Store one embedding chunk. `embedding` is a plain number[] (pgvector cast). */
export async function insertChunk(input: {
  contentItemId: string;
  content: string;
  embedding: number[];
}): Promise<void> {
  const vec = `[${input.embedding.join(",")}]`;
  await q(
    `INSERT INTO chunks (content_item_id, content, embedding)
     VALUES ($1, $2, $3::vector)`,
    [input.contentItemId, input.content, vec],
  );
}

/** A capture surfaced by semantic search, with its cosine similarity score. */
export interface CaptureSearchHit {
  id: string;
  type: ContentType;
  title: string | null;
  summary: string | null;
  sourceUrl: string | null;
  tags: string[] | null;
  createdAt: string;
  score: number; // cosine similarity in [0,1], higher = closer
}

interface ChunkHitRow {
  id: string;
  type: ContentType;
  title: string | null;
  summary: string | null;
  source_url: string | null;
  tags: string[] | null;
  created_at: string | Date;
  score: number | string;
}

/**
 * Semantic search over a user's ready captures via pgvector cosine distance.
 * `embedding` is the query vector (Voyage). Returns the closest items, newest
 * tie-break implicit in the index; deduped by content item.
 */
export async function searchChunks(
  userId: string,
  embedding: number[],
  limit = 6,
): Promise<CaptureSearchHit[]> {
  const vec = `[${embedding.join(",")}]`;
  const rows = await q<ChunkHitRow>(
    `SELECT ci.id, ci.type, ci.title, ci.summary, ci.source_url, ci.tags, ci.created_at,
            1 - (c.embedding <=> $2::vector) AS score
     FROM chunks c
     JOIN content_items ci ON ci.id = c.content_item_id
     WHERE ci.user_id = $1 AND ci.status = 'ready'
     ORDER BY c.embedding <=> $2::vector
     LIMIT $3`,
    [userId, vec, Math.min(Math.max(limit, 1), 50)],
  );

  const seen = new Set<string>();
  const out: CaptureSearchHit[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id:        r.id,
      type:      r.type,
      title:     r.title,
      summary:   r.summary,
      sourceUrl: r.source_url,
      tags:      r.tags,
      createdAt: toIso(r.created_at)!,
      score:     Number(r.score),
    });
  }
  return out;
}

// ── daily_summaries (persisted recaps for the calendar) ─────────────────────

export interface DailySummaryRecord {
  date: string;       // YYYY-MM-DD (ICT)
  text: string;
  fileCount: number;
  itemCount: number;
  createdAt: string;  // when this recap was last (re)generated — drives the today TTL
}

interface DailySummaryRow {
  date: string;
  text: string;
  file_count: number;
  item_count: number;
  created_at: string | Date;
}

/** Fetch a stored recap for one ICT day, or null if none has been generated. */
export async function getDailySummary(userId: string, date: string): Promise<DailySummaryRecord | null> {
  const rows = await q<DailySummaryRow>(
    `SELECT date, text, file_count, item_count, created_at
     FROM daily_summaries WHERE user_id = $1 AND date = $2`,
    [userId, date],
  );
  const r = rows[0];
  return r
    ? { date: r.date, text: r.text, fileCount: r.file_count, itemCount: r.item_count, createdAt: toIso(r.created_at)! }
    : null;
}

/** Insert or overwrite a day's recap (the 20:00 cron may refresh today's). */
export async function upsertDailySummary(input: {
  userId: string;
  date: string;
  text: string;
  fileCount: number;
  itemCount: number;
}): Promise<void> {
  await q(
    `INSERT INTO daily_summaries (user_id, date, text, file_count, item_count)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, date)
     DO UPDATE SET text = EXCLUDED.text,
                   file_count = EXCLUDED.file_count,
                   item_count = EXCLUDED.item_count,
                   created_at = now()`,
    [input.userId, input.date, input.text, input.fileCount, input.itemCount],
  );
}

// ── user_profile (interest memory / persona) ────────────────────────────────

export interface UserProfile {
  interests: string[];
  about: string | null;
  updatedAt: string;
}

interface UserProfileRow {
  interests: string[] | null;
  about: string | null;
  updated_at: string | Date;
}

/** The user's accumulated interest profile, or null if none built yet. */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const rows = await q<UserProfileRow>(
    `SELECT interests, about, updated_at FROM user_profile WHERE user_id = $1`,
    [userId],
  );
  const r = rows[0];
  return r ? { interests: r.interests ?? [], about: r.about, updatedAt: toIso(r.updated_at)! } : null;
}

/** Insert or replace the user's profile (the daily learner overwrites it). */
export async function upsertUserProfile(input: {
  userId: string;
  interests: string[];
  about: string | null;
}): Promise<void> {
  await q(
    `INSERT INTO user_profile (user_id, interests, about, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id)
     DO UPDATE SET interests = EXCLUDED.interests, about = EXCLUDED.about, updated_at = now()`,
    [input.userId, input.interests, input.about],
  );
}

/** Clear a user's profile (the Profile-tab "Clear" button). */
export async function deleteUserProfile(userId: string): Promise<void> {
  await q(`DELETE FROM user_profile WHERE user_id = $1`, [userId]);
}

// ── file_embeddings (semantic search over S3 files) ─────────────────────────

export interface FileEmbeddingHit {
  fileKey: string;
  score: number; // cosine similarity in [0,1]
}

interface FileEmbeddingHitRow {
  file_key: string;
  score: number | string;
}

/** Insert or replace a file's embedding (keyed by user + S3 key). */
export async function upsertFileEmbedding(input: {
  userId: string;
  fileKey: string;
  content: string;
  embedding: number[];
}): Promise<void> {
  const vec = `[${input.embedding.join(",")}]`;
  await q(
    `INSERT INTO file_embeddings (user_id, file_key, content, embedding, updated_at)
     VALUES ($1, $2, $3, $4::vector, now())
     ON CONFLICT (user_id, file_key)
     DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding, updated_at = now()`,
    [input.userId, input.fileKey, input.content, vec],
  );
}

/** Semantic search over a user's file embeddings (cosine). Returns key + score. */
export async function searchFileEmbeddings(
  userId: string,
  embedding: number[],
  limit = 6,
): Promise<FileEmbeddingHit[]> {
  const vec = `[${embedding.join(",")}]`;
  const rows = await q<FileEmbeddingHitRow>(
    `SELECT file_key, 1 - (embedding <=> $2::vector) AS score
     FROM file_embeddings
     WHERE user_id = $1 AND embedding IS NOT NULL
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    [userId, vec, Math.min(Math.max(limit, 1), 50)],
  );
  return rows.map((r) => ({ fileKey: r.file_key, score: Number(r.score) }));
}

/** Keys a user already has embedded — lets backfill skip done files. */
export async function listEmbeddedFileKeys(userId: string): Promise<Set<string>> {
  const rows = await q<{ file_key: string }>(
    `SELECT file_key FROM file_embeddings WHERE user_id = $1`,
    [userId],
  );
  return new Set(rows.map((r) => r.file_key));
}

// ── user_api_keys (BYOK encrypted at-rest) ──────────────────────────────────

export type ByokProvider = "anthropic" | "voyage";

export interface UserApiKeyCiphers {
  anthropicCt: string | null;
  voyageCt: string | null;
  updatedAt: string;
}

interface UserApiKeyRow {
  anthropic_ct: string | null;
  voyage_ct: string | null;
  updated_at: string | Date;
}

/** Ciphertext blobs for a user (decrypt via lib/crypto). null if no row. */
export async function getUserApiKeyCiphers(userId: string): Promise<UserApiKeyCiphers | null> {
  const rows = await q<UserApiKeyRow>(
    `SELECT anthropic_ct, voyage_ct, updated_at FROM user_api_keys WHERE user_id = $1`,
    [userId],
  );
  const r = rows[0];
  return r
    ? { anthropicCt: r.anthropic_ct, voyageCt: r.voyage_ct, updatedAt: toIso(r.updated_at)! }
    : null;
}

/** Upsert one provider's ciphertext; leaves the other provider untouched. */
export async function upsertUserApiKey(
  userId: string,
  provider: ByokProvider,
  ciphertext: string,
): Promise<void> {
  const col = provider === "anthropic" ? "anthropic_ct" : "voyage_ct";
  // First insert (no-op on conflict so we can update on a second statement);
  // raw SQL via Neon HTTP doesn't allow building column lists from params.
  await q(
    `INSERT INTO user_api_keys (user_id, ${col}, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id)
     DO UPDATE SET ${col} = EXCLUDED.${col}, updated_at = now()`,
    [userId, ciphertext],
  );
}

/** Null one provider's ciphertext; the row stays so the other key survives. */
export async function deleteUserApiKey(userId: string, provider: ByokProvider): Promise<void> {
  const col = provider === "anthropic" ? "anthropic_ct" : "voyage_ct";
  await q(
    `UPDATE user_api_keys SET ${col} = NULL, updated_at = now() WHERE user_id = $1`,
    [userId],
  );
}

// ── user_mcp_tokens (Phase 11 — bearer tokens for the MCP endpoint) ─────────

export interface McpTokenRow {
  tokenHash:  string;
  label:      string | null;
  createdAt:  string;
  lastUsedAt: string | null;
}

interface McpTokenDbRow {
  token_hash:    string;
  user_id?:      string;
  label:         string | null;
  created_at:    string | Date;
  last_used_at:  string | Date | null;
}

/** Insert a new token hash. Caller has already validated + hashed the plaintext. */
export async function insertMcpToken(input: {
  userId: string;
  tokenHash: string;
  label: string | null;
}): Promise<void> {
  await q(
    `INSERT INTO user_mcp_tokens (token_hash, user_id, label) VALUES ($1, $2, $3)`,
    [input.tokenHash, input.userId, input.label],
  );
}

/**
 * Resolve a token hash → userId (or null), and bump `last_used_at`.
 * The update is fire-and-forget intentionally: a failed touch must not 401 the
 * caller.
 */
export async function findUserByMcpTokenHash(tokenHash: string): Promise<string | null> {
  const rows = await q<{ user_id: string }>(
    `SELECT user_id FROM user_mcp_tokens WHERE token_hash = $1`,
    [tokenHash],
  );
  const userId = rows[0]?.user_id ?? null;
  if (userId) {
    q(`UPDATE user_mcp_tokens SET last_used_at = now() WHERE token_hash = $1`, [tokenHash])
      .catch((err) => console.warn("[db] mcp token touch failed:", err));
  }
  return userId;
}

export async function listMcpTokens(userId: string): Promise<McpTokenRow[]> {
  const rows = await q<McpTokenDbRow>(
    `SELECT token_hash, label, created_at, last_used_at
     FROM user_mcp_tokens WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 50`,
    [userId],
  );
  return rows.map((r) => ({
    tokenHash:  r.token_hash,
    label:      r.label,
    createdAt:  toIso(r.created_at)!,
    lastUsedAt: r.last_used_at ? toIso(r.last_used_at) : null,
  }));
}

export async function deleteMcpToken(userId: string, tokenHash: string): Promise<void> {
  await q(
    `DELETE FROM user_mcp_tokens WHERE user_id = $1 AND token_hash = $2`,
    [userId, tokenHash],
  );
}
