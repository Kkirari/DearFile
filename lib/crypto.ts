/**
 * AES-256-GCM at-rest encryption for BYOK API keys.
 *
 * Master key: `BYOK_ENCRYPTION_KEY` (32 random bytes, base64). Generate once:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Wire format (base64): iv(12) | authTag(16) | ciphertext(N). One key per byte
 * stored as a single base64 blob — fits a `text` column. Rotating
 * BYOK_ENCRYPTION_KEY invalidates every stored value; users must re-enter.
 *
 * `byokConfigured()` lets routes 503-out cleanly without crashing the app.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.BYOK_ENCRYPTION_KEY;
  if (!raw) throw new Error("BYOK_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(`BYOK_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length})`);
  }
  cachedKey = buf;
  return buf;
}

export function byokConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

export function encrypt(plain: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(blob: string): string {
  const key = loadKey();
  const buf = Buffer.from(blob, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES) throw new Error("crypto blob too short");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function last4(plain: string): string {
  return plain.slice(-4);
}
