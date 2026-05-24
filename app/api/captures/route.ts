/**
 * Captures API — backs the LIFF "Timeline" tab (Phase 7). Lists the user's
 * notes/links from Neon (newest first) and deletes one. Files live elsewhere
 * (S3 + /api/files); this is the notes/links service only.
 *
 *   GET    /api/captures[?limit=&before=<iso>]   → { items: ContentItem[] }
 *   DELETE /api/captures  { id }                 → { ok: true }
 */

import { listItems, deleteItem } from "@/lib/db";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";

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
    const { searchParams } = new URL(req.url);
    const limitParam = Number(searchParams.get("limit"));
    const before = searchParams.get("before") ?? undefined;
    const items = await listItems(userId, {
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
      beforeIso: before,
    });
    return Response.json({ items });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/captures]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const { id } = (await req.json()) as { id?: unknown };
    if (typeof id !== "string" || !id) {
      return Response.json({ error: "Missing id" }, { status: 400 });
    }
    const ok = await deleteItem(userId, id);
    if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/captures]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
