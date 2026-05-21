/**
 * Resolve LINE display names + avatars for workspace members.
 *
 * Two sources, picked by workspace kind:
 *   - Group-bound workspace → GET /v2/bot/group/{groupId}/member/{userId}
 *     (works for any current group member).
 *   - Otherwise (invite-based) → GET /v2/bot/profile/{userId}
 *     (only works if the user has added the bot as a friend).
 *
 * Best-effort: any failure returns {} so the caller can fall back to a
 * shortened userId. Results are cached in-process for 1 hour — Fluid Compute
 * keeps instances warm, so this avoids hammering the LINE API on every open
 * of the members panel.
 */

const PROFILE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface LineProfile {
  displayName?: string;
  pictureUrl?: string;
}

interface CacheEntry {
  profile: LineProfile;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function accessToken(): string | null {
  return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;
}

async function fetchProfile(userId: string, lineGroupId: string | null): Promise<LineProfile> {
  const token = accessToken();
  if (!token) return {};

  const url = lineGroupId
    ? `https://api.line.me/v2/bot/group/${lineGroupId}/member/${userId}`
    : `https://api.line.me/v2/bot/profile/${userId}`;

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return {};
    const data = (await res.json()) as { displayName?: string; pictureUrl?: string };
    return { displayName: data.displayName, pictureUrl: data.pictureUrl };
  } catch (err) {
    console.warn(`[line-profile] fetch failed for ${userId}:`, err);
    return {};
  }
}

/**
 * Resolve one member's profile, using the 1-hour cache. Never throws.
 */
export async function resolveProfile(
  userId: string,
  lineGroupId: string | null,
): Promise<LineProfile> {
  const cacheKey = `${lineGroupId ?? "_"}:${userId}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.profile;

  const profile = await fetchProfile(userId, lineGroupId);
  // Cache even empty results briefly to avoid retry storms on a bot that
  // isn't friended — but only persist non-empty for the full TTL.
  cache.set(cacheKey, {
    profile,
    expiresAt: Date.now() + (profile.displayName ? PROFILE_TTL_MS : 5 * 60 * 1000),
  });
  return profile;
}

/**
 * Resolve many members in parallel. Order is preserved relative to input.
 */
export function resolveProfiles(
  userIds: string[],
  lineGroupId: string | null,
): Promise<LineProfile[]> {
  return Promise.all(userIds.map((id) => resolveProfile(id, lineGroupId)));
}
