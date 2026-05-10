import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET, isSafeFolderId } from "@/lib/s3";

// Extensions the app actually understands. Everything else is rejected at
// presign-time so a caller can't drop arbitrary executables into the bucket.
const ALLOWED_EXTENSIONS = new Set([
  "pdf",  "txt",
  "jpg",  "jpeg", "png", "gif", "webp", "heic",
  "mp4",  "mov",  "mp3", "m4a",
  "xlsx", "xls",  "docx", "doc",
  "zip",  "rar",
]);

const MAX_FILENAME_LEN = 200;
// Loose MIME-type sanity check — actual content-type is not enforceable on a
// presigned PUT, but we at least block weird header injections.
const MIME_RE = /^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/;

function isValidFileName(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_FILENAME_LEN) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  if (name.startsWith(".") || name.endsWith(".")) return false;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ALLOWED_EXTENSIONS.has(ext);
}

export async function POST(req: Request) {
  try {
    const { fileName, fileType, folderId } = await req.json() as {
      fileName?: unknown;
      fileType?: unknown;
      folderId?: unknown;
    };

    if (!isValidFileName(fileName)) {
      return Response.json(
        { error: "Invalid fileName — must be 1-200 chars with an allowed extension" },
        { status: 400 }
      );
    }

    if (fileType !== undefined && fileType !== "" && (typeof fileType !== "string" || !MIME_RE.test(fileType))) {
      return Response.json({ error: "Invalid fileType" }, { status: 400 });
    }

    if (folderId !== undefined && folderId !== null && !isSafeFolderId(folderId)) {
      return Response.json({ error: "Invalid folderId" }, { status: 400 });
    }

    const safeFolderId = typeof folderId === "string" && folderId.length > 0 ? folderId : null;

    const key = safeFolderId
      ? `folders/${safeFolderId}/${Date.now()}-${fileName}`
      : `uploads/${Date.now()}-${fileName}`;

    const command = new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      ContentType: typeof fileType === "string" && fileType.length > 0
        ? fileType
        : "application/octet-stream",
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    return Response.json({ uploadUrl, key });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/upload]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
