import { ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  s3,
  BUCKET,
  mimeFromFilename,
  isUserOwnedKey,
  isWorkspaceOwnedKey,
  isSafeFolderId,
  isSafeWorkspaceId,
  userUploadsPrefix,
  userFolderPrefix,
  workspaceInboxPrefix,
  workspaceFolderPrefix,
} from "@/lib/s3";
import type { FileItem } from "@/types/file";
import { isAiFolderId } from "@/lib/ai-folders";
import {
  entriesByAiFolder,
  workspaceEntriesByAiFolder,
  removeEntry,
  removeWorkspaceEntry,
} from "@/lib/search-index";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { requireWorkspaceAccess, getFolderPermission } from "@/lib/workspace";
import { canDeleteFileInFolder } from "@/lib/folder-permissions";
import { invalidatePreviews } from "@/lib/previews-cache";
import { ensureWorkspaceMember } from "@/lib/workspace-access";
import { fetchUserProfile } from "@/lib/line";

/**
 * Resolve the listing scope from the request: per-user (default) or
 * workspace if `?workspaceId=` is present + the caller is a member.
 */
type Scope =
  | { kind: "user"; userId: string }
  | { kind: "workspace"; userId: string; workspaceId: string };

async function resolveScope(userId: string, workspaceIdParam: string | null): Promise<Scope> {
  if (!workspaceIdParam) return { kind: "user", userId };
  if (!isSafeWorkspaceId(workspaceIdParam)) {
    throw new AuthError(400, "Invalid workspaceId");
  }
  // Auto-join group members on deep-link click
  await ensureWorkspaceMember(workspaceIdParam, userId);
  await requireWorkspaceAccess(userId, workspaceIdParam);
  return { kind: "workspace", userId, workspaceId: workspaceIdParam };
}

