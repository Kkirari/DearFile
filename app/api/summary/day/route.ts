/**
 * Per-day summary API — backs the calendar Timeline's "summary of the past".
 *
 *   GET /api/summary/day?date=YYYY-MM-DD  ->  { date, text, fileCount, itemCount }
 *                                             | { summary: null }   (empty day)
 *
 * Today's recap is built live (the 20:00 cron writes the final version, so we
 * don't freeze a half-finished day). Past days are read from daily_summaries;
 * if missing, generated once (Haiku) and cached so the next tap is instant.
 *
 * Auth: LIFF Bearer (requireUserId) OR dev dual-auth ?token=<ADMIN_TOKEN>&userId=<U>
 * (same pattern as the crons, so it's testable headlessly).
 */

import { requireUserId, authErrorResponse, AuthError, isSafeUserId } from "@/lib/auth";
import { getDailySummary, upsertDailySummary } from "@/lib/db";
import { buildSummaryForDate, ictDateLabel } from "@/lib/summary";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

    // Past day: serve the cached recap if we have one.
    if (!isToday) {
      const cached = await getDailySummary(userId, date);
      if (cached) return Response.json(cached);
    }

    const built = await buildSummaryForDate(userId, date);
    if (!built) return Response.json({ summary: null });

    const record = {
      date,
      text:      built.text,
      fileCount: built.captures.length,
      itemCount: built.count - built.captures.length,
    };

    // Cache past days; leave today to the 20:00 cron (it's still changing).
    if (!isToday) {
      try {
        await upsertDailySummary({ userId, ...record });
      } catch (err) {
        console.warn("[GET /api/summary/day] persist failed:", err);
      }
    }

    return Response.json(record);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/summary/day]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
