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
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
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
