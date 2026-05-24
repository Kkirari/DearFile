/**
 * Per-day summary API — backs the calendar Timeline's "summary of the past".
 *
 *   GET /api/summary/day?date=YYYY-MM-DD  ->  { date, text, fileCount, itemCount }
 *                                             | { summary: null }   (empty day)
 *
 * Cost control: a recap is generated once and cached in daily_summaries, then
 * served on every view — no model call per open, and no automatic regeneration.
 *   - First view of a day with content: build once + cache.
 *   - Later views: return the cached recap. For TODAY, if new files/captures
 *     have arrived since it was generated, the response sets `stale: true` so the
 *     UI can offer a "Re-summarize" button.
 *   - `?refresh=1`: force a rebuild + overwrite the cache (the button calls this).
 * The 20:00 cron still writes the day's final version.
 *
 * Auth: LIFF Bearer (requireUserId) OR dev dual-auth ?token=<ADMIN_TOKEN>&userId=<U>
 * (same pattern as the crons, so it's testable headlessly).
 */

import { requireUserId, authErrorResponse, AuthError, isSafeUserId } from "@/lib/auth";
import { getDailySummary, upsertDailySummary } from "@/lib/db";
import { buildSummaryForDate, countDayContent, ictDateLabel } from "@/lib/summary";

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
    const refresh = url.searchParams.get("refresh") === "1";

    // Serve the cached recap (cache-forever) unless a refresh is explicitly asked.
    const cached = await getDailySummary(userId, date);
    if (cached && !refresh) {
      // Only today can gain new content; flag it so the UI can offer a re-gen.
      let stale = false;
      if (isToday) {
        const counts = await countDayContent(userId, date);
        stale = counts.fileCount !== cached.fileCount || counts.itemCount !== cached.itemCount;
      }
      return Response.json({
        date: cached.date, text: cached.text,
        fileCount: cached.fileCount, itemCount: cached.itemCount,
        stale, cached: true,
      });
    }

    // First view of this day, or an explicit refresh → generate once and persist.
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

    return Response.json({ ...record, stale: false, cached: false });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/summary/day]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
