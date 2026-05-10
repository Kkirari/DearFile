import {
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";
import type { FolderItem } from "@/types/folder";
import { AI_FOLDERS } from "@/lib/ai-folders";
import { countByAiFolder } from "@/lib/search-index";

const PREFIX = "folder-meta/";

export async function GET() {
  try {
    // User folders (stored as JSON metadata files)
    const { Contents = [] } = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX })
    );
    const jsonKeys = Contents.filter((obj) => obj.Key?.endsWith(".json"));

    const userFolders: FolderItem[] = await Promise.all(
      jsonKeys.map(async (obj) => {
        const res  = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key! }));
        const body = await res.Body?.transformToString();
        const meta = JSON.parse(body ?? "{}");
        return {
          id:        meta.id,
          name:      meta.name,
          count:     0,
          updatedAt: meta.createdAt,
          owner:     meta.owner ?? "user",
        } satisfies FolderItem;
      })
    );

    // AI folders from catalog — counts pulled from search index
    let counts: Record<string, number> = {};
    try {
      counts = await countByAiFolder();
    } catch (err) {
      console.warn("[folders] index count failed:", err);
    }

    const aiFoldersList: FolderItem[] = AI_FOLDERS
      .filter((f) => (counts[f.id] ?? 0) > 0) // hide empty AI folders
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
  try {
    const { name } = await req.json() as { name?: unknown };

    if (typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
      return Response.json({ error: "Invalid name (1-100 chars)" }, { status: 400 });
    }

    // owner is server-controlled — clients cannot create AI-owned folders.
    const owner: "user" = "user";
    const id        = crypto.randomUUID();
    const key       = `${PREFIX}${id}.json`;
    const createdAt = new Date().toISOString();
    const meta      = { id, name: name.trim(), owner, createdAt };

    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        JSON.stringify(meta),
      ContentType: "application/json",
    }));

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
  try {
    const { id, name } = await req.json() as { id?: unknown; name?: unknown };

    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return Response.json({ error: "Invalid id" }, { status: 400 });
    }
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
      return Response.json({ error: "Invalid name (1-100 chars)" }, { status: 400 });
    }

    const key  = `${PREFIX}${id}.json`;
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
  try {
    const { id } = await req.json() as { id?: unknown };
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return Response.json({ error: "Invalid id" }, { status: 400 });
    }
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}${id}.json` }));
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/folders]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