async function objectsToFiles(
  scope: Scope,
  objects: { Key?: string; Size?: number; LastModified?: Date }[],
): Promise<FileItem[]> {
  // Build the strip-prefix regex once — keys under either scope share the
  // pattern `<root>/(uploads|inbox|folders/{id})/` so we can compute basename.
  const stripPrefix = scope.kind === "user"
    ? new RegExp(`^users/${scope.userId}/(uploads/|folders/[^/]+/)`)
    : new RegExp(`^workspaces/${scope.workspaceId}/(inbox/|folders/[^/]+/)`);

  return Promise.all(
    objects.filter((obj) => obj.Key && obj.Size).map(async (obj) => {
      const rawName = obj.Key!.replace(stripPrefix, "");
      const name    = rawName.replace(/^\d+-/, "");
      const url     = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key! }),
        { expiresIn: 3600 },
      );
      return {
        id:        obj.Key!,
        name,
        size:      obj.Size!,
        mimeType:  mimeFromFilename(name),
        url,
        createdAt: obj.LastModified?.toISOString() ?? new Date().toISOString(),
        userId:    scope.userId,
      };
    }),
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
    const folderId        = searchParams.get("folderId");
    const listScope       = searchParams.get("scope");
    const workspaceIdParam = searchParams.get("workspaceId");

    const scope = await resolveScope(userId, workspaceIdParam);

    // ── AI folder: virtual, list via search index ──────────────────────────
    if (folderId && isAiFolderId(folderId)) {
      const entries = scope.kind === "workspace"
        ? await workspaceEntriesByAiFolder(scope.workspaceId, folderId)
        : await entriesByAiFolder(userId, folderId);

      const files: FileItem[] = await Promise.all(
        entries.map(async (e) => {
          const url = await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: BUCKET, Key: e.key }),
            { expiresIn: 3600 },
          );

          const baseFile: FileItem = {
            id:        e.key,
            name:      e.filename,
            size:      e.size,
            mimeType:  e.mimeType,
            url,
            createdAt: e.createdAt,
            userId,
          };

          // For workspace files, fetch uploader profile if available
          if (scope.kind === "workspace" && e.uploaderId) {
            const profile = await fetchUserProfile(e.uploaderId);
            if (profile) {
              baseFile.uploaderId = e.uploaderId;
              baseFile.uploaderName = profile.displayName;
              baseFile.uploaderPictureUrl = profile.pictureUrl;
            }
          }

          return baseFile;
        }),
      );
      files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return Response.json({ files });
    }

    // ── Physical S3 listing ────────────────────────────────────────────────
    const inboxPrefix = scope.kind === "workspace"
      ? workspaceInboxPrefix(scope.workspaceId)
      : userUploadsPrefix(userId);
    const foldersRootPrefix = scope.kind === "workspace"
      ? `workspaces/${scope.workspaceId}/folders/`
      : `users/${userId}/folders/`;
    const folderPrefix = (fid: string) =>
      scope.kind === "workspace"
        ? workspaceFolderPrefix(scope.workspaceId, fid)
        : userFolderPrefix(userId, fid);

    let objects: { Key?: string; Size?: number; LastModified?: Date }[] = [];

    if (listScope === "all") {
      const [inboxRes, folderRes] = await Promise.all([
        s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: inboxPrefix })),
        s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: foldersRootPrefix })),
      ]);
      objects = [...(inboxRes.Contents ?? []), ...(folderRes.Contents ?? [])];
    } else if (folderId) {
      if (!isSafeFolderId(folderId)) {
        return Response.json({ error: "Invalid folderId" }, { status: 400 });
      }
      const res = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: folderPrefix(folderId),
      }));
      objects = res.Contents ?? [];
    } else {
      const res = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: inboxPrefix,
      }));
      objects = res.Contents ?? [];
    }

    const files = await objectsToFiles(scope, objects);
    files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return Response.json({ files });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
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
    const { key, workspaceId } = await req.json() as {
      key?: unknown;
      workspaceId?: unknown;
    };

    if (workspaceId !== undefined && workspaceId !== null && workspaceId !== "") {
      if (!isSafeWorkspaceId(workspaceId)) {
        return Response.json({ error: "Invalid workspaceId" }, { status: 400 });
      }
      const member = await requireWorkspaceAccess(userId, workspaceId);
      if (!isWorkspaceOwnedKey(key, workspaceId)) {
        return Response.json(
          { error: "Invalid key — must belong to this workspace" },
          { status: 400 },
        );
      }

      // Owners can delete anything. For members the rules depend on the
      // *folder mode* the owner set (Phase 3):
      //   read-only → no deletes
      //   upload    → only files the member uploaded themselves
      //   full      → anything in the folder
      // Workspace inbox files (no folder id in the key) behave like upload.
      //
      // Missing `uploaderId` on the index entry now denies for members —
      // closes the pre-Phase-3 bug where legacy/unindexed entries were
      // deletable by anyone.
      if (member.role !== "owner") {
        const rest = (key as string).slice(`workspaces/${workspaceId}/`.length);
        let folderId: string | null = null;
        if (rest.startsWith("folders/")) {
          const slash = rest.indexOf("/", "folders/".length);
          if (slash > "folders/".length) {
            folderId = rest.slice("folders/".length, slash);
          }
        }

        const mode = folderId
          ? await getFolderPermission(workspaceId, folderId)
          : "upload" as const;

        const { getAllWorkspaceEntries } = await import("@/lib/search-index");
        const entries = await getAllWorkspaceEntries(workspaceId);
        const entry = entries.find((e) => e.key === key);

        if (!canDeleteFileInFolder(mode, false, entry?.uploaderId, userId)) {
          return Response.json(
            { error: "You don't have permission to delete this file" },
            { status: 403 },
          );
        }
      }

      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      try { await removeWorkspaceEntry(workspaceId, key); } catch { /* ignore */ }
      invalidatePreviews(`ws:${workspaceId}`);
      return Response.json({ ok: true });
    }

    if (!isUserOwnedKey(key, userId)) {
      return Response.json(
        { error: "Invalid key — must belong to the authenticated user" },
        { status: 400 },
      );
    }
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    try { await removeEntry(userId, key); } catch { /* ignore */ }
    invalidatePreviews(workspaceId ? `ws:${workspaceId}` : userId);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/files]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
