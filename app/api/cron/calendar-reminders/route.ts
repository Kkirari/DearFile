/**
 * Calendar reminders cron — checks every 10 minutes for due events and sends
 * LINE push notifications.
 *
 * NOT SCHEDULED. The 10-minute cadence this needs (`*` `/10 * * * *`) is a Pro
 * feature — Vercel Hobby allows daily crons only, and leaving it in vercel.json
 * made every deploy fail config validation. The entry was removed so deploys can
 * land; adding events and viewing the calendar still work, only the automatic
 * push reminder is off.
 *
 * Still callable by hand while it's dormant:
 *   GET /api/cron/calendar-reminders?token=<ADMIN_TOKEN>
 *
 * To re-enable: put the entry back in vercel.json (needs Pro), or point an
 * external scheduler at the URL above.
 *
 *   GET /api/cron/calendar-reminders
 *
 * Auth (either):
 *   - Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`
 *   - Manual/dev: `?token=<ADMIN_TOKEN>` or header `x-admin-token`
 *
 * Dev/test params:
 *   - `?dryRun=1` — list due events without sending or marking sent
 *   - `?userId=<U>` — only process this user's events
 */

import { listDueCalendarEvents, markCalendarEventSent } from "@/lib/db";
import { pushMessage, calendarReminderBubble } from "@/lib/line";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

// ── Handler ───────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!authorize(req, url)) {
    return new Response("Forbidden", { status: 403 });
  }

  const dryRun = url.searchParams.get("dryRun") === "1";
  const filterUserId = url.searchParams.get("userId");

  const now = new Date();
  let events = await listDueCalendarEvents(now);

  if (filterUserId) {
    events = events.filter((e) => e.userId === filterUserId);
  }

  if (dryRun) {
    return Response.json({
      ok: true,
      dryRun: true,
      now: now.toISOString(),
      dueCount: events.length,
      events: events.map((e) => ({
        id: e.id,
        userId: e.userId,
        title: e.title,
        eventDate: e.eventDate,
        eventTime: e.eventTime,
        remindAt: e.remindAt,
      })),
    });
  }

  let sent = 0;
  let failed = 0;

  for (const event of events) {
    try {
      await pushMessage(event.userId, [
        calendarReminderBubble({
          title: event.title,
          description: event.description,
          date: event.eventDate,
          time: event.eventTime,
        }),
      ]);
      await markCalendarEventSent(event.id);
      sent++;
      console.log(`[cron/calendar] sent reminder ${event.id} to ${event.userId}`);
    } catch (err) {
      failed++;
      console.error(`[cron/calendar] reminder ${event.id} failed:`, err);
    }
  }

  return Response.json({
    ok: true,
    now: now.toISOString(),
    processed: events.length,
    sent,
    failed,
  });
}
