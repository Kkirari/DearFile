-- Phase 7.1 — persisted daily summaries (calendar Timeline "summary of the past").
-- Run via `npm run db:migrate` (idempotent) or paste into the Neon SQL editor.
-- One statement per ";" (scripts/migrate.mjs splits on it after stripping comments).

CREATE TABLE IF NOT EXISTS daily_summaries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  date        text NOT NULL,
  text        text NOT NULL,
  file_count  int  NOT NULL DEFAULT 0,
  item_count  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS daily_summaries_user_date_idx
  ON daily_summaries (user_id, date DESC);
