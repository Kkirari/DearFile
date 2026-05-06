import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";

export async function POST(req: Request) {
  try {
    const { key, targetFolderId } = await req.json() as {
      key: string;
      targetFolderId: string | null;
    };

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

    return Response.json({ ok: true, newKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/files/move]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
