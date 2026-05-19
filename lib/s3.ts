import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
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
  // "WHEN_REQUIRED" disables that so the PUT URL stays clean for browser uploads.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
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

// ── Per-user prefix layout ────────────────────────────────────────────────
//
// Every object owned by user U lives under `users/{U}/...`:
//
//   users/{U}/uploads/{ts}-{name}            — inbox
//   users/{U}/folders/{folderId}/{ts}-{name} — file inside a folder
//   users/{U}/folder-meta/{folderId}.json    — folder metadata
//   users/{U}/_search-index.json             — that user's search index
//   users/{U}/_workspaces.json               — denormalized list of shared
//                                              workspaces this user belongs
//                                              to (Phase 1 of group sharing)
//
// All client-supplied keys, ids, and folder ids are validated before being
// composed into a path so the namespace can't be escaped.

export function userPrefix(userId: string): string {
  return `users/${userId}/`;
}
export function userUploadsPrefix(userId: string): string {
  return `users/${userId}/uploads/`;
}
export function userFoldersPrefix(userId: string): string {
  return `users/${userId}/folders/`;
}
export function userFolderPrefix(userId: string, folderId: string): string {
  return `users/${userId}/folders/${folderId}/`;
}
export function userFolderMetaPrefix(userId: string): string {
  return `users/${userId}/folder-meta/`;
}
export function userFolderMetaKey(userId: string, folderId: string): string {
  return `users/${userId}/folder-meta/${folderId}.json`;
}
export function userSearchIndexKey(userId: string): string {
  return `users/${userId}/_search-index.json`;
}
export function userWorkspacesIndexKey(userId: string): string {
  return `users/${userId}/_workspaces.json`;
}

// ── Shared-workspace prefix layout ────────────────────────────────────────
//
// A workspace is a multi-member container that mirrors the per-user layout
// but uses `workspaces/{workspaceId}/...` instead. Same physical shape;
// access is gated by membership in the workspace's `_meta.json`.
//
//   workspaces/{W}/inbox/{ts}-{name}              — shared inbox
//   workspaces/{W}/folders/{folderId}/{ts}-{name} — file in shared folder
//   workspaces/{W}/folder-meta/{folderId}.json    — folder metadata
//   workspaces/{W}/_search-index.json             — workspace search index
//   workspaces/{W}/_meta.json                     — name, owner, members,
//                                                    optional lineGroupId

export function workspacePrefix(workspaceId: string): string {
  return `workspaces/${workspaceId}/`;
}
export function workspaceInboxPrefix(workspaceId: string): string {
  return `workspaces/${workspaceId}/inbox/`;
}
export function workspaceFoldersPrefix(workspaceId: string): string {
  return `workspaces/${workspaceId}/folders/`;
}
export function workspaceFolderPrefix(workspaceId: string, folderId: string): string {
  return `workspaces/${workspaceId}/folders/${folderId}/`;
}
export function workspaceFolderMetaPrefix(workspaceId: string): string {
  return `workspaces/${workspaceId}/folder-meta/`;
}
export function workspaceFolderMetaKey(workspaceId: string, folderId: string): string {
  return `workspaces/${workspaceId}/folder-meta/${folderId}.json`;
}
export function workspaceSearchIndexKey(workspaceId: string): string {
  return `workspaces/${workspaceId}/_search-index.json`;
}
export function workspaceMetaKey(workspaceId: string): string {
  return `workspaces/${workspaceId}/_meta.json`;
}

/**
 * Workspace ids are server-generated kebab-style ids (`ws_<random>`). Same
 * safety rules as folder ids — no slashes, no traversal — but with a
 * required `ws_` prefix so we can tell them apart from anything else.
 */
export function isSafeWorkspaceId(id: unknown): id is string {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return false;
  return /^ws_[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * True only for keys that are inside the given user's data namespace
 * (`users/{userId}/uploads/...` or `users/{userId}/folders/{id}/...`).
 * Rejects empty keys, path traversal, and other users' keys. Use this on
 * every client-supplied key before any S3 mutation.
 */
export function isUserOwnedKey(key: unknown, userId: string): key is string {
  if (typeof key !== "string" || key.length === 0) return false;
  if (key.includes("..") || key.includes("//")) return false;
  const expected = `users/${userId}/`;
  if (!key.startsWith(expected)) return false;
  const rest = key.slice(expected.length);
  if (rest.startsWith("uploads/")) return rest.length > "uploads/".length;
  return /^folders\/[^/]+\/.+/.test(rest);
}

/**
 * True only for keys that are inside the given workspace's data namespace
 * (`workspaces/{workspaceId}/inbox/...` or `.../folders/{id}/...`).
 * Same defense as isUserOwnedKey — call before any S3 mutation that uses a
 * client-supplied key under a workspace. Note: membership is checked
 * separately via requireWorkspaceAccess; this only validates path shape.
 */
export function isWorkspaceOwnedKey(key: unknown, workspaceId: string): key is string {
  if (typeof key !== "string" || key.length === 0) return false;
  if (key.includes("..") || key.includes("//")) return false;
  if (!isSafeWorkspaceId(workspaceId)) return false;
  const expected = `workspaces/${workspaceId}/`;
  if (!key.startsWith(expected)) return false;
  const rest = key.slice(expected.length);
  if (rest.startsWith("inbox/")) return rest.length > "inbox/".length;
  return /^folders\/[^/]+\/.+/.test(rest);
}

/**
 * True if `folderId` exists for `userId` — i.e. its metadata file lives in
 * the user's folder-meta/ prefix. Use before constructing a destination key
 * on move so callers cannot create files in ghost (or other users') folders.
 */
export async function folderMetaExists(userId: string, folderId: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({
      Bucket: BUCKET,
      Key:    userFolderMetaKey(userId, folderId),
    }));
    return true;
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

/**
 * Workspace-variant of folderMetaExists — checks `workspaces/{W}/folder-meta/`.
 */
export async function workspaceFolderMetaExists(
  workspaceId: string,
  folderId: string,
): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({
      Bucket: BUCKET,
      Key:    workspaceFolderMetaKey(workspaceId, folderId),
    }));
    return true;
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

/**
 * True only for folder ids that are safe to use as a path segment
 * (no `/`, no `..`, no leading dot). Use before constructing keys from
 * client-supplied folder ids.
 */
export function isSafeFolderId(id: unknown): id is string {
  if (typeof id !== "string" || id.length === 0) return false;
  return /^[a-zA-Z0-9_-]+$/.test(id);
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
