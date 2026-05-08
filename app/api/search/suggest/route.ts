/**
 * Autocomplete suggestions endpoint.
 * Returns matching keywords/subjects/filenames as user types.
 */

import { suggest } from "@/lib/search-index";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    if (!q) return Response.json({ suggestions: [] });

    const suggestions = await suggest(q, 6);
    return Response.json({ suggestions, query: q });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/search/suggest]", message);
    return Response.json({ error: message, suggestions: [] }, { status: 500 });
  }
}
