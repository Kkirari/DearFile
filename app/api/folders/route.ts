import {
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  type ObjectIdentifier,
} from "@aws-sdk/client-s3";
import {
  s3,
  BUCKET,
  isSafeWorkspaceId,
  userFolderMetaPrefix,
  userFolderMetaKey,
  userFolderPrefix,
  workspaceFolderMetaPrefix,
  workspaceFolderMetaKey,
  workspaceFolderPrefix,
} from "@/lib/s3";
import type { FolderItem } from "@/types/folder";
import { AI_FOLDERS } from "@/lib/ai-folders";
import {
  countByAiFolder,
  countWorkspaceByAiFolder,
  removeEntriesByUserFolderId,
  removeWorkspaceEntriesByFolderId,
} from "@/lib/search-index";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { requireWorkspaceAccess, type WorkspaceMember } from "@/lib/workspace";
import { invalidatePreviews } from "@/lib/previews-cache";
import {
  type FolderMode,
  DEFAULT_FOLDER_MODE,
  isFolderMode,
  canChangeFolderMode,
} from "@/lib/folder-permissions";

/**
 * Per-route scope helper. If `?workspaceId=` or `workspaceId` body field is
 * present + the caller is a member, returns workspace scope; otherwise
 * defaults to per-user.
 *
 * For workspace ops we also enforce `minRole` — folder create/delete are
 * member-allowed in Phase 1, but a future viewer role would block here.
 */
type Scope =
  | { kind: "user"; userId: string }
  | { kind: "workspace"; userId: string; workspaceId: string; member: WorkspaceMember };

