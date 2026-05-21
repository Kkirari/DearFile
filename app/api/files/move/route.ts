import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  s3,
  BUCKET,
  isUserOwnedKey,
  isWorkspaceOwnedKey,
  isSafeFolderId,
  isSafeWorkspaceId,
  folderMetaExists,
  workspaceFolderMetaExists,
  userUploadsPrefix,
  userFolderPrefix,
  workspaceInboxPrefix,
  workspaceFolderPrefix,
} from "@/lib/s3";
import { isAiFolderId } from "@/lib/ai-folders";
import { renameEntryKey, renameWorkspaceEntryKey } from "@/lib/search-index";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { requireWorkspaceAccess, getFolderPermission } from "@/lib/workspace";
import { canUploadToFolder } from "@/lib/folder-permissions";
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
    const { key, targetFolderId, workspaceId } = await req.json() as {
      key?: unknown;
      targetFolderId?: unknown;
      workspaceId?: unknown;
    };

    // ── Resolve scope ──────────────────────────────────────────────────
    const isWorkspace = workspaceId !== undefined && workspaceId !== null && workspaceId !== "";
    let wsId: string | null = null;
    let isOwner = false;
    if (isWorkspace) {
      if (!isSafeWorkspaceId(workspaceId)) {
        return Response.json({ error: "Invalid workspaceId" }, { status: 400 });
      }
      const member = await requireWorkspaceAccess(userId, workspaceId);
      wsId = workspaceId;
      isOwner = member.role === "owner";
    }

    // ── Validate the source key against its scope ───────────────────────
    if (wsId) {
      if (!isWorkspaceOwnedKey(key, wsId)) {
        return Response.json({ error: "Invalid key for this workspace" }, { status: 400 });
      }
    } else if (!isUserOwnedKey(key, userId)) {
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

    // ── Destination existence + permission ──────────────────────────────
    if (wsId) {
      if (target && !(await workspaceFolderMetaExists(wsId, target))) {
        return Response.json({ error: "Target folder does not exist in this workspace" }, { status: 404 });
      }
      // Phase-3: a member can't move files into a read-only folder. Inbox
      // (target null) always behaves like `upload`. Owner is unrestricted.
      if (target) {
        const mode = await getFolderPermission(wsId, target);
        if (!canUploadToFolder(mode, isOwner)) {
          return Response.json({ error: "This folder is read-only" }, { status: 403 });
        }
      }
    } else if (target && !(await folderMetaExists(userId, target))) {
      return Response.json({ error: "Target folder does not exist" }, { status: 404 });
    }

    // ── Compute destination key ─────────────────────────────────────────
    const basename = (key as string).split("/").pop()!;
    const newKey = wsId
      ? (target ? `${workspaceFolderPrefix(wsId, target)}${basename}` : `${workspaceInboxPrefix(wsId)}${basename}`)
      : (target ? `${userFolderPrefix(userId, target)}${basename}` : `${userUploadsPrefix(userId)}${basename}`);

    if (key === newKey) return Response.json({ ok: true, newKey });

    await s3.send(new CopyObjectCommand({
      Bucket:     BUCKET,
      CopySource: `${BUCKET}/${key as string}`,
      Key:        newKey,
    }));
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key as string }));

    try {
      if (wsId) await renameWorkspaceEntryKey(wsId, key as string, newKey);
      else      await renameEntryKey(userId, key as string, newKey);
    } catch (idxErr) {
      console.warn("[move] search index update failed (non-fatal):", idxErr);
    }

    invalidatePreviews(wsId ? `ws:${wsId}` : userId);
    return Response.json({ ok: true, newKey });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/files/move]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
