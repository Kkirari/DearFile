/**
 * User interest-profile API (Phase 9) — backs the Profile tab's "About you" card.
 *
 *   GET    /api/profile  → { interests, about, updatedAt } | { profile: null }
 *   DELETE /api/profile  → { ok: true }   (clear; it rebuilds from captures daily)
 *
 * Auth: LIFF Bearer (requireUserId) OR dev dual-auth ?token=<ADMIN_TOKEN>&userId=<U>.
 */

import { requireUserId, authErrorResponse, AuthError, isSafeUserId } from "@/lib/auth";
import { getUserProfile, deleteUserProfile } from "@/lib/db";

export const dynamic = "force-dynamic";

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

export async function GET(req: Request) {
  const url = new URL(req.url);
  let userId: string;
  try {
    userId = await resolveUserId(req, url);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }
  try {
    const profile = await getUserProfile(userId);
    return Response.json(profile ?? { profile: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/profile]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  let userId: string;
  try {
    userId = await resolveUserId(req, url);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }
  try {
    await deleteUserProfile(userId);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/profile]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
