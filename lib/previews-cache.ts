/**
 * In-process per-user TTL cache for the /api/folders/previews response.
 *
 * The previews route fans out to ~N+2 S3 ListObjectsV2 calls per render
 * (one per user folder + uploads + folder-meta) plus a search-index load,
 * so caching the assembled response is a big win for warm Vercel
 * instances. Cache lives in memory; cold starts pay the full cost (fine,
 * Fluid Compute keeps instances warm).
 *
 * TTL is short so stale data after a missed-invalidation is bounded; all
 * known mutating routes call invalidate() on success so the happy path
 * stays fresh.
 */

import type { FolderPreview } from "@/types/preview";

const TTL_MS = 30_000;
const cache = new Map<string, { data: Record<string, FolderPreview>; expiresAt: number }>();

export function getCached(userId: string): Record<string, FolderPreview> | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(userId);
    return null;
  }
  return entry.data;
}

export function setCached(userId: string, data: Record<string, FolderPreview>): void {
  cache.set(userId, { data, expiresAt: Date.now() + TTL_MS });
}

export function invalidatePreviews(userId: string): void {
  cache.delete(userId);
}
