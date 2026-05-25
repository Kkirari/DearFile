-- Phase 9 — per-user interest profile (memory & persona).
-- Run via `npm run db:migrate` (idempotent). One statement per ";".

CREATE TABLE IF NOT EXISTS user_profile (
  user_id    text PRIMARY KEY,
  interests  text[] NOT NULL DEFAULT '{}',
  about      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
