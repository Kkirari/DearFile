import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "@/lib/s3";

export async function POST(req: Request) {
  try {
    const { fileName, fileType, folderId } = await req.json() as {
      fileName: string;
      fileType: string;
      folderId?: string;
    };

    const key = folderId
      ? `folders/${folderId}/${Date.now()}-${fileName}`
      : `uploads/${Date.now()}-${fileName}`;

    const command = new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      ContentType: fileType || "application/octet-stream",
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    return Response.json({ uploadUrl, key });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/upload]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
