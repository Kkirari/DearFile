/**
 * Calendar events API for LIFF — list, create, and cancel user events.
 *
 * GET  /api/calendar/events?userId=U...  → list upcoming events
 * POST /api/calendar/events              → create new event
 * DELETE /api/calendar/events?userId=U...&id=...  → cancel event
 */

import {
  cancelCalendarEvent,
  insertCalendarEvent,
  listCalendarEvents,
} from "@/lib/db";
import { calculateRemindAt } from "@/lib/calendar";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");

  if (!userId) {
    return Response.json({ error: "userId required" }, { status: 400 });
  }

  try {
    const events = await listCalendarEvents(userId);
    return Response.json({ events });
  } catch (err) {
    console.error("[api/calendar/events] GET failed:", err);
    return Response.json({ error: "Failed to load events" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: {
    userId: string;
    title: string;
    description?: string;
    eventDate: string;    // YYYY-MM-DD
    eventTime?: string;   // HH:MM
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.userId || !body.title || !body.eventDate) {
    return Response.json(
      { error: "userId, title, and eventDate are required" },
      { status: 400 },
    );
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.eventDate)) {
    return Response.json(
      { error: "eventDate must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  // Validate time format if provided
  if (body.eventTime && !/^\d{2}:\d{2}$/.test(body.eventTime)) {
    return Response.json(
      { error: "eventTime must be HH:MM" },
      { status: 400 },
    );
  }

  try {
    const id = await insertCalendarEvent({
      userId: body.userId,
      title: body.title.slice(0, 100),
      description: body.description?.slice(0, 500) ?? null,
      eventDate: body.eventDate,
      eventTime: body.eventTime ?? null,
      remindAt: calculateRemindAt(body.eventDate, body.eventTime ?? null),
    });

    return Response.json({ ok: true, id });
  } catch (err) {
    console.error("[api/calendar/events] POST failed:", err);
    return Response.json({ error: "Failed to create event" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const id = url.searchParams.get("id");

  if (!userId || !id) {
    return Response.json(
      { error: "userId and id required" },
      { status: 400 },
    );
  }

  try {
    const deleted = await cancelCalendarEvent(userId, id);
    if (!deleted) {
      return Response.json({ error: "Event not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[api/calendar/events] DELETE failed:", err);
    return Response.json({ error: "Failed to cancel event" }, { status: 500 });
  }
}
