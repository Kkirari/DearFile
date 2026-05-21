/**
 * Per-folder permission modes for shared workspaces (Phase 3).
 *
 * The workspace owner picks one of three modes per folder:
 *   - read-only : members can list + open files, nothing else
 *   - upload    : members can list + open + upload + delete *their own* files
 *   - full      : members can list + open + upload + delete *anything*
 *
 * The owner is always unrestricted regardless of mode.
 *
 * This file is intentionally framework-free — pure predicates, no I/O — so
 * it can be unit-tested and re-used from any API route. The actual storage
 * read (folder-meta JSON) lives in `lib/workspace.ts::getFolderPermission`.
 */

export type FolderMode = "read-only" | "upload" | "full";

export const DEFAULT_FOLDER_MODE: FolderMode = "upload";

const ALL_MODES: readonly FolderMode[] = ["read-only", "upload", "full"];

/**
 * Type-guard. Use on any client-supplied mode value before storing or
 * acting on it.
 */
export function isFolderMode(value: unknown): value is FolderMode {
  return typeof value === "string" && (ALL_MODES as readonly string[]).includes(value);
}

/**
 * Can the caller upload a new file into this folder?
 * Owner: always. Member: yes unless the folder is read-only.
 */
export function canUploadToFolder(mode: FolderMode, isOwner: boolean): boolean {
  if (isOwner) return true;
  return mode !== "read-only";
}

/**
 * Can the caller delete this specific file in this folder?
 *
 * Owner: always.
 * Member, mode=full: yes (owner explicitly opened the folder up).
 * Member, mode=upload: only if they uploaded the file themselves —
 *   missing uploaderId means we can't prove ownership, so deny
 *   (this closes the pre-Phase-3 bug where missing-uploaderId entries
 *    were deletable by any member).
 * Member, mode=read-only: never.
 */
export function canDeleteFileInFolder(
  mode: FolderMode,
  isOwner: boolean,
  entryUploaderId: string | undefined | null,
  callerId: string,
): boolean {
  if (isOwner) return true;
  if (mode === "full") return true;
  if (mode === "upload") return Boolean(entryUploaderId) && entryUploaderId === callerId;
  return false;
}

/**
 * Only the workspace owner can change a folder's mode. Members never can,
 * even on folders they themselves created.
 */
export function canChangeFolderMode(isOwner: boolean): boolean {
  return isOwner;
}
