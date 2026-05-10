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
  userFolderMetaPrefix,
  userFolderMetaKey,
  userFolderPrefix,
} from "@/lib/s3";
import type { FolderItem } from "@/types/folder";
import { AI_FOLDERS } from "@/lib/ai-folders";
import { countByAiFolder, removeEntriesByUserFolderId } from "@/lib/search-index";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { invalidatePreviews } from "@/lib/previews-cache";

export async function GET(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const metaPrefix = userFolderMetaPrefix(userId);
    const { Contents = [] } = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: metaPrefix })
    );
    const jsonKeys = Contents.filter((obj) => obj.Key?.endsWith(".json"));

    const userFolders: FolderItem[] = await Promise.all(
      jsonKeys.map(async (obj) => {
        const res  = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key! }));
        const body = await res.Body?.transformToString();
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(body ?? "{}"); } catch { meta = {}; }
        return {
          id:        meta.id as string,
          name:      meta.name as string,
          count:     0,
          updatedAt: (meta.createdAt as string) ?? new Date().toISOString(),
          owner:     "user",
        } satisfies FolderItem;
      })
    );

    // AI folders from catalog — counts pulled from search index
    let counts: Record<string, number> = {};
    try {
      counts = await countByAiFolder(userId);
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
    const { name } = await req.json() as { name?: unknown };

    if (typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
      return Response.json({ error: "Invalid name (1-100 chars)" }, { status: 400 });
    }

    const owner: "user" = "user";
    const id        = crypto.randomUUID();
    const key       = userFolderMetaKey(userId, id);
    const createdAt = new Date().toISOString();
    const meta      = { id, name: name.trim(), owner, createdAt };

    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        JSON.stringify(meta),
      ContentType: "application/json",
    }));

    invalidatePreviews(userId);

    return Response.json({
      folder: { id, name: meta.name, count: 0, updatedAt: createdAt, owner } satisfies FolderItem,
    });
  } catch (err) {
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
    const { id, name } = await req.json() as { id?: unknown; name?: unknown };

    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return Response.json({ error: "Invalid id" }, { status: 400 });
    }
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
      return Response.json({ error: "Invalid name (1-100 chars)" }, { status: 400 });
    }

    const key  = userFolderMetaKey(userId, id);
    const res  = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await res.Body?.transformToString();

    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(body ?? "{}");
      if (typeof meta !== "object" || meta === null) meta = {};
    } catch {
      return Response.json({ error: "Folder metadata is corrupted" }, { status: 422 });
    }
    meta.name = name.trim();

    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        JSON.stringify(meta),
      ContentType: "application/json",
    }));

    return Response.json({ ok: true });
  } catch (err) {
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
    const { id } = await req.json() as { id?: unknown };
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return Response.json({ error: "Invalid id" }, { status: 400 });
    }

    // Cascade — match Google Drive / OS file-manager semantics: deleting a
    // folder removes everything inside it.
    //
    // Order of operations:
    //   1. List + delete every object under the folder prefix (paginated,
    //      batched at S3's 1000-per-call limit).
    //   2. Drop search-index entries that referenced the folder. We use
    //      user_folder_id rather than re-listing because the rename flow
    //      (move) always keeps it in sync now.
    //   3. Delete the folder metadata file LAST — if step 1 or 2 fails
    //      partway, the folder stays visible so the user can retry. The
    //      reverse ordering would leave invisible orphan files.
    const folderPrefix = userFolderPrefix(userId, id);
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
      removedFromIndex = await removeEntriesByUserFolderId(userId, id);
    } catch (idxErr) {
      console.warn("[DELETE /api/folders] index cleanup failed (non-fatal):", idxErr);
    }

    await s3.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key:    userFolderMetaKey(userId, id),
    }));

    invalidatePreviews(userId);

    return Response.json({ ok: true, deletedFiles, removedFromIndex });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/folders]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
