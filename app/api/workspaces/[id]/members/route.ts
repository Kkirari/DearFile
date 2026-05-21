/**
 * GET /api/workspaces/{id}/members
 *
 * Returns the workspace's members with LINE display names + avatars resolved
 * (best-effort). Any member must be able to see the roster. Names/avatars
 * come from lib/line-profile (cached); a member whose profile can't be
 * resolved is returned without displayName/pictureUrl.
 */

import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { loadWorkspaceMeta, requireWorkspaceAccess } from "@/lib/workspace";
import { resolveProfiles } from "@/lib/line-profile";
import { isSafeWorkspaceId } from "@/lib/s3";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const { id } = await ctx.params;
    if (!isSafeWorkspaceId(id)) {
      return Response.json({ error: "Invalid workspaceId" }, { status: 400 });
    }

    await requireWorkspaceAccess(userId, id);
    const meta = await loadWorkspaceMeta(id);
    if (!meta) return Response.json({ error: "Workspace not found" }, { status: 404 });

    const profiles = await resolveProfiles(
      meta.members.map((m) => m.userId),
      meta.lineGroupId ?? null,
    );

    const members = meta.members.map((m, i) => ({
      userId:      m.userId,
      role:        m.role,
      joinedAt:    m.joinedAt,
      displayName: profiles[i]?.displayName,
      pictureUrl:  profiles[i]?.pictureUrl,
    }));

    return Response.json({ members });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/workspaces/[id]/members]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
