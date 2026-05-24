-- Phase 7 — Capture & Timeline backbone (Neon Postgres + pgvector).
-- Run via `npm run db:migrate` (needs DATABASE_URL) or paste into the Neon SQL editor.
-- Statements are split on ";" by scripts/migrate.mjs, so keep one statement per ";".

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS content_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  type         text NOT NULL,
  status       text NOT NULL DEFAULT 'pending',
  source_url   text,
  title        text,
  raw_text     text NOT NULL,
  summary      text,
  category     text,
  tags         text[],
  lang         text,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS content_items_user_created_idx
  ON content_items (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS content_items_status_created_idx
  ON content_items (status, created_at);

CREATE TABLE IF NOT EXISTS chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES content_items (id) ON DELETE CASCADE,
  content         text NOT NULL,
  embedding       vector(1024),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
