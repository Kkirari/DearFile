import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  s3,
  BUCKET,
  mimeFromFilename,
  isUserOwnedKey,
  isWorkspaceOwnedKey,
  isSafeWorkspaceId,
} from "@/lib/s3";
import type { FileItem } from "@/types/file";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/workspace";

/**
 * Resolve a single file by its S3 key into a `FileItem` with a fresh signed
 * URL. Used by the LIFF deep link (the bot's "Open" button carries `?file=…`
 * and, for shared saves, `?ws=…`) so the app can land straight on that file's
 * detail sheet without listing the whole scope.
 *
 *   GET /api/files/one?key=<key>[&workspaceId=<ws>]
 *
 * Personal keys (`users/{U}/…`) are validated against the caller; workspace
 * keys (`workspaces/{W}/…`) require membership via requireWorkspaceAccess.
 */
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
    const key             = searchParams.get("key");
    const workspaceId     = searchParams.get("workspaceId");

    if (!key) {
      return Response.json({ error: "Missing key" }, { status: 400 });
    }

    // ── Validate the key against its scope ──────────────────────────────────
    let stripPrefix: RegExp;
    if (workspaceId) {
      if (!isSafeWorkspaceId(workspaceId)) {
        return Response.json({ error: "Invalid workspaceId" }, { status: 400 });
      }
      await requireWorkspaceAccess(userId, workspaceId);
      if (!isWorkspaceOwnedKey(key, workspaceId)) {
        return Response.json({ error: "File is not in this workspace" }, { status: 403 });
      }
      stripPrefix = new RegExp(`^workspaces/${workspaceId}/(inbox/|folders/[^/]+/)`);
    } else {
      if (!isUserOwnedKey(key, userId)) {
        return Response.json({ error: "File not found" }, { status: 404 });
      }
      stripPrefix = new RegExp(`^users/${userId}/(uploads/|folders/[^/]+/)`);
    }

    // ── Head for size + mtime; 404 cleanly if it's gone ─────────────────────
    let head;
    try {
      head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch (err: unknown) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) {
        return Response.json({ error: "File not found" }, { status: 404 });
      }
      throw err;
    }

    const name = key.replace(stripPrefix, "").replace(/^\d+-/, "");
    const url  = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 3600 },
    );

    const file: FileItem = {
      id:        key,
      name,
      size:      head.ContentLength ?? 0,
      mimeType:  head.ContentType ?? mimeFromFilename(name),
      url,
      createdAt: head.LastModified?.toISOString() ?? new Date().toISOString(),
      userId,
    };

    return Response.json({ file });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/files/one]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
