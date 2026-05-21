/**
 * PATCH  /api/workspaces/{id}  — owner-only rename.
 * DELETE /api/workspaces/{id}  — owner-only cascade delete (wipes all data).
 *
 * Body validation + CAS happen in lib/workspace.ts.
 */

import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import {
  renameWorkspace,
  requireWorkspaceAccess,
  deleteWorkspaceCascade,
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

    const body = await req.json().catch(() => ({})) as { name?: unknown };
    if (typeof body.name !== "string") {
      return Response.json({ error: "Invalid name" }, { status: 400 });
    }

    await requireWorkspaceAccess(userId, id, "owner");
    const meta = await renameWorkspace(id, body.name);
    return Response.json({ workspace: { id: meta.id, name: meta.name, updatedAt: meta.updatedAt } });
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
