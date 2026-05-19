/**
 * DELETE /api/workspaces/{id}/members/{userId}
 *
 * Two use cases share this endpoint:
 *   - Leave: caller removes themselves (any non-owner role).
 *   - Kick: workspace owner removes another member.
 *
 * The workspace owner cannot be removed (would leave the workspace
 * un-owned). Ownership transfer is deferred to Phase 3.
 */

import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { removeMember, requireWorkspaceAccess } from "@/lib/workspace";
import { isSafeUserId } from "@/lib/auth";
import { isSafeWorkspaceId } from "@/lib/s3";

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; userId: string }> },
) {
  let callerId: string;
  try {
    callerId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const { id, userId: targetParam } = await ctx.params;
    if (!isSafeWorkspaceId(id)) {
      return Response.json({ error: "Invalid workspaceId" }, { status: 400 });
    }

    // "self" sentinel lets the LIFF client request a leave without
    // knowing its own LINE userId (it's available server-side anyway
    // via the bearer token).
    const targetId = targetParam === "self" ? callerId : targetParam;
    if (!isSafeUserId(targetId)) {
      return Response.json({ error: "Invalid userId" }, { status: 400 });
    }

    if (callerId === targetId) {
      // Self-leave: caller must be a member (any role is fine — but
      // removeMember will throw 400 if they're the owner).
      await requireWorkspaceAccess(callerId, id, "member");
    } else {
      // Kick: only the owner can remove others.
      await requireWorkspaceAccess(callerId, id, "owner");
    }

    await removeMember(id, targetId);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/workspaces/[id]/members/[userId]]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
