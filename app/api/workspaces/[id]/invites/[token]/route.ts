/**
 * DELETE /api/workspaces/{id}/invites/{token} — owner revokes an invite.
 *
 * Idempotent: calling on an already-revoked or already-deleted invite
 * returns 200 (no-op).
 */

import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { revokeInvite } from "@/lib/invite";
import { isSafeInviteToken, isSafeWorkspaceId } from "@/lib/s3";

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; token: string }> },
) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const { id, token } = await ctx.params;
    if (!isSafeWorkspaceId(id)) {
      return Response.json({ error: "Invalid workspaceId" }, { status: 400 });
    }
    if (!isSafeInviteToken(token)) {
      return Response.json({ error: "Invalid invite token" }, { status: 400 });
    }

    await requireWorkspaceAccess(userId, id, "owner");
    await revokeInvite(id, token);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/workspaces/[id]/invites/[token]]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
