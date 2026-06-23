/**
 * Auto-join helper for LIFF deep links. When a user clicks a group file bubble
 * but isn't a workspace member yet, add them automatically if the workspace is
 * group-bound (= they're in the LINE group, so they have legit access).
 *
 * ponytail: stdlib only, no new deps
 */

import { addMember, loadWorkspaceMeta } from "./workspace";

/**
 * Ensure userId is a member of the workspace. If missing and workspace is
 * group-bound, auto-add them as "member". Returns true if access is granted
 * (already member or successfully added), false if denied.
 */
export async function ensureWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const meta = await loadWorkspaceMeta(workspaceId);
  if (!meta) return false;
  if (meta.members.some((m) => m.userId === userId)) return true;
  if (!meta.lineGroupId) return false; // not group-bound → no auto-join
  await addMember(workspaceId, userId, "member");
  return true;
}
