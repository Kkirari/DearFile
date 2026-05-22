/**
 * Soft per-user daily rate limit for "Ask DearFile" questions.
 *
 * Each question costs a model call, so we cap how many a single LINE user can
 * fire per day. The counter is a tiny JSON object in S3 at
 *   `ask-usage/{userId}/{YYYY-MM-DD}.json`  →  { count }
 * keyed by UTC date, so it resets at 00:00 UTC and old days simply stop being
 * read (add an S3 lifecycle rule on the `ask-usage/` prefix for tidiness — not
 * required for correctness).
 *
 * Deliberately NOT atomic: we load → compare → write without a CAS. Two
 * concurrent questions could both read the same count and let one extra
 * through. That's an acceptable trade-off for a soft cap (same reasoning the
 * search-index lock documents) and avoids the cost/complexity of conditional
 * writes for a non-billing limit.
 */

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "./s3";
import { isSafeUserId } from "./auth";

const DEFAULT_DAILY_LIMIT = 30;

function dailyLimit(): number {
  const raw = process.env.ASK_DAILY_LIMIT;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
}

/** UTC YYYY-MM-DD — the bucket key the counter resets on. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function usageKey(userId: string): string {
  return `ask-usage/${userId}/${todayKey()}.json`;
}

async function readCount(key: string): Promise<number> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await res.Body?.transformToString();
    if (!body) return 0;
    const parsed = JSON.parse(body) as { count?: unknown };
    return typeof parsed.count === "number" && parsed.count >= 0 ? parsed.count : 0;
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "NoSuchKey") return 0;
    // Don't let a transient S3 read error block the user — fail open.
    console.warn("[rate-limit] usage read failed, treating as 0:", err);
    return 0;
  }
}

/**
 * Check whether `userId` may ask another question today, and (if so) increment
 * the counter. Returns `remaining` = questions left AFTER this one.
 *
 * On any unexpected error we fail OPEN (allow the question) — a rate limiter
 * should never be the reason a paying feature goes dark.
 */
export async function checkAndIncrementAsk(
  userId: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const limit = dailyLimit();

  if (!isSafeUserId(userId)) {
    // Unexpected shape — don't write a junk S3 key, but don't hard-block.
    return { allowed: true, remaining: limit - 1 };
  }

  const key = usageKey(userId);
  const count = await readCount(key);

  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  const next = count + 1;
  try {
    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        JSON.stringify({ count: next }),
      ContentType: "application/json",
    }));
  } catch (err) {
    // Best-effort increment; allow the question even if the write failed.
    console.warn("[rate-limit] usage write failed (allowing anyway):", err);
  }

  return { allowed: true, remaining: Math.max(0, limit - next) };
}
