import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "@/lib/s3";
import { search } from "@/lib/search-index";
import type { FileItem } from "@/types/file";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    if (!q) return Response.json({ files: [], query: "" });

    const entries = await search(q);

    const files: FileItem[] = await Promise.all(
      entries.map(async (e) => {
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: BUCKET, Key: e.key }),
          { expiresIn: 3600 }
        );
        return {
          id:        e.key,
          name:      e.filename,
          size:      e.size,
          mimeType:  e.mimeType,
          url,
          createdAt: e.createdAt,
          userId:    "unknown",
        };
      })
    );

    files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return Response.json({ files, query: q, count: files.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/search]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
