/**
 * Capture reconciliation cron — Phase 7. Drains captures that still need work:
 * `pending`, retryable `failed`, or `processing` rows stuck from a crashed
 * background task. The webhook's `after()` handles the happy path; this is the
 * durable safety net, and the daily-summary cron calls the same drain before the
 * 20:00 recap so nothing same-day is missed.
 *
 *   GET /api/cron/process-captures[?limit=]
 *
 * Auth (either): Vercel Cron `Authorization: Bearer ${CRON_SECRET}`, or manual
 * `?token=<ADMIN_TOKEN>` / header `x-admin-token`.
 */

import { drainCaptures } from "@/lib/capture";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorize(req: Request, url: URL): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) return true;
  const adminToken = process.env.ADMIN_TOKEN;
  const provided = url.searchParams.get("token") ?? req.headers.get("x-admin-token");
  return !!adminToken && provided === adminToken;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!authorize(req, url)) return new Response("Forbidden", { status: 403 });

  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 25;

  try {
    const result = await drainCaptures(limit);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/process-captures]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
