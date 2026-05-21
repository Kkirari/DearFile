import type { FolderMode } from "@/lib/folder-permissions";

export type FolderOwner = "user" | "ai";

export interface FolderItem {
  id: string;
  name: string;
  count: number;
  updatedAt: string; // ISO string
  owner: FolderOwner;
  /**
   * Permission mode for shared-workspace folders (Phase 3). Absent for
   * personal folders and AI folders (those are always "open"). Defaults to
   * `upload` when the folder-meta has no `permissions.mode` field.
   */
  mode?: FolderMode;
}
