import { ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  s3,
  BUCKET,
  mimeFromFilename,
  isUserOwnedKey,
  isSafeFolderId,
  userUploadsPrefix,
  userFolderPrefix,
} from "@/lib/s3";
import type { FileItem } from "@/types/file";
import { isAiFolderId } from "@/lib/ai-folders";
import { entriesByAiFolder, removeEntry } from "@/lib/search-index";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { invalidatePreviews } from "@/lib/previews-cache";

async function objectsToFiles(
  userId: string,
  objects: { Key?: string; Size?: number; LastModified?: Date }[]
): Promise<FileItem[]> {
  return Promise.all(
    objects.filter((obj) => obj.Key && obj.Size).map(async (obj) => {
      // Strip `users/{userId}/(uploads/|folders/{id}/)` to get the basename
      const stripPrefix = new RegExp(`^users/${userId}/(uploads/|folders/[^/]+/)`);
      const rawName = obj.Key!.replace(stripPrefix, "");
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
        userId,
      };
    })
  );
}

export async function GET(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const { searchParams } = new URL(req.url);
    const folderId = searchParams.get("folderId");
    const scope    = searchParams.get("scope");

    // ── AI folder: virtual, list via search index ──────────────────────────
    if (folderId && isAiFolderId(folderId)) {
      const entries = await entriesByAiFolder(userId, folderId);
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
            userId,
          };
        })
      );
      files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return Response.json({ files });
    }

    // ── Physical S3 listing ────────────────────────────────────────────────
    let objects: { Key?: string; Size?: number; LastModified?: Date }[] = [];

    if (scope === "all") {
      const [uploadRes, folderRes] = await Promise.all([
        s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: userUploadsPrefix(userId) })),
        s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `users/${userId}/folders/` })),
      ]);
      objects = [...(uploadRes.Contents ?? []), ...(folderRes.Contents ?? [])];
    } else if (folderId) {
      if (!isSafeFolderId(folderId)) {
        return Response.json({ error: "Invalid folderId" }, { status: 400 });
      }
      const res = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: userFolderPrefix(userId, folderId),
      }));
      objects = res.Contents ?? [];
    } else {
      const res = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: userUploadsPrefix(userId),
      }));
      objects = res.Contents ?? [];
    }

    const files = await objectsToFiles(userId, objects);
    files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return Response.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/files]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const { key } = await req.json() as { key?: unknown };
    if (!isUserOwnedKey(key, userId)) {
      return Response.json(
        { error: "Invalid key — must belong to the authenticated user" },
        { status: 400 }
      );
    }
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    try { await removeEntry(userId, key); } catch { /* ignore */ }
    invalidatePreviews(userId);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/files]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
