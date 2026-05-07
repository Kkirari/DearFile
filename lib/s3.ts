import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectTaggingCommand,
  GetObjectTaggingCommand,
} from "@aws-sdk/client-s3";

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

/**
 * Rename an S3 object by copying to a new key then deleting the old one.
 * Preserves the folder prefix (e.g. "uploads/" or "folders/{id}/").
 * Returns the new key.
 */
export async function renameS3Object(oldKey: string, newFilename: string): Promise<string> {
  const slash = oldKey.lastIndexOf("/");
  const prefix = slash >= 0 ? oldKey.slice(0, slash + 1) : "";
  const newKey = prefix + newFilename;

  // Skip if name is unchanged
  if (oldKey === newKey) return newKey;

  await s3.send(new CopyObjectCommand({
    Bucket:     BUCKET,
    CopySource: `${BUCKET}/${oldKey}`,
    Key:        newKey,
  }));

  await s3.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key:    oldKey,
  }));

  return newKey;
}

/**
 * S3 object tags: only ASCII allowed (letters, digits, space, + - = . _ : / @).
 * Sanitize aggressively — Thai/emoji must live in the search index, not tags.
 */
function sanitizeTagValue(val: string): string {
  return val.replace(/[^a-zA-Z0-9\s+\-=._:/@]/g, "").trim().slice(0, 256);
}

export async function setS3ObjectTags(key: string, tags: Record<string, string>): Promise<void> {
  const TagSet = Object.entries(tags)
    .map(([Key, Value]) => ({ Key, Value: sanitizeTagValue(Value) }))
    .filter((t) => t.Value.length > 0);

  await s3.send(new PutObjectTaggingCommand({
    Bucket:  BUCKET,
    Key:     key,
    Tagging: { TagSet },
  }));
}

export async function getS3ObjectTags(key: string): Promise<Record<string, string>> {
  const res = await s3.send(new GetObjectTaggingCommand({ Bucket: BUCKET, Key: key }));
  const out: Record<string, string> = {};
  for (const { Key, Value } of res.TagSet ?? []) {
    if (Key && Value !== undefined) out[Key] = Value;
  }
  return out;
}

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
