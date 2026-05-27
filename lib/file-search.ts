/**
 * File semantic search — Voyage embeddings over the S3 file index, so Ask and
 * the Search tab can find files by MEANING (not just keywords). Mirrors the
 * notes/links path (chunks) but for files, keyed by (user_id, file_key).
 *
 * Best-effort throughout: a missing Voyage key or any error must never break
 * file indexing, Ask, or Search. User scope only for v1 (workspace files later).
 *
 * BYOK: callers thread their per-user Voyage key in via `opts.voyageApiKey`;
 * absent → falls back to hosted `VOYAGE_API_KEY`.
 */

import {
  upsertFileEmbedding,
  searchFileEmbeddings,
  listEmbeddedFileKeys,
  type FileEmbeddingHit,
} from "./db";
import { embed, embedOne, embeddingsEnabled } from "./embeddings";
import { getAllEntries, type IndexEntry } from "./search-index";
import { getUserKeys } from "./byok";

const MAX_EMBED_CHARS = 2_000;   // a file's metadata is short; cap defensively
const BACKFILL_BATCH = 32;       // Voyage inputs per request during backfill

/** The text we embed for a file: its AI-analyzed description. */
export function fileEmbedText(entry: IndexEntry): string {
  return [entry.subject, entry.detail, entry.filename, entry.category, (entry.keywords ?? []).join(" ")]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" — ")
    .slice(0, MAX_EMBED_CHARS);
}

/** Embed + store one file (called from upsertEntry on every add/update). */
export async function indexFileEmbedding(userId: string, entry: IndexEntry): Promise<void> {
  // upsertEntry callers don't already have user keys; resolve here so the
  // single hook keeps a clean signature.
  const apiKey = (await getUserKeys(userId)).voyage;
  if (!embeddingsEnabled({ apiKey })) return;
  const text = fileEmbedText(entry);
  if (!text) return;
  try {
    const vec = await embedOne(text, "document", { apiKey });
    await upsertFileEmbedding({ userId, fileKey: entry.key, content: text, embedding: vec });
  } catch (err) {
    console.warn("[file-search] index skipped:", err);
  }
}

/** Semantic file search → [{ fileKey, score }]. Empty on no-Voyage / error. */
export async function searchFiles(
  userId: string,
  query: string,
  limit = 6,
  opts?: { voyageApiKey?: string },
): Promise<FileEmbeddingHit[]> {
  if (!embeddingsEnabled({ apiKey: opts?.voyageApiKey })) return [];
  try {
    const vec = await embedOne(query, "query", { apiKey: opts?.voyageApiKey });
    return await searchFileEmbeddings(userId, vec, limit);
  } catch (err) {
    console.warn("[file-search] search skipped:", err);
    return [];
  }
}

/** Embed any of a user's indexed files that aren't embedded yet. Returns count. */
export async function backfillUserFiles(userId: string): Promise<number> {
  const apiKey = (await getUserKeys(userId)).voyage;
  if (!embeddingsEnabled({ apiKey })) return 0;
  const [entries, done] = await Promise.all([getAllEntries(userId), listEmbeddedFileKeys(userId)]);
  const todo = entries.filter((e) => !done.has(e.key));
  let n = 0;
  for (let i = 0; i < todo.length; i += BACKFILL_BATCH) {
    const batch = todo.slice(i, i + BACKFILL_BATCH);
    const texts = batch.map(fileEmbedText);
    try {
      const vecs = await embed(texts, "document", { apiKey });
      await Promise.all(
        batch.map((e, j) =>
          upsertFileEmbedding({ userId, fileKey: e.key, content: texts[j], embedding: vecs[j] }),
        ),
      );
      n += batch.length;
    } catch (err) {
      console.warn("[file-search] backfill batch skipped:", err);
    }
  }
  return n;
}
