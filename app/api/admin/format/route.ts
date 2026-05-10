/**
 * DEVELOPER UTILITY — wipes ALL data from the S3 bucket.
 * Deletes every object under uploads/, folders/, folder-meta/ and the
 * _search-index.json file. Irreversible.
 *
 * Triggered from the Developer section on the Profile tab.
 *
 * Gated by:
 *   1. ADMIN_TOKEN env var must be set (endpoint is 403 otherwise — safe default)
 *   2. Caller must send matching `x-admin-token` header
 */

import {
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type ObjectIdentifier,
} from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";

// Wipe both the new per-user namespace AND the legacy flat prefixes so a
// one-time format also cleans up any pre-C1-migration data lying around.
const PREFIXES_TO_WIPE = ["users/", "uploads/", "folders/", "folder-meta/"];
const STANDALONE_KEYS  = ["_search-index.json"];

async function listAllKeys(prefix: string): Promise<ObjectIdentifier[]> {
  const keys: ObjectIdentifier[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push({ Key: obj.Key });
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function deleteInBatches(keys: ObjectIdentifier[]): Promise<number> {
  if (keys.length === 0) return 0;
  let deleted = 0;

  // S3 DeleteObjects has a 1000-object batch limit
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const res = await s3.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: batch, Quiet: true },
    }));
    deleted += batch.length - (res.Errors?.length ?? 0);
    if (res.Errors?.length) {
      console.warn("[format] partial delete errors:", res.Errors);
    }
  }
  return deleted;
}

export async function POST(req: Request) {
  // Defense in depth: refuse if not configured, then verify the header.
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return Response.json(
      { error: "Format endpoint disabled — set ADMIN_TOKEN to enable" },
      { status: 403 }
    );
  }
  if (req.headers.get("x-admin-token") !== adminToken) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // 1. Collect all keys under prefixes
    const prefixed = (
      await Promise.all(PREFIXES_TO_WIPE.map(listAllKeys))
    ).flat();

    // 2. Add standalone files (search index, etc.)
    const standalone: ObjectIdentifier[] = STANDALONE_KEYS.map((Key) => ({ Key }));

    const all = [...prefixed, ...standalone];

    // 3. Delete everything
    const deleted = await deleteInBatches(all);

    console.warn(`[format] wiped ${deleted} object(s) from bucket "${BUCKET}"`);
    return Response.json({ ok: true, deleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/admin/format]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
