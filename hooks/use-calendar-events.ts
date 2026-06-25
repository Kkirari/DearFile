/**
 * Calendar events hook — fetches user's upcoming calendar reminders from the API.
 */

import { useState, useEffect } from "react";
import type { CalendarEvent } from "@/lib/db";

export function useCalendarEvents(userId: string | null) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/calendar/events?userId=${encodeURIComponent(userId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (mounted) {
          setEvents(data.events ?? []);
        }
      } catch (err) {
        console.error("[useCalendarEvents] load failed:", err);
        if (mounted) {
          setError("Failed to load calendar events");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [userId]);

  const refresh = async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/calendar/events?userId=${encodeURIComponent(userId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch (err) {
      console.error("[useCalendarEvents] refresh failed:", err);
      setError("Failed to refresh events");
    } finally {
      setLoading(false);
    }
  };

  const createEvent = async (input: {
    title: string;
    description?: string;
    eventDate: string;
    eventTime?: string;
  }) => {
    if (!userId) return;
    const res = await fetch("/api/calendar/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, ...input }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await refresh();
  };

  const cancelEvent = async (id: string) => {
    if (!userId) return;
    const res = await fetch(
      `/api/calendar/events?userId=${encodeURIComponent(userId)}&id=${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await refresh();
  };

  return { events, loading, error, refresh, createEvent, cancelEvent };
}
