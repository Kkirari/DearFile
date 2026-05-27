/**
 * MCP token issuance (Phase 11). The user mints + revokes bearer tokens that
 * external MCP clients (Claude Desktop, etc.) present to /api/mcp.
 *
 *   GET    /api/mcp/tokens                  → masked list (never plaintext)
 *   POST   /api/mcp/tokens  { label? }      → mint; plaintext returned ONCE
 *   DELETE /api/mcp/tokens?hash=<sha256>    → revoke one
 *
 * Auth: LIFF Bearer (requireUserId) OR dev dual-auth ?token=<ADMIN_TOKEN>&userId=<U>.
 */

import { requireUserId, authErrorResponse, AuthError, isSafeUserId } from "@/lib/auth";
import { listMcpTokensMasked, mintMcpToken, revokeMcpToken } from "@/lib/mcp-tokens";

export const dynamic = "force-dynamic";

async function resolveUserId(req: Request, url: URL): Promise<string> {
  const adminToken = process.env.ADMIN_TOKEN;
  const provided = url.searchParams.get("token") ?? req.headers.get("x-admin-token");
  const uidParam = url.searchParams.get("userId");
  if (adminToken && provided === adminToken && uidParam) {
    if (!isSafeUserId(uidParam)) throw new AuthError(400, "Invalid userId");
    return uidParam;
  }
  return requireUserId(req);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  let userId: string;
  try {
    userId = await resolveUserId(req, url);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }
  try {
    const tokens = await listMcpTokensMasked(userId);
    return Response.json({ tokens });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/mcp/tokens]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  let userId: string;
  try {
    userId = await resolveUserId(req, url);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }
  let body: unknown;
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }
  const label = (body as { label?: unknown })?.label;
  try {
    const minted = await mintMcpToken(userId, typeof label === "string" ? label : null);
    // plaintext returned ONCE — the UI must save/copy now or never again.
    return Response.json({
      ok:        true,
      plaintext: minted.plaintext,
      tokenHash: minted.tokenHash,
      masked:    minted.masked,
      createdAt: minted.createdAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/mcp/tokens]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  let userId: string;
  try {
    userId = await resolveUserId(req, url);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }
  const hash = url.searchParams.get("hash");
  if (!hash) return Response.json({ error: "Missing hash" }, { status: 400 });
  try {
    await revokeMcpToken(userId, hash);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DELETE /api/mcp/tokens]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
