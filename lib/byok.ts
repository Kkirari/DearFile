/**
 * BYOK resolver — turns a userId into decrypted per-provider API keys, with a
 * short in-memory LRU so a request burst (e.g. one capture → analyze + embed)
 * doesn't decrypt twice. Best-effort everywhere: if BYOK isn't configured or a
 * key fails to decrypt, callers fall through to the hosted env keys.
 *
 * Plaintext keys never leave this module's return values; the API surface uses
 * `maskedStatus` for read-back.
 */

import { byokConfigured, decrypt, last4 } from "./crypto";
import {
  getUserApiKeyCiphers,
  type ByokProvider,
} from "./db";

export interface UserKeys {
  anthropic?: string;
  voyage?: string;
}

export interface KeyStatus {
  set: boolean;
  last4?: string;
  updatedAt?: string;
}

export interface MaskedStatus {
  anthropic: KeyStatus;
  voyage: KeyStatus;
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;

interface CacheEntry {
  keys: UserKeys;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(userId: string): UserKeys | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(userId);
    return null;
  }
  return entry.keys;
}

function cacheSet(userId: string, keys: UserKeys): void {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(userId, { keys, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function bustCache(userId: string): void {
  cache.delete(userId);
}

function tryDecrypt(blob: string | null): string | undefined {
  if (!blob) return undefined;
  try {
    return decrypt(blob);
  } catch (err) {
    console.warn("[byok] decrypt failed (treating as absent):", err);
    return undefined;
  }
}

/**
 * Decrypted per-user keys, with hosted-env fallback handled by callers.
 * Returns an empty object if BYOK is not configured or no row exists —
 * callers must treat absent keys as "use hosted env".
 */
export async function getUserKeys(userId: string): Promise<UserKeys> {
  if (!byokConfigured()) return {};
  const cached = cacheGet(userId);
  if (cached) return cached;
  const row = await getUserApiKeyCiphers(userId);
  const keys: UserKeys = {};
  if (row) {
    const a = tryDecrypt(row.anthropicCt);
    if (a) keys.anthropic = a;
    const v = tryDecrypt(row.voyageCt);
    if (v) keys.voyage = v;
  }
  cacheSet(userId, keys);
  return keys;
}

/** Masked status for the Profile tab — never returns plaintext. */
export async function maskedStatus(userId: string): Promise<MaskedStatus> {
  const empty: KeyStatus = { set: false };
  if (!byokConfigured()) return { anthropic: empty, voyage: empty };
  const row = await getUserApiKeyCiphers(userId);
  if (!row) return { anthropic: empty, voyage: empty };
  const a = tryDecrypt(row.anthropicCt);
  const v = tryDecrypt(row.voyageCt);
  return {
    anthropic: a ? { set: true, last4: last4(a), updatedAt: row.updatedAt } : empty,
    voyage: v ? { set: true, last4: last4(v), updatedAt: row.updatedAt } : empty,
  };
}

export type { ByokProvider };
