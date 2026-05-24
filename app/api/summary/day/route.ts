/**
 * Per-day summary API — backs the calendar Timeline's "summary of the past".
 *
 *   GET /api/summary/day?date=YYYY-MM-DD  ->  { date, text, fileCount, itemCount }
 *                                             | { summary: null }   (empty day)
 *
 * Cost control: every recap is cached in daily_summaries, so a model call
 * happens at most ONCE per day per user — not on every view.
 *   - Past days: cached forever (the day can't change). Built once on first tap.
 *   - Today: cached with a short TTL (SUMMARY_TODAY_TTL_MIN, default 30 min) so
 *     it picks up new same-day captures occasionally without regenerating on
 *     every open; the 20:00 cron writes the final version.
 *
 * Auth: LIFF Bearer (requireUserId) OR dev dual-auth ?token=<ADMIN_TOKEN>&userId=<U>
 * (same pattern as the crons, so it's testable headlessly).
 */

import { requireUserId, authErrorResponse, AuthError, isSafeUserId } from "@/lib/auth";
import { getDailySummary, upsertDailySummary } from "@/lib/db";
import { buildSummaryForDate, ictDateLabel } from "@/lib/summary";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// How long today's cached recap stays fresh before a re-gen is allowed.
const TODAY_TTL_MS = (Number(process.env.SUMMARY_TODAY_TTL_MIN) || 30) * 60 * 1000;

async function resolveUserId(req: Request, url: URL): Promise<string> {
  const adminToken = process.env.ADMIN_TOKEN;
  const provided = url.searchParams.get("token") ?? req.headers.get("x-admin-token");
  const uidParam = url.searchParams.get("userId");
  if (adminToken && provided === adminToken && uidParam) {
    if (!isSafeUserId(uidParam)) throw new AuthError(400, "Invalid userId");
    return uidParam;
  }
  return requireUserId(req);
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  let userId: string;
  try {
    userId = await resolveUserId(req, url);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const date = url.searchParams.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: "Invalid date (expected YYYY-MM-DD)" }, { status: 400 });
    }

    const today = ictDateLabel();
    if (date > today) return Response.json({ summary: null }); // no future days

    const isToday = date === today;

    // Serve the cached recap when it's still valid: past days never change, and
    // today is valid while within the TTL window. Avoids a model call per view.
    const cached = await getDailySummary(userId, date);
    if (cached) {
      const fresh = !isToday || Date.now() - Date.parse(cached.createdAt) < TODAY_TTL_MS;
      if (fresh) {
        return Response.json({
          date: cached.date, text: cached.text,
          fileCount: cached.fileCount, itemCount: cached.itemCount, cached: true,
        });
      }
    }

    // Cache miss / stale today → generate once and persist.
    const built = await buildSummaryForDate(userId, date);
    if (!built) return Response.json({ summary: null });

    const record = {
      date,
      text:      built.text,
      fileCount: built.captures.length,
      itemCount: built.count - built.captures.length,
    };
    try {
      await upsertDailySummary({ userId, ...record });
    } catch (err) {
      console.warn("[GET /api/summary/day] persist failed:", err);
    }

    return Response.json({ ...record, cached: false });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/summary/day]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
