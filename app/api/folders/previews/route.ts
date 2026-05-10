/**
 * Batch folder previews — returns the first 4 file thumbnails for every folder
 * (user folders + AI folders + inbox) in one request.
 *
 * Used by the FolderCard mosaic. Avoids N+1 fetches when rendering 12+ folders.
 */

import {
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  s3,
  BUCKET,
  mimeFromFilename,
  userUploadsPrefix,
  userFolderPrefix,
  userFolderMetaPrefix,
} from "@/lib/s3";
import { AI_FOLDERS } from "@/lib/ai-folders";
import { getAllEntries } from "@/lib/search-index";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { getCached, setCached } from "@/lib/previews-cache";
import type { PreviewItem, FolderPreview } from "@/types/preview";

const PREVIEW_COUNT = 4;
const URL_TTL = 3600;

async function listFolderPreviews(prefix: string): Promise<{ items: { Key: string; Size?: number }[]; total: number }> {
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  }));
  const objects = (res.Contents ?? []).filter((o) => o.Key && (o.Size ?? 0) > 0);
  objects.sort((a, b) => {
    const ad = a.LastModified ? new Date(a.LastModified).getTime() : 0;
    const bd = b.LastModified ? new Date(b.LastModified).getTime() : 0;
    return bd - ad;
  });
  return {
    items: objects.slice(0, PREVIEW_COUNT).map((o) => ({ Key: o.Key!, Size: o.Size })),
    total: objects.length,
  };
}

async function previewItemFromKey(key: string): Promise<PreviewItem> {
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: URL_TTL }
  );
  const filename = key.split("/").pop() ?? key;
  const mimeType = mimeFromFilename(filename);
  return { url, isImage: mimeType.startsWith("image/"), mimeType };
}

export async function GET(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  // Fast path — serve from in-process cache when warm. Mutating routes
  // call invalidatePreviews so the cache stays fresh on the happy path.
  const cached = getCached(userId);
  if (cached) {
    return Response.json({ previews: cached });
  }

  try {
    const previews: Record<string, FolderPreview> = {};

    // ── Inbox (uploads/) ──────────────────────────────────────────────
    {
      const { items, total } = await listFolderPreviews(userUploadsPrefix(userId));
      const thumbs = await Promise.all(items.map((it) => previewItemFromKey(it.Key)));
      previews["inbox"] = { total, thumbnails: thumbs };
    }

    // ── User folders ──────────────────────────────────────────────────
    const metaRes = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: userFolderMetaPrefix(userId),
    }));
    const folderIds = (metaRes.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => !!k && k.endsWith(".json"))
      .map((k) => k.replace(userFolderMetaPrefix(userId), "").replace(".json", ""));

    await Promise.all(folderIds.map(async (id) => {
      const { items, total } = await listFolderPreviews(userFolderPrefix(userId, id));
      const thumbs = await Promise.all(items.map((it) => previewItemFromKey(it.Key)));
      previews[id] = { total, thumbnails: thumbs };
    }));

    // ── AI folders (virtual — query search index) ─────────────────────
    try {
      const allEntries = await getAllEntries(userId);
      const byAi: Record<string, typeof allEntries> = {};
      for (const e of allEntries) {
        (byAi[e.ai_folder_id] ??= []).push(e);
      }
      for (const aiId of Object.keys(byAi)) {
        byAi[aiId].sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }

      await Promise.all(AI_FOLDERS.map(async (f) => {
        const entries = byAi[f.id] ?? [];
        const top = entries.slice(0, PREVIEW_COUNT);
        const thumbs = await Promise.all(top.map((e) => previewItemFromKey(e.key)));
        previews[f.id] = { total: entries.length, thumbnails: thumbs };
      }));
    } catch (err) {
      console.warn("[folder previews] AI folder fetch failed:", err);
    }

    setCached(userId, previews);
    return Response.json({ previews });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/folders/previews]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
