import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";
import { isAiFolderId } from "@/lib/ai-folders";
import { renameEntryKey } from "@/lib/search-index";

export async function POST(req: Request) {
  try {
    const { key, targetFolderId } = await req.json() as {
      key: string;
      targetFolderId: string | null;
    };

    // AI folders are virtual — files cannot physically be moved into them.
    if (targetFolderId && isAiFolderId(targetFolderId)) {
      return Response.json(
        { error: "AI folders are auto-organized and cannot be used as a move destination." },
        { status: 400 }
      );
    }

    const basename = key.split("/").pop()!;
    const newKey   = targetFolderId
      ? `folders/${targetFolderId}/${basename}`
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
