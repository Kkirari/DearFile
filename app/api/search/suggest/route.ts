/**
 * Autocomplete suggestions endpoint.
 * Returns matching keywords/subjects/filenames as user types.
 */

import { suggest } from "@/lib/search-index";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";

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

    const suggestions = await suggest(userId, q, 6);
    return Response.json({ suggestions, query: q });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/search/suggest]", message);
    return Response.json({ error: message, suggestions: [] }, { status: 500 });
  }
}
