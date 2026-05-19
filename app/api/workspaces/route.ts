/**
 * Workspaces the authenticated user belongs to.
 *
 *   GET  /api/workspaces            → list mine (id, name, role, member count)
 *   POST /api/workspaces            → create a new standalone workspace (Phase 2)
 *
 * The per-user index at `users/{U}/_workspaces.json` is the source of truth
 * for "which workspaces this user is in" — we resolve each entry to its
 * full meta to enrich with name + member count.
 */

import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import {
  createWorkspace,
  listUserWorkspaces,
  loadWorkspaceMeta,
  type WorkspaceRole,
} from "@/lib/workspace";

interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  memberCount: number;
  lineGroupId: string | null;
  orphaned: boolean;
  updatedAt: string;
}

export async function GET(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const entries = await listUserWorkspaces(userId);
    if (entries.length === 0) return Response.json({ workspaces: [] });

    // Resolve each entry to its full meta. Skip ones whose meta is missing
    // (could happen if a workspace was deleted but the user index didn't
    // get cleaned up — best-effort consistency).
    const metas = await Promise.all(entries.map((e) => loadWorkspaceMeta(e.id)));

    const workspaces: WorkspaceSummary[] = [];
    for (let i = 0; i < entries.length; i++) {
      const meta = metas[i];
      if (!meta) continue;
      workspaces.push({
        id:          meta.id,
        name:        meta.name,
        role:        entries[i].role,
        memberCount: meta.members.length,
        lineGroupId: meta.lineGroupId,
        orphaned:    meta.orphaned ?? false,
        updatedAt:   meta.updatedAt,
      });
    }

    workspaces.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    return Response.json({ workspaces });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/workspaces]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const { name } = await req.json() as { name?: unknown };
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 80) {
      return Response.json({ error: "Invalid name (1-80 chars)" }, { status: 400 });
    }

    const meta = await createWorkspace({ name: name.trim(), ownerId: userId });
    return Response.json({
      workspace: {
        id:          meta.id,
        name:        meta.name,
        role:        "owner" as const,
        memberCount: meta.members.length,
        lineGroupId: meta.lineGroupId,
        orphaned:    false,
        updatedAt:   meta.updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/workspaces]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
