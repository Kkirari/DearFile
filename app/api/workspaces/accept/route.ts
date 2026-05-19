/**
 * POST /api/workspaces/accept
 *
 * Body: { token: string }
 *
 * Adds the authenticated caller as a member of the workspace bound to
 * the invite token, provided the invite is still valid (not revoked,
 * not expired). Idempotent — calling twice with the same token leaves
 * the caller as a single member.
 *
 * Response: { workspaceId, name } on success, or { error, code } on
 * recoverable failures (so the UI can show specific copy):
 *   404 not_found      — token doesn't resolve
 *   410 revoked        — owner pulled the invite
 *   410 expired        — invite past its expiresAt
 */

import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { addMember, loadWorkspaceMeta } from "@/lib/workspace";
import {
  bumpInviteUseCount,
  resolveInviteToken,
  validateInvite,
} from "@/lib/invite";
import { isSafeInviteToken } from "@/lib/s3";

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const body = await req.json().catch(() => ({})) as { token?: unknown };
    const token = body.token;
    if (!isSafeInviteToken(token)) {
      return Response.json({ error: "Invalid invite token", code: "invalid" }, { status: 400 });
    }

    const resolved = await resolveInviteToken(token);
    if (!resolved) {
      return Response.json({ error: "Invite not found", code: "not_found" }, { status: 404 });
    }

    const reason = validateInvite(resolved.record);
    if (reason) {
      return Response.json({ error: `Invite ${reason}`, code: reason }, { status: 410 });
    }

    // addMember is idempotent + uses ETag-CAS so concurrent accepts of
    // the same invite both produce one membership entry.
    const meta = await addMember(resolved.workspaceId, userId, resolved.record.role);

    // Best-effort stat update — don't block on failure.
    bumpInviteUseCount(resolved.workspaceId, token).catch(() => undefined);

    // Re-load the canonical name in case the workspace was renamed between
    // resolve and add (rare; cheap GET).
    const fresh = await loadWorkspaceMeta(resolved.workspaceId);
    return Response.json({
      workspaceId: resolved.workspaceId,
      name:        fresh?.name ?? meta.name,
    });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/workspaces/accept]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
