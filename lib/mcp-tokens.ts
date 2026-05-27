/**
 * MCP bearer tokens — mint/verify/list/revoke.
 *
 * Format: `dfmcp_<64-hex>`. Plaintext shown to the user ONCE at mint time; the
 * DB only ever stores `sha256(plaintext)`. The prefix lets users spot a token
 * in their environment / config.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import {
  insertMcpToken,
  findUserByMcpTokenHash,
  listMcpTokens,
  deleteMcpToken,
} from "./db";

const PREFIX = "dfmcp_";
const BODY_BYTES = 32;
const TOKEN_RE = /^dfmcp_[0-9a-f]{64}$/;

export interface MintedToken {
  plaintext: string;
  tokenHash: string;
  masked: string;
  createdAt: string;
}

export interface MaskedToken {
  tokenHash: string;
  label: string | null;
  masked: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function hashHex(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function mask(plaintext: string): string {
  return `${PREFIX}…${plaintext.slice(-4)}`;
}

/** Mint a new token for a user. Returns plaintext exactly once. */
export async function mintMcpToken(userId: string, label?: string | null): Promise<MintedToken> {
  const plaintext = PREFIX + randomBytes(BODY_BYTES).toString("hex");
  const tokenHash = hashHex(plaintext);
  const cleanLabel = (label ?? "").trim().slice(0, 60) || null;
  await insertMcpToken({ userId, tokenHash, label: cleanLabel });
  return {
    plaintext,
    tokenHash,
    masked:    mask(plaintext),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Verify a plaintext token; return userId or null. Wrong-format strings short-
 * circuit (no DB hit). On success, the row's `last_used_at` is bumped (best-
 * effort, in the background via the DB helper).
 */
export async function verifyMcpToken(plaintext: string | undefined | null): Promise<string | null> {
  if (!plaintext || !TOKEN_RE.test(plaintext)) return null;
  return findUserByMcpTokenHash(hashHex(plaintext));
}

/** List a user's tokens, masked (plaintext can never be re-derived). */
export async function listMcpTokensMasked(userId: string): Promise<MaskedToken[]> {
  const rows = await listMcpTokens(userId);
  return rows.map((r) => ({
    tokenHash:  r.tokenHash,
    label:      r.label,
    masked:     `${PREFIX}…${r.tokenHash.slice(-4)}`, // last 4 of the HASH, since plaintext is gone
    createdAt:  r.createdAt,
    lastUsedAt: r.lastUsedAt,
  }));
}

/** Revoke one token by its hash (which the UI has from list). */
export async function revokeMcpToken(userId: string, tokenHash: string): Promise<void> {
  if (typeof tokenHash !== "string" || tokenHash.length !== 64) return;
  await deleteMcpToken(userId, tokenHash);
}

// Re-export for callers that want constant-time string compare (unused for the
// hash lookup, since the DB lookup is itself constant time per index probe,
// but exported in case a future code path needs it).
export function safeEqualStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
