/**
 * Workspace invites — owner-only management.
 *
 *   GET  /api/workspaces/{id}/invites           list active invites
 *   POST /api/workspaces/{id}/invites           create a new invite token
 *
 * Both require owner role on the target workspace.
 */

import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { createInvite, listInvites } from "@/lib/invite";
import { isSafeWorkspaceId } from "@/lib/s3";

async function resolveWorkspaceId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  if (!isSafeWorkspaceId(id)) throw new AuthError(400, "Invalid workspaceId");
  return id;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const workspaceId = await resolveWorkspaceId(ctx.params);
    await requireWorkspaceAccess(userId, workspaceId, "owner");
    const invites = await listInvites(workspaceId);
    return Response.json({ invites });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/workspaces/[id]/invites]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const workspaceId = await resolveWorkspaceId(ctx.params);
    await requireWorkspaceAccess(userId, workspaceId, "owner");

    const body = await req.json().catch(() => ({})) as { ttlDays?: unknown };
    const ttlDays =
      typeof body.ttlDays === "number" && Number.isFinite(body.ttlDays)
        ? body.ttlDays
        : undefined;

    const invite = await createInvite({ workspaceId, createdBy: userId, ttlDays });
    return Response.json({ invite });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/workspaces/[id]/invites]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
