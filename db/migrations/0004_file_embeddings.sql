-- File semantic search — Voyage embeddings for S3 files (user scope).
-- Run via `npm run db:migrate` (idempotent). One statement per ";".

CREATE TABLE IF NOT EXISTS file_embeddings (
  user_id    text NOT NULL,
  file_key   text NOT NULL,
  content    text NOT NULL,
  embedding  vector(1024),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, file_key)
);

CREATE INDEX IF NOT EXISTS file_embeddings_vec_idx
  ON file_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
