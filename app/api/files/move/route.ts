import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET, isUserOwnedKey, isSafeFolderId, folderMetaExists } from "@/lib/s3";
import { isAiFolderId } from "@/lib/ai-folders";
import { renameEntryKey } from "@/lib/search-index";

export async function POST(req: Request) {
  try {
    const { key, targetFolderId } = await req.json() as {
      key?: unknown;
      targetFolderId?: unknown;
    };

    if (!isUserOwnedKey(key)) {
      return Response.json(
        { error: "Invalid key — must be under uploads/ or folders/{id}/" },
        { status: 400 }
      );
    }

    // null = inbox; otherwise must be a safe segment
    const target: string | null =
      targetFolderId === null || targetFolderId === undefined
        ? null
        : isSafeFolderId(targetFolderId)
        ? targetFolderId
        : "__invalid__";
    if (target === "__invalid__") {
      return Response.json({ error: "Invalid targetFolderId" }, { status: 400 });
    }

    // AI folders are virtual — files cannot physically be moved into them.
    if (target && isAiFolderId(target)) {
      return Response.json(
        { error: "AI folders are auto-organized and cannot be used as a move destination." },
        { status: 400 }
      );
    }

    // Reject moves into folders that don't exist — otherwise we silently
    // create orphan keys under folders/{ghost}/ that no UI can reach.
    if (target && !(await folderMetaExists(target))) {
      return Response.json({ error: "Target folder does not exist" }, { status: 404 });
    }

    const basename = key.split("/").pop()!;
    const newKey   = target
      ? `folders/${target}/${basename}`
      : `uploads/${basename}`;

    if (key === newKey) return Response.json({ ok: true, newKey });

    await s3.send(new CopyObjectCommand({
      Bucket:     BUCKET,
      CopySource: `${BUCKET}/${key}`,
      Key:        newKey,
    }));
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));

    // Keep search index in sync — without this, AI folder views show stale
    // keys → presigned URLs 404 because the underlying object moved.
    try {
      await renameEntryKey(key, newKey);
    } catch (idxErr) {
      console.warn("[move] search index update failed (non-fatal):", idxErr);
    }

    return Response.json({ ok: true, newKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/files/move]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
