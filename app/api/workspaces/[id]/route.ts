/**
 * PATCH  /api/workspaces/{id}  — `{ name }` (owner-only) and/or `{ quiet }` (any member).
 * DELETE /api/workspaces/{id}  — owner-only cascade delete (wipes all data).
 *
 * Body validation + CAS happen in lib/workspace.ts.
 *
 * Why `quiet` is member-level while rename is owner-only: a group workspace's
 * ownerId is just whoever first triggered its creation (webhook `join`, or the
 * first message sender) and they may well have left the group. Quiet is
 * reversible, group-wide, and already settable by any member via the chat
 * command — gating the LIFF toggle harder than the chat command would only
 * confuse people.
 */

import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import {
  renameWorkspace,
  setWorkspaceQuiet,
  requireWorkspaceAccess,
  deleteWorkspaceCascade,
  type WorkspaceMeta,
} from "@/lib/workspace";
import { isSafeWorkspaceId } from "@/lib/s3";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
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

    const body = await req.json().catch(() => ({})) as { name?: unknown; quiet?: unknown };
    const hasName  = typeof body.name  === "string";
    const hasQuiet = typeof body.quiet === "boolean";
    if (!hasName && !hasQuiet) {
      return Response.json({ error: "Nothing to update" }, { status: 400 });
    }

    await requireWorkspaceAccess(userId, id, hasName ? "owner" : "member");

    let meta: WorkspaceMeta | undefined;
    if (hasName)  meta = await renameWorkspace(id, body.name as string);
    if (hasQuiet) meta = await setWorkspaceQuiet(id, body.quiet as boolean);

    return Response.json({
      workspace: {
        id:        meta!.id,
        name:      meta!.name,
        quiet:     meta!.quiet ?? false,
        updatedAt: meta!.updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PATCH /api/workspaces/[id]]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
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

    await requireWorkspaceAccess(userId, id, "owner");
    const { deletedObjects } = await deleteWorkspaceCascade(id);
    return Response.json({ ok: true, deletedObjects });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/workspaces/[id]]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
