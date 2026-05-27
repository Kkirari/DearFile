/**
 * BYOK (Phase 10) — per-user encrypted API keys for Anthropic + Voyage.
 *
 *   GET    /api/keys                     → masked status (never returns plaintext)
 *   PUT    /api/keys  { provider, key }  → format-check + live-probe + encrypt + upsert
 *   DELETE /api/keys?provider=…          → null the provider's column
 *
 * Auth: LIFF Bearer (requireUserId) OR dev dual-auth `?token=<ADMIN_TOKEN>&userId=<U>`.
 *
 * When `BYOK_ENCRYPTION_KEY` is not configured, all endpoints return 503 and the
 * UI hides the BYOK card. AI flows fall through to hosted env keys regardless.
 */

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { requireUserId, authErrorResponse, AuthError, isSafeUserId } from "@/lib/auth";
import { byokConfigured, encrypt } from "@/lib/crypto";
import { bustCache, maskedStatus, type ByokProvider } from "@/lib/byok";
import { upsertUserApiKey, deleteUserApiKey } from "@/lib/db";
import { embed } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

const ANTHROPIC_FORMAT = /^sk-ant-[A-Za-z0-9_-]{30,}$/;
const VOYAGE_FORMAT    = /^pa-[A-Za-z0-9_-]{20,}$/;
const PROBE_MODEL_ID   = process.env.BYOK_PROBE_MODEL_ID ?? "claude-haiku-4-5";

async function resolveUserId(req: Request, url: URL): Promise<string> {
  const adminToken = process.env.ADMIN_TOKEN;
  const provided = url.searchParams.get("token") ?? req.headers.get("x-admin-token");
  const uidParam = url.searchParams.get("userId");
  if (adminToken && provided === adminToken && uidParam) {
    if (!isSafeUserId(uidParam)) throw new AuthError(400, "Invalid userId");
    return uidParam;
  }
  return requireUserId(req);
}

function byokGuard(): Response | null {
  if (byokConfigured()) return null;
  return Response.json({ error: "BYOK not configured" }, { status: 503 });
}

function isProvider(s: unknown): s is ByokProvider {
  return s === "anthropic" || s === "voyage";
}

async function probeAnthropic(apiKey: string): Promise<void> {
  await generateText({
    model:           createAnthropic({ apiKey })(PROBE_MODEL_ID),
    prompt:          "hi",
    maxOutputTokens: 1,
  });
}

async function probeVoyage(apiKey: string): Promise<void> {
  await embed(["test"], "document", { apiKey });
}

export async function GET(req: Request) {
  const guard = byokGuard();
  if (guard) return guard;
  const url = new URL(req.url);
  let userId: string;
  try {
    userId = await resolveUserId(req, url);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }
  try {
    return Response.json(await maskedStatus(userId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/keys]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const guard = byokGuard();
  if (guard) return guard;
  const url = new URL(req.url);
  let userId: string;
  try {
    userId = await resolveUserId(req, url);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const provider = (body as { provider?: unknown })?.provider;
  const key = (body as { key?: unknown })?.key;
  if (!isProvider(provider)) return Response.json({ error: "Invalid provider" }, { status: 400 });
  if (typeof key !== "string" || !key.trim()) {
    return Response.json({ error: "Missing key" }, { status: 400 });
  }
  const trimmed = key.trim();

  const fmt = provider === "anthropic" ? ANTHROPIC_FORMAT : VOYAGE_FORMAT;
  if (!fmt.test(trimmed)) {
    return Response.json({ error: "Key looks invalid" }, { status: 400 });
  }

  try {
    if (provider === "anthropic") await probeAnthropic(trimmed);
    else                          await probeVoyage(trimmed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[PUT /api/keys] ${provider} probe failed:`, message);
    return Response.json({ error: "Key rejected by provider" }, { status: 400 });
  }

  try {
    await upsertUserApiKey(userId, provider, encrypt(trimmed));
    bustCache(userId);
    return Response.json({ ok: true, status: await maskedStatus(userId) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PUT /api/keys]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const guard = byokGuard();
  if (guard) return guard;
  const url = new URL(req.url);
  let userId: string;
  try {
    userId = await resolveUserId(req, url);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }
  const provider = url.searchParams.get("provider");
  if (!isProvider(provider)) return Response.json({ error: "Invalid provider" }, { status: 400 });
  try {
    await deleteUserApiKey(userId, provider);
    bustCache(userId);
    return Response.json({ ok: true, status: await maskedStatus(userId) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/keys]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
