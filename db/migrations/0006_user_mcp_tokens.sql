-- Phase 11 MCP: per-user bearer tokens for the MCP endpoint.
-- token_hash holds sha-256 hex of the plaintext; the plaintext is shown to the
-- user exactly once at mint time and never recoverable from the DB.

CREATE TABLE IF NOT EXISTS user_mcp_tokens (
  token_hash   text PRIMARY KEY,
  user_id      text NOT NULL,
  label        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS user_mcp_tokens_user_idx
  ON user_mcp_tokens (user_id, created_at DESC);
