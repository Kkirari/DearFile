/**
 * Autocomplete suggestions endpoint.
 * Returns matching keywords/subjects/filenames as user types.
 */

import { suggest, suggestWorkspace } from "@/lib/search-index";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { isSafeWorkspaceId } from "@/lib/s3";

export async function GET(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    if (!q) return Response.json({ suggestions: [] });

    const workspaceId = searchParams.get("workspaceId");
    if (workspaceId !== null && workspaceId !== "") {
      if (!isSafeWorkspaceId(workspaceId)) {
        return Response.json({ error: "Invalid workspaceId", suggestions: [] }, { status: 400 });
      }
      await requireWorkspaceAccess(userId, workspaceId);
      const suggestions = await suggestWorkspace(workspaceId, q, 6);
      return Response.json({ suggestions, query: q });
    }

    const suggestions = await suggest(userId, q, 6);
    return Response.json({ suggestions, query: q });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/search/suggest]", message);
    return Response.json({ error: message, suggestions: [] }, { status: 500 });
  }
}
