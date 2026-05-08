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
import { s3, BUCKET, mimeFromFilename } from "@/lib/s3";
import { AI_FOLDERS } from "@/lib/ai-folders";
import { getAllEntries } from "@/lib/search-index";

const PREVIEW_COUNT = 4;
const URL_TTL = 3600;

interface PreviewItem {
  url: string;
  isImage: boolean;
  mimeType: string;
}

interface FolderPreview {
  total: number;
  thumbnails: PreviewItem[];
}

async function listFolderPreviews(prefix: string): Promise<{ items: { Key: string; Size?: number }[]; total: number }> {
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  }));
  const objects = (res.Contents ?? []).filter((o) => o.Key && (o.Size ?? 0) > 0);
  // Sort newest first using LastModified
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

export async function GET() {
  try {
    const previews: Record<string, FolderPreview> = {};

    // ── Inbox (uploads/) ──────────────────────────────────────────────
    {
      const { items, total } = await listFolderPreviews("uploads/");
      const thumbs = await Promise.all(items.map((it) => previewItemFromKey(it.Key)));
      previews["inbox"] = { total, thumbnails: thumbs };
    }

    // ── User folders (folders/{uuid}/) ────────────────────────────────
    // List the folder-meta/ prefix to get folder IDs, then preview each
    const metaRes = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: "folder-meta/",
    }));
    const folderIds = (metaRes.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => !!k && k.endsWith(".json"))
      .map((k) => k.replace("folder-meta/", "").replace(".json", ""));

    await Promise.all(folderIds.map(async (id) => {
      const { items, total } = await listFolderPreviews(`folders/${id}/`);
      const thumbs = await Promise.all(items.map((it) => previewItemFromKey(it.Key)));
      previews[id] = { total, thumbnails: thumbs };
    }));

    // ── AI folders (virtual — query search index) ─────────────────────
    try {
      const allEntries = await getAllEntries();
      // Group by ai_folder_id, sort by createdAt desc
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

    return Response.json({ previews });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/folders/previews]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
