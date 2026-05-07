/**
 * DEVELOPER UTILITY — wipes ALL data from the S3 bucket.
 * Deletes every object under uploads/, folders/, folder-meta/ and the
 * _search-index.json file. Irreversible.
 *
 * Triggered from the Developer section on the Profile tab.
 */

import {
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type ObjectIdentifier,
} from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";

const PREFIXES_TO_WIPE = ["uploads/", "folders/", "folder-meta/"];
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

export async function POST() {
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
