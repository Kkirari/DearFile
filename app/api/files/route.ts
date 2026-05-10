import { ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET, mimeFromFilename, isUserOwnedKey } from "@/lib/s3";
import type { FileItem } from "@/types/file";
import { isAiFolderId } from "@/lib/ai-folders";
import { entriesByAiFolder, removeEntry } from "@/lib/search-index";

async function objectsToFiles(
  objects: { Key?: string; Size?: number; LastModified?: Date }[]
): Promise<FileItem[]> {
  return Promise.all(
    objects.filter((obj) => obj.Key && obj.Size).map(async (obj) => {
      const rawName = obj.Key!.replace(/^(uploads\/|folders\/[^/]+\/)/, "");
      const name    = rawName.replace(/^\d+-/, "");
      const url     = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key! }),
        { expiresIn: 3600 }
      );
      return {
        id:        obj.Key!,
        name,
        size:      obj.Size!,
        mimeType:  mimeFromFilename(name),
        url,
        createdAt: obj.LastModified?.toISOString() ?? new Date().toISOString(),
        userId:    "unknown",
      };
    })
  );
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const folderId = searchParams.get("folderId");
    const scope    = searchParams.get("scope");

    // ── AI folder: virtual, list via search index ──────────────────────────
    if (folderId && isAiFolderId(folderId)) {
      const entries = await entriesByAiFolder(folderId);
      const files: FileItem[] = await Promise.all(
        entries.map(async (e) => {
          const url = await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: BUCKET, Key: e.key }),
            { expiresIn: 3600 }
          );
          return {
            id:        e.key,
            name:      e.filename,
            size:      e.size,
            mimeType:  e.mimeType,
            url,
            createdAt: e.createdAt,
            userId:    "unknown",
          };
        })
      );
      files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return Response.json({ files });
    }

    // ── Physical S3 listing (existing behavior) ────────────────────────────
    let objects: { Key?: string; Size?: number; LastModified?: Date }[] = [];

    if (scope === "all") {
      const [uploadRes, folderRes] = await Promise.all([
        s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "uploads/" })),
        s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "folders/" })),
      ]);
      objects = [...(uploadRes.Contents ?? []), ...(folderRes.Contents ?? [])];
    } else {
      const prefix = folderId ? `folders/${folderId}/` : "uploads/";
      const res    = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
      objects = res.Contents ?? [];
    }

    const files = await objectsToFiles(objects);
    files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return Response.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/files]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { key } = await req.json() as { key?: unknown };
    if (!isUserOwnedKey(key)) {
      return Response.json(
        { error: "Invalid key — must be under uploads/ or folders/{id}/" },
        { status: 400 }
      );
    }
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    // Best-effort cleanup of search index
    try { await removeEntry(key); } catch { /* ignore */ }
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/files]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
