import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  s3,
  BUCKET,
  isUserOwnedKey,
  isSafeFolderId,
  folderMetaExists,
  userUploadsPrefix,
  userFolderPrefix,
} from "@/lib/s3";
import { isAiFolderId } from "@/lib/ai-folders";
import { renameEntryKey } from "@/lib/search-index";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { invalidatePreviews } from "@/lib/previews-cache";

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const { key, targetFolderId } = await req.json() as {
      key?: unknown;
      targetFolderId?: unknown;
    };

    if (!isUserOwnedKey(key, userId)) {
      return Response.json(
        { error: "Invalid key — must belong to the authenticated user" },
        { status: 400 }
      );
    }

    const target: string | null =
      targetFolderId === null || targetFolderId === undefined
        ? null
        : isSafeFolderId(targetFolderId)
        ? targetFolderId
        : "__invalid__";
    if (target === "__invalid__") {
      return Response.json({ error: "Invalid targetFolderId" }, { status: 400 });
    }

    if (target && isAiFolderId(target)) {
      return Response.json(
        { error: "AI folders are auto-organized and cannot be used as a move destination." },
        { status: 400 }
      );
    }

    if (target && !(await folderMetaExists(userId, target))) {
      return Response.json({ error: "Target folder does not exist" }, { status: 404 });
    }

    const basename = key.split("/").pop()!;
    const newKey   = target
      ? `${userFolderPrefix(userId, target)}${basename}`
      : `${userUploadsPrefix(userId)}${basename}`;

    if (key === newKey) return Response.json({ ok: true, newKey });

    await s3.send(new CopyObjectCommand({
      Bucket:     BUCKET,
      CopySource: `${BUCKET}/${key}`,
      Key:        newKey,
    }));
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));

    try {
      await renameEntryKey(userId, key, newKey);
    } catch (idxErr) {
      console.warn("[move] search index update failed (non-fatal):", idxErr);
    }

    invalidatePreviews(userId);
    return Response.json({ ok: true, newKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/files/move]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
