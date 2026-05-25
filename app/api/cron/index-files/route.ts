/**
 * File-embedding backfill — embeds a user's existing S3 files for semantic
 * search (new uploads are embedded on the fly via upsertEntry). Run once after
 * deploy; safe to re-run (skips files already embedded).
 *
 *   GET /api/cron/index-files[?userId=<U>]
 *
 * Auth (either): Vercel Cron `Authorization: Bearer ${CRON_SECRET}`, or manual
 * `?token=<ADMIN_TOKEN>` / header `x-admin-token`.
 */

import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";
import { backfillUserFiles } from "@/lib/file-search";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorize(req: Request, url: URL): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) return true;
  const adminToken = process.env.ADMIN_TOKEN;
  const provided = url.searchParams.get("token") ?? req.headers.get("x-admin-token");
  return !!adminToken && provided === adminToken;
}

async function listUserIds(): Promise<string[]> {
  const ids: string[] = [];
  let cont: string | undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: "users/", Delimiter: "/", ContinuationToken: cont,
    }));
    for (const p of res.CommonPrefixes ?? []) {
      const m = p.Prefix?.match(/^users\/([^/]+)\/$/);
      if (m) ids.push(m[1]);
    }
    cont = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (cont);
  return ids;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!authorize(req, url)) return new Response("Forbidden", { status: 403 });

  try {
    const single = url.searchParams.get("userId");
    const userIds = single ? [single] : await listUserIds();
    let indexed = 0;
    for (const uid of userIds) {
      try {
        indexed += await backfillUserFiles(uid);
      } catch (err) {
        console.warn(`[cron/index-files] user ${uid} failed:`, err);
      }
    }
    return Response.json({ ok: true, users: userIds.length, indexed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/index-files]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
