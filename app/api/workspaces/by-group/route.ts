/**
 * GET /api/workspaces/by-group?groupId=C… — resolve a LINE group to its workspace.
 *
 * Lets the LIFF open the workspace of the group it was launched from instead of
 * whichever one the user happened to visit last. The client gets `groupId` from
 * `liff.getContext()`, so it is caller-supplied and unverified — and this endpoint
 * auto-joins the caller as a member. It therefore asks LINE whether the user is
 * genuinely in that group before doing so.
 *
 * Returns `{ workspace: null }` (200, not 404) for every "no" — an unbound group,
 * an orphaned workspace, a non-member — because the client's only reaction is the
 * same either way: fall back to the last-used workspace.
 */

import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { findWorkspaceByLineGroup } from "@/lib/workspace";
import { ensureWorkspaceMember } from "@/lib/workspace-access";
import { isGroupMember } from "@/lib/line";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const groupId = new URL(req.url).searchParams.get("groupId");
    if (!groupId) {
      return Response.json({ error: "groupId is required" }, { status: 400 });
    }

    const meta = await findWorkspaceByLineGroup(groupId);
    if (!meta || meta.orphaned) return Response.json({ workspace: null });

    // Already a member — no need to spend a LINE API call re-proving it.
    const alreadyMember = meta.members.some((m) => m.userId === userId);
    if (!alreadyMember) {
      if (!(await isGroupMember(groupId, userId))) {
        return Response.json({ workspace: null });
      }
      if (!(await ensureWorkspaceMember(meta.id, userId))) {
        return Response.json({ workspace: null });
      }
    }

    return Response.json({ workspace: { id: meta.id, name: meta.name } });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/workspaces/by-group]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
