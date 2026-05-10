/**
 * Server-side identity for the API routes.
 *
 * The client sends `Authorization: Bearer <LIFF ID token>` with every request.
 * We verify it against LINE's public verify endpoint and cache the result
 * (keyed by token string) so we don't hit LINE on every API call.
 *
 * Local dev bypass: when DEV_USER_ID is set and NODE_ENV !== "production",
 * the literal token "dev" maps to that id — lets you test the API with curl
 * without spinning up LIFF.
 */

const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const CACHE_MAX_TTL_MS = 5 * 60 * 1000; // never trust a verified token longer than 5 minutes
const CACHE_MAX_ENTRIES = 1000;

interface CacheEntry {
  userId: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CacheEntry>();

export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

/**
 * Folder/path-segment-safe userId. LINE userIds are `U` + 32 hex chars, but
 * we also accept the slightly looser shape so dev bypass ids work too.
 */
export function isSafeUserId(id: unknown): id is string {
  return typeof id === "string"
    && id.length > 0
    && id.length <= 64
    && /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Extract the userId from the request, verifying the LIFF ID token if
 * present. Throws AuthError if the request isn't authenticated.
 */
export async function requireUserId(req: Request): Promise<string> {
  const auth  = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw new AuthError(401, "Missing Bearer token");

  // Local dev bypass — explicit env opt-in only.
  const devUserId = process.env.DEV_USER_ID;
  if (devUserId && process.env.NODE_ENV !== "production" && token === "dev") {
    if (!isSafeUserId(devUserId)) {
      throw new AuthError(500, "DEV_USER_ID has unsafe shape");
    }
    return devUserId;
  }

  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.userId;
  }

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelId) {
    throw new AuthError(500, "LINE_LOGIN_CHANNEL_ID is not configured");
  }

  const params = new URLSearchParams({ id_token: token, client_id: channelId });
  const res = await fetch(LINE_VERIFY_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params.toString(),
  });

  if (!res.ok) {
    throw new AuthError(401, "Invalid or expired LINE ID token");
  }

  const data = (await res.json()) as { sub?: string; exp?: number };
  if (!isSafeUserId(data.sub)) {
    throw new AuthError(401, "ID token did not contain a valid subject");
  }

  const tokenExpMs = (data.exp ?? 0) * 1000;
  const cacheUntil = Math.min(tokenExpMs || Date.now() + CACHE_MAX_TTL_MS, Date.now() + CACHE_MAX_TTL_MS);
  tokenCache.set(token, { userId: data.sub, expiresAt: cacheUntil });

  // Bound the cache so a flood of unique tokens can't blow memory.
  if (tokenCache.size > CACHE_MAX_ENTRIES) {
    const oldest = tokenCache.keys().next().value;
    if (oldest) tokenCache.delete(oldest);
  }

  return data.sub;
}

/**
 * Convert any thrown error into a properly-shaped Response. AuthError gets
 * its specific status; everything else becomes a 401 to avoid leaking
 * internal details from the auth path.
 */
export function authErrorResponse(err: unknown): Response {
  if (err instanceof AuthError) {
    return Response.json({ error: err.message }, { status: err.statusCode });
  }
  console.error("[auth] unexpected error:", err);
  return Response.json({ error: "Authentication failed" }, { status: 401 });
}
