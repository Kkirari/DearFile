/**
 * Client-side fetch wrapper that injects the LIFF ID token into every API
 * request as `Authorization: Bearer <token>`.
 *
 * Auth flow:
 *   1. LiffProvider boots, calls `configureApiAuth(getToken)` once init succeeds.
 *      Components that mount before init are queued — apiFetch() awaits the
 *      token before firing the request.
 *   2. If LIFF init fails (no LIFF_ID, network, user closed login), the
 *      provider calls `markApiAuthReady(null)` so queued fetches resolve
 *      tokenless and the API returns 401.
 */

"use client";

type TokenProvider = () => string | null;

let tokenProvider: TokenProvider | null = null;
let ready = false;
const waiters: (() => void)[] = [];

function flush() {
  ready = true;
  for (const w of waiters) w();
  waiters.length = 0;
}

/** Called by LiffProvider once init succeeds. */
export function configureApiAuth(getToken: TokenProvider) {
  tokenProvider = getToken;
  flush();
}

/** Called by LiffProvider when init fails — let queued fetches go through tokenless. */
export function markApiAuthReady(_failed: null) {
  tokenProvider = null;
  flush();
}

async function awaitReady(): Promise<void> {
  if (ready) return;
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
    // Hard timeout so we never hang forever if LIFF init never completes.
    setTimeout(() => {
      if (!ready) {
        console.warn("[apiFetch] LIFF auth still not ready after 5s — proceeding tokenless");
        flush();
      } else {
        resolve();
      }
    }, 5000);
  });
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  await awaitReady();
  const token = tokenProvider?.() ?? null;
  const headers = new Headers(init.headers);
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
