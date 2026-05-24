/**
 * Daily summary cron — Phase 6 of the "LINE-native Second Brain".
 *
 * Runs once a day (see vercel.json crons: `0 13 * * *` = 20:00 ICT), enumerates
 * every user that has saved files, builds today's brief, and pushes it to the
 * user's LINE DM. Only users with captures today get a push — no spam, and it
 * keeps the LINE push quota down.
 *
 *   GET /api/cron/daily-summary
 *
 * Auth (either):
 *   - Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` (set CRON_SECRET
 *     in the Vercel project; without it the cron invocation is rejected 403).
 *   - Manual/dev: `?token=<ADMIN_TOKEN>` or header `x-admin-token` (reuses the
 *     existing admin token so you can fire it by hand).
 *
 * Dev/test params (require auth):
 *   - `?userId=<U>`  — only process this one user (everyone else is skipped).
 *   - `?dryRun=1`    — build + return the brief as JSON; no push, no marker.
 *   - `?force=1`     — ignore the once-a-day dedupe marker (re-send).
 *
 * Idempotency: a marker at `summary-sent/{userId}/{YYYY-MM-DD}.json` is claimed
 * with `If-None-Match: "*"` before each push so a re-run on the same day is a
 * no-op (unless `force`/`dryRun`).
 */

import { ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";
import { pushMessage, summaryBubble } from "@/lib/line";
import { buildDailySummary, ictDateLabel } from "@/lib/summary";
import { drainCaptures } from "@/lib/capture";
import { listUserIdsWithContent } from "@/lib/db";

// Long-running: one model call + one push per active user, processed in
// bounded chunks. Default function timeout is 300s; be explicit.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONCURRENCY = 5;

// ── Auth ──────────────────────────────────────────────────────────────────

function authorize(req: Request, url: URL): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return true; // Vercel Cron
  }
  const adminToken = process.env.ADMIN_TOKEN;
  const provided = url.searchParams.get("token") ?? req.headers.get("x-admin-token");
  if (adminToken && provided === adminToken) {
    return true; // manual / dev trigger
  }
  return false;
}

// ── LIFF deep link (kept in sync with the webhook's builder) ───────────────

function liffUrl(params?: { file?: string }): string {
  const id = process.env.NEXT_PUBLIC_LIFF_ID;
  const base = id ? `https://liff.line.me/${id}` : "https://line.me";
  if (!params?.file) return base;
  const qs = new URLSearchParams();
  qs.set("file", params.file);
  return `${base}?${qs.toString()}`;
}

// ── User enumeration ───────────────────────────────────────────────────────

/**
 * List every user id by reading the `users/` prefix's CommonPrefixes. There's
 * no separate user registry, so this is a prefix scan — fine at current scale;
 * swap for a maintained registry if user counts grow large.
 */
async function listUserIds(): Promise<string[]> {
  const ids: string[] = [];
  let cont: string | undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket:            BUCKET,
      Prefix:            "users/",
      Delimiter:         "/",
      ContinuationToken: cont,
    }));
    for (const p of res.CommonPrefixes ?? []) {
      const m = p.Prefix?.match(/^users\/([^/]+)\/$/);
      if (m) ids.push(m[1]);
    }
    cont = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (cont);
  return ids;
}

// ── Once-a-day dedupe marker ────────────────────────────────────────────────

function isPreconditionFailed(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "PreconditionFailed" || e.$metadata?.httpStatusCode === 412;
}

/**
 * Atomically claim today's summary for a user. Returns false if a marker
 * already exists (already sent today). On unexpected S3 errors we fail OPEN —
 * a possible duplicate brief is better than silently skipping the user.
 */
async function claimSummary(userId: string, date: string): Promise<boolean> {
  try {
    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         `summary-sent/${userId}/${date}.json`,
      Body:        JSON.stringify({ at: new Date().toISOString() }),
      ContentType: "application/json",
      IfNoneMatch:  "*",
    }));
    return true;
  } catch (err) {
    if (isPreconditionFailed(err)) return false;
    console.warn("[cron/daily-summary] marker write failed, failing open:", err);
    return true;
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!authorize(req, url)) {
    return new Response("Forbidden", { status: 403 });
  }

  const single = url.searchParams.get("userId");
  const dryRun = url.searchParams.get("dryRun") === "1";
  const force  = url.searchParams.get("force") === "1" || dryRun;
  const date   = ictDateLabel();

  // Make sure every same-day capture is processed before we synthesize the recap
  // (the durable safety net for anything the webhook's background task dropped).
  // Best-effort: a DB hiccup must not block the file-only summary.
  try {
    await drainCaptures(50);
  } catch (err) {
    console.warn("[cron/daily-summary] capture drain skipped:", err);
  }

  let userIds: string[];
  try {
    if (single) {
      userIds = [single];
    } else {
      // Union S3 file users with note/link-only users (who have no S3 prefix).
      const [fileUsers, contentUsers] = await Promise.all([
        listUserIds(),
        listUserIdsWithContent().catch(() => [] as string[]),
      ]);
      userIds = [...new Set([...fileUsers, ...contentUsers])];
    }
  } catch (err) {
    console.error("[cron/daily-summary] user enumeration failed:", err);
    return Response.json({ error: "enumeration failed" }, { status: 500 });
  }

  let scanned = 0;
  let sent = 0;
  let skipped = 0;
  let errors = 0;
  const previews: { userId: string; count: number; text: string; files: string[] }[] = [];

  for (let i = 0; i < userIds.length; i += CONCURRENCY) {
    const chunk = userIds.slice(i, i + CONCURRENCY);
    await Promise.allSettled(chunk.map(async (userId) => {
      scanned++;
      try {
        const summary = await buildDailySummary(userId);
        if (!summary) { skipped++; return; }

        if (dryRun) {
          previews.push({
            userId,
            count: summary.count,
            text:  summary.text,
            files: summary.highlights.map((e) => e.filename),
          });
          return;
        }

        if (!force) {
          const claimed = await claimSummary(userId, date);
          if (!claimed) { skipped++; return; }
        }

        const bubble = summaryBubble(
          {
            date:       summary.date,
            count:      summary.count,
            text:       summary.text,
            highlights: summary.highlights,
          },
          (e) => liffUrl({ file: e.key }),
          liffUrl(),
        );
        await pushMessage(userId, [bubble]);
        sent++;
      } catch (err) {
        errors++;
        console.error(`[cron/daily-summary] user ${userId} failed:`, err);
      }
    }));
  }

  return Response.json({
    ok: true,
    date,
    scanned,
    sent,
    skipped,
    errors,
    ...(dryRun ? { previews } : {}),
  });
}
