/**
 * Batch file operations: delete or move many files in one request.
 * Used by the multi-select mode in the folder viewer.
 */

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { s3, BUCKET, isUserOwnedKey, isSafeFolderId, folderMetaExists } from "@/lib/s3";
import { isAiFolderId } from "@/lib/ai-folders";
import { removeEntry, renameEntryKey } from "@/lib/search-index";

interface BatchRequest {
  action: "delete" | "move";
  keys: string[];
  /** Required for "move" — null = inbox */
  targetFolderId?: string | null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as BatchRequest;
    const { action, keys, targetFolderId } = body;

    if (!Array.isArray(keys) || keys.length === 0) {
      return Response.json({ error: "Missing keys array" }, { status: 400 });
    }

    // Reject the whole batch if any key escapes the user-data namespace —
    // a single bad entry indicates a buggy or malicious caller; partial
    // success would be confusing.
    if (!keys.every(isUserOwnedKey)) {
      return Response.json(
        { error: "All keys must be under uploads/ or folders/{id}/" },
        { status: 400 }
      );
    }

    // ── DELETE ─────────────────────────────────────────────────────────
    if (action === "delete") {
      // S3 batch delete (max 1000 per request)
      const objects = keys.map((Key) => ({ Key }));
      const res = await s3.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: objects, Quiet: true },
      }));

      // Best-effort search index cleanup
      await Promise.all(keys.map(async (key) => {
        try { await removeEntry(key); }
        catch { /* ignore */ }
      }));

      const errCount = res.Errors?.length ?? 0;
      return Response.json({
        ok: true,
        deleted: keys.length - errCount,
        errors: errCount,
      });
    }

    // ── MOVE ───────────────────────────────────────────────────────────
    if (action === "move") {
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

      if (target && !(await folderMetaExists(target))) {
        return Response.json({ error: "Target folder does not exist" }, { status: 404 });
      }

      let movedCount = 0;
      const errors: string[] = [];

      // Sequential to keep error reporting clear (could parallelize)
      for (const key of keys) {
        const basename = key.split("/").pop()!;
        const newKey   = target
          ? `folders/${target}/${basename}`
          : `uploads/${basename}`;
        if (key === newKey) { movedCount++; continue; }

        try {
          await s3.send(new CopyObjectCommand({
            Bucket:     BUCKET,
            CopySource: `${BUCKET}/${key}`,
            Key:        newKey,
          }));
          await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
          try { await renameEntryKey(key, newKey); } catch { /* ignore */ }
          movedCount++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${key}: ${msg}`);
        }
      }

      return Response.json({ ok: true, moved: movedCount, errors });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/files/batch]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
