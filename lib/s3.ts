import { S3Client } from "@aws-sdk/client-s3";

export const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  // SDK v3 ≥ 3.600 adds CRC32 checksums to presigned URLs by default.
  // "when_required" disables that so the PUT URL stays clean for browser uploads.
  requestChecksumCalculation: "when_required",
  responseChecksumValidation: "when_required",
});

export const BUCKET = process.env.AWS_BUCKET_NAME!;

/** Infer MIME type from filename extension (used when listing S3 objects) */
export function mimeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf:  "application/pdf",
    jpg:  "image/jpeg",
    jpeg: "image/jpeg",
    png:  "image/png",
    gif:  "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    mp4:  "video/mp4",
    mov:  "video/quicktime",
    mp3:  "audio/mpeg",
    m4a:  "audio/mp4",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls:  "application/vnd.ms-excel",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc:  "application/msword",
    zip:  "application/zip",
    rar:  "application/x-rar-compressed",
    txt:  "text/plain",
  };
  return map[ext] ?? "application/octet-stream";
}
