-- Phase 10 BYOK: encrypted per-user API keys for Anthropic + Voyage.
-- Ciphertext columns hold base64(iv | authTag | ciphertext) from lib/crypto.ts.
-- Nullable so each provider is set independently; one row per user.

CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id      text PRIMARY KEY,
  anthropic_ct text,
  voyage_ct    text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
