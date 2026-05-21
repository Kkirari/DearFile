/**
 * Batch file operations: delete or move many files in one request.
 * Used by the multi-select mode in the folder viewer. Works in personal
 * scope and (with ?workspaceId in the body) shared-workspace scope.
 */

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
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
import {
  bulkRemoveEntries,
  bulkRenameEntryKeys,
  bulkRemoveWorkspaceEntries,
  bulkRenameWorkspaceEntryKeys,
  getAllWorkspaceEntries,
} from "@/lib/search-index";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { requireWorkspaceAccess, getFolderPermission } from "@/lib/workspace";
import {
  canUploadToFolder,
  canDeleteFileInFolder,
  DEFAULT_FOLDER_MODE,
  type FolderMode,
} from "@/lib/folder-permissions";
import { invalidatePreviews } from "@/lib/previews-cache";

interface BatchRequest {
  action: "delete" | "move";
  keys: string[];
  /** Required for "move" — null = inbox */
  targetFolderId?: string | null;
  /** Present for shared-workspace operations. */
  workspaceId?: string;
}

/** workspaces/{W}/folders/{F}/file → F ; workspaces/{W}/inbox/file → null */
function folderIdFromWorkspaceKey(key: string, workspaceId: string): string | null {
  const rest = key.slice(`workspaces/${workspaceId}/`.length);
  if (!rest.startsWith("folders/")) return null;
  const slash = rest.indexOf("/", "folders/".length);
  return slash > "folders/".length ? rest.slice("folders/".length, slash) : null;
}

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const body = await req.json() as BatchRequest;
    const { action, keys, targetFolderId, workspaceId } = body;

    if (!Array.isArray(keys) || keys.length === 0) {
      return Response.json({ error: "Missing keys array" }, { status: 400 });
    }

    // ── Resolve scope ──────────────────────────────────────────────────
    const isWorkspace = workspaceId !== undefined && workspaceId !== null && (workspaceId as string) !== "";
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

    // ── Validate every key against its scope ────────────────────────────
    if (wsId) {
      if (!keys.every((k) => isWorkspaceOwnedKey(k, wsId!))) {
        return Response.json({ error: "All keys must belong to this workspace" }, { status: 400 });
      }
    } else if (!keys.every((k) => isUserOwnedKey(k, userId))) {
      return Response.json(
        { error: "All keys must belong to the authenticated user" },
        { status: 400 }
      );
    }

    // ── DELETE ───────────────────────────────────────────────────────────
    if (action === "delete") {
      let allowed = keys;
      let denied = 0;

      // Phase-3: in a workspace, members can only delete per the folder mode
      // (own files in `upload`, anything in `full`, nothing in `read-only`).
      // Owner is unrestricted.
      if (wsId && !isOwner) {
        const entries = await getAllWorkspaceEntries(wsId);
        const byKey = new Map(entries.map((e) => [e.key, e]));
        const modeCache = new Map<string | null, FolderMode>();
        const modeFor = async (folderId: string | null): Promise<FolderMode> => {
          if (folderId === null) return DEFAULT_FOLDER_MODE; // inbox = upload
          if (modeCache.has(folderId)) return modeCache.get(folderId)!;
          const m = await getFolderPermission(wsId!, folderId);
          modeCache.set(folderId, m);
          return m;
        };

        const permitted: string[] = [];
        for (const key of keys) {
          const mode = await modeFor(folderIdFromWorkspaceKey(key, wsId));
          if (canDeleteFileInFolder(mode, false, byKey.get(key)?.uploaderId, userId)) {
            permitted.push(key);
          } else {
            denied++;
          }
        }
        allowed = permitted;
      }

      if (allowed.length === 0) {
        return Response.json({ ok: true, deleted: 0, errors: 0, denied });
      }

      const objects = allowed.map((Key) => ({ Key }));
      const res = await s3.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: objects, Quiet: true },
      }));

      // Drop all index entries in one load→mutate→save instead of N.
      try {
        if (wsId) await bulkRemoveWorkspaceEntries(wsId, allowed);
        else      await bulkRemoveEntries(userId, allowed);
      } catch (idxErr) { console.warn("[batch delete] index cleanup failed:", idxErr); }

      invalidatePreviews(wsId ? `ws:${wsId}` : userId);

      const errCount = res.Errors?.length ?? 0;
      return Response.json({
        ok: true,
        deleted: allowed.length - errCount,
        errors: errCount,
        denied,
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

      // Destination existence + Phase-3 write gate.
      if (wsId) {
        if (target && !(await workspaceFolderMetaExists(wsId, target))) {
          return Response.json({ error: "Target folder does not exist in this workspace" }, { status: 404 });
        }
        if (target) {
          const mode = await getFolderPermission(wsId, target);
          if (!canUploadToFolder(mode, isOwner)) {
            return Response.json({ error: "This folder is read-only" }, { status: 403 });
          }
        }
      } else if (target && !(await folderMetaExists(userId, target))) {
        return Response.json({ error: "Target folder does not exist" }, { status: 404 });
      }

      const destPrefix = wsId
        ? (target ? workspaceFolderPrefix(wsId, target) : workspaceInboxPrefix(wsId))
        : (target ? userFolderPrefix(userId, target) : userUploadsPrefix(userId));

      let movedCount = 0;
      const errors: string[] = [];
      const successfulRenames: { oldKey: string; newKey: string }[] = [];

      for (const key of keys) {
        const basename = key.split("/").pop()!;
        const newKey   = `${destPrefix}${basename}`;
        if (key === newKey) { movedCount++; continue; }

        try {
          await s3.send(new CopyObjectCommand({
            Bucket:     BUCKET,
            CopySource: `${BUCKET}/${key}`,
            Key:        newKey,
          }));
          await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
          successfulRenames.push({ oldKey: key, newKey });
          movedCount++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${key}: ${msg}`);
        }
      }

      // One bulk index update for all successful copies — replaces N
      // load→mutate→save cycles with one.
      if (successfulRenames.length > 0) {
        try {
          if (wsId) await bulkRenameWorkspaceEntryKeys(wsId, successfulRenames);
          else      await bulkRenameEntryKeys(userId, successfulRenames);
        } catch (idxErr) { console.warn("[batch move] index update failed:", idxErr); }
        invalidatePreviews(wsId ? `ws:${wsId}` : userId);
      }

      return Response.json({ ok: true, moved: movedCount, errors });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/files/batch]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