async function resolveScope(
  userId: string,
  workspaceIdInput: unknown,
): Promise<Scope> {
  if (workspaceIdInput === undefined || workspaceIdInput === null || workspaceIdInput === "") {
    return { kind: "user", userId };
  }
  if (!isSafeWorkspaceId(workspaceIdInput)) {
    throw new AuthError(400, "Invalid workspaceId");
  }
  const member = await requireWorkspaceAccess(userId, workspaceIdInput);
  return { kind: "workspace", userId, workspaceId: workspaceIdInput, member };
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
    const workspaceIdParam = new URL(req.url).searchParams.get("workspaceId");
    const scope = await resolveScope(userId, workspaceIdParam);

    const metaPrefix = scope.kind === "workspace"
      ? workspaceFolderMetaPrefix(scope.workspaceId)
      : userFolderMetaPrefix(userId);

    const { Contents = [] } = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: metaPrefix }),
    );
    const jsonKeys = Contents.filter((obj) => obj.Key?.endsWith(".json"));

    const userFolders: FolderItem[] = await Promise.all(
      jsonKeys.map(async (obj) => {
        const res  = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key! }));
        const body = await res.Body?.transformToString();
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(body ?? "{}"); } catch { meta = {}; }
        const item: FolderItem = {
          id:        meta.id as string,
          name:      meta.name as string,
          count:     0,
          updatedAt: (meta.createdAt as string) ?? new Date().toISOString(),
          owner:     "user",
        };
        if (scope.kind === "workspace") {
          const permissions = meta.permissions as { mode?: unknown } | undefined;
          item.mode = isFolderMode(permissions?.mode) ? permissions!.mode as FolderMode : DEFAULT_FOLDER_MODE;
        }
        return item;
      }),
    );

    // AI folders from catalog — counts pulled from search index
    let counts: Record<string, number> = {};
    try {
      counts = scope.kind === "workspace"
        ? await countWorkspaceByAiFolder(scope.workspaceId)
        : await countByAiFolder(userId);
    } catch (err) {
      console.warn("[folders] index count failed:", err);
    }

    const aiFoldersList: FolderItem[] = AI_FOLDERS
      .filter((f) => (counts[f.id] ?? 0) > 0)
      .map((f) => ({
        id:        f.id,
        name:      f.name,
        count:     counts[f.id] ?? 0,
        updatedAt: new Date().toISOString(),
        owner:     "ai",
      }));

    const folders = [...userFolders, ...aiFoldersList];
    folders.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return Response.json({ folders });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/folders]", message);
    return Response.json({ error: message }, { status: 500 });
  }
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
    const { name, workspaceId, mode } = await req.json() as {
      name?: unknown;
      workspaceId?: unknown;
      mode?: unknown;
    };
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
      return Response.json({ error: "Invalid name (1-100 chars)" }, { status: 400 });
    }
    if (mode !== undefined && mode !== null && !isFolderMode(mode)) {
      return Response.json({ error: "Invalid mode" }, { status: 400 });
    }

    const scope = await resolveScope(userId, workspaceId);
    const owner: "user" = "user";
    const id        = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // Determine the persisted mode. Only workspace owners can pick a
    // non-default mode on create; everyone else (members, personal scope)
    // gets `upload`. We persist the field on every workspace folder so the
    // shape is consistent and `getFolderPermission` doesn't have to guess
    // between "legacy folder" and "owner explicitly chose upload".
    let folderMode: FolderMode = DEFAULT_FOLDER_MODE;
    if (scope.kind === "workspace" && isFolderMode(mode) && scope.member.role === "owner") {
      folderMode = mode;
    }

    const meta: Record<string, unknown> = {
      id,
      name: name.trim(),
      owner,
      createdAt,
      createdBy: userId,
    };
    if (scope.kind === "workspace") {
      meta.permissions = { mode: folderMode };
    }

    const key = scope.kind === "workspace"
      ? workspaceFolderMetaKey(scope.workspaceId, id)
      : userFolderMetaKey(userId, id);

    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        JSON.stringify(meta),
      ContentType: "application/json",
    }));

    if (scope.kind === "user") invalidatePreviews(userId);

    const folderItem: FolderItem = {
      id,
      name: name.trim(),
      count: 0,
      updatedAt: createdAt,
      owner,
    };
    if (scope.kind === "workspace") folderItem.mode = folderMode;

    return Response.json({ folder: folderItem });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/folders]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const { id, name, mode, workspaceId } = await req.json() as {
      id?: unknown;
      name?: unknown;
      mode?: unknown;
      workspaceId?: unknown;
    };

    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return Response.json({ error: "Invalid id" }, { status: 400 });
    }

    const hasName = name !== undefined && name !== null;
    const hasMode = mode !== undefined && mode !== null;

    if (hasName && (typeof name !== "string" || name.trim().length === 0 || name.length > 100)) {
      return Response.json({ error: "Invalid name (1-100 chars)" }, { status: 400 });
    }
    if (hasMode && !isFolderMode(mode)) {
      return Response.json({ error: "Invalid mode" }, { status: 400 });
    }
    if (!hasName && !hasMode) {
      return Response.json({ error: "Provide name or mode" }, { status: 400 });
    }

    const scope = await resolveScope(userId, workspaceId);

    // Mode changes are owner-only and only meaningful in a workspace.
    if (hasMode) {
      if (scope.kind !== "workspace") {
        return Response.json(
          { error: "Folder mode is only valid inside a workspace" },
          { status: 400 },
        );
      }
      if (!canChangeFolderMode(scope.member.role === "owner")) {
        return Response.json(
          { error: "Only the workspace owner can change folder permissions" },
          { status: 403 },
        );
      }
    }

    const key = scope.kind === "workspace"
      ? workspaceFolderMetaKey(scope.workspaceId, id)
      : userFolderMetaKey(userId, id);

    const res  = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await res.Body?.transformToString();

    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(body ?? "{}");
      if (typeof meta !== "object" || meta === null) meta = {};
    } catch {
      return Response.json({ error: "Folder metadata is corrupted" }, { status: 422 });
    }

    if (hasName) meta.name = (name as string).trim();
    if (hasMode) meta.permissions = { ...(meta.permissions as object ?? {}), mode };

    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        JSON.stringify(meta),
      ContentType: "application/json",
    }));

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /api/folders]", message);
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
    const { id, workspaceId } = await req.json() as {
      id?: unknown;
      workspaceId?: unknown;
    };
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return Response.json({ error: "Invalid id" }, { status: 400 });
    }

    // For workspaces, folder delete is owner-only (members can't delete a
    // shared folder that other people use).
    let scope: Scope;
    if (workspaceId !== undefined && workspaceId !== null && workspaceId !== "") {
      if (!isSafeWorkspaceId(workspaceId)) {
        return Response.json({ error: "Invalid workspaceId" }, { status: 400 });
      }
      const member = await requireWorkspaceAccess(userId, workspaceId, "owner");
      scope = { kind: "workspace", userId, workspaceId, member };
    } else {
      scope = { kind: "user", userId };
    }

    const folderPrefix = scope.kind === "workspace"
      ? workspaceFolderPrefix(scope.workspaceId, id)
      : userFolderPrefix(userId, id);

    // Cascade — match Google Drive / OS file-manager semantics: deleting a
    // folder removes everything inside it.
    const objectKeys: ObjectIdentifier[] = [];
    let continuationToken: string | undefined;
    do {
      const list = await s3.send(new ListObjectsV2Command({
        Bucket:            BUCKET,
        Prefix:            folderPrefix,
        ContinuationToken: continuationToken,
      }));
      for (const o of list.Contents ?? []) {
        if (o.Key) objectKeys.push({ Key: o.Key });
      }
      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);

    let deletedFiles = 0;
    for (let i = 0; i < objectKeys.length; i += 1000) {
      const batch = objectKeys.slice(i, i + 1000);
      const res = await s3.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: batch, Quiet: true },
      }));
      deletedFiles += batch.length - (res.Errors?.length ?? 0);
      if (res.Errors?.length) {
        console.warn("[DELETE /api/folders] batch had errors:", res.Errors);
      }
    }

    let removedFromIndex = 0;
    try {
      removedFromIndex = scope.kind === "workspace"
        ? await removeWorkspaceEntriesByFolderId(scope.workspaceId, id)
        : await removeEntriesByUserFolderId(userId, id);
    } catch (idxErr) {
      console.warn("[DELETE /api/folders] index cleanup failed (non-fatal):", idxErr);
    }

    await s3.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key:    scope.kind === "workspace"
        ? workspaceFolderMetaKey(scope.workspaceId, id)
        : userFolderMetaKey(userId, id),
    }));

    if (scope.kind === "user") invalidatePreviews(userId);

    return Response.json({ ok: true, deletedFiles, removedFromIndex });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/folders]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
