-- Phase 1 Calendar Feature — Reminder system for DearFile.
-- One-time calendar events stored per user, with LINE push notifications.
-- Run via `npm run db:migrate` or paste into the Neon SQL editor.

CREATE TABLE IF NOT EXISTS calendar_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL,
  title           text NOT NULL,
  description     text,
  event_date      date NOT NULL,
  event_time      time,
  remind_at       timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  google_event_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);

CREATE INDEX IF NOT EXISTS calendar_events_user_date_idx
  ON calendar_events (user_id, event_date DESC);

CREATE INDEX IF NOT EXISTS calendar_events_remind_due_idx
  ON calendar_events (status, remind_at)
  WHERE status = 'pending';
