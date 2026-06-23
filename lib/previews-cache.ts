/**
 * In-process per-user/workspace TTL cache for the /api/folders/previews response.
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
 *
 * Cache key format: userId for personal, ws:workspaceId for workspace
 */

import type { FolderPreview } from "@/types/preview";

const TTL_MS = 30_000;
const cache = new Map<string, { data: Record<string, FolderPreview>; expiresAt: number }>();

export function getCached(cacheKey: string): Record<string, FolderPreview> | null {
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(cacheKey);
    return null;
  }
  return entry.data;
}

export function setCached(cacheKey: string, data: Record<string, FolderPreview>): void {
  cache.set(cacheKey, { data, expiresAt: Date.now() + TTL_MS });
}

export function invalidatePreviews(userIdOrCacheKey: string): void {
  cache.delete(userIdOrCacheKey);
}
