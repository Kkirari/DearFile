export type FolderOwner = "user" | "ai";

export interface FolderItem {
  id: string;
  name: string;
  count: number;
  updatedAt: string; // ISO string
  owner: FolderOwner;
}
