/**
 * Search index — single JSON file in S3 holding analyzed-file metadata.
 * Lets us full-text search by Thai/English keywords without scanning S3 tags
 * (S3 tags are ASCII-only) and lets AI folders compute counts cheaply.
 */

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "./s3";

const INDEX_KEY = "_search-index.json";

export interface IndexEntry {
  key: string;                    // current S3 key (after rename)
  filename: string;               // displayed filename
  category: string;
  type: string;
  subject: string;
  detail: string;
  date: string | null;
  keywords: string[];             // mixed TH + EN
  ai_folder_id: string;
  user_folder_id: string | null;  // physical folder (uploads/ → null)
  size: number;
  mimeType: string;
  createdAt: string;
}

async function loadIndex(): Promise<IndexEntry[]> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: INDEX_KEY }));
    const body = await res.Body?.transformToString();
    if (!body) return [];
    return JSON.parse(body) as IndexEntry[];
  } catch (err: unknown) {
    // NoSuchKey → first time, empty index
    if ((err as { name?: string }).name === "NoSuchKey") return [];
    throw err;
  }
}

async function saveIndex(entries: IndexEntry[]): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         INDEX_KEY,
    Body:        JSON.stringify(entries),
    ContentType: "application/json",
  }));
}

export async function upsertEntry(entry: IndexEntry): Promise<void> {
  const idx = await loadIndex();
  const existing = idx.findIndex((e) => e.key === entry.key);
  if (existing >= 0) idx[existing] = entry;
  else idx.push(entry);
  await saveIndex(idx);
}

export async function removeEntry(key: string): Promise<void> {
  const idx = await loadIndex();
  const filtered = idx.filter((e) => e.key !== key);
  if (filtered.length !== idx.length) await saveIndex(filtered);
}

/** Replace key (after rename/move) and persist */
export async function renameEntryKey(oldKey: string, newKey: string): Promise<void> {
  const idx = await loadIndex();
  const target = idx.find((e) => e.key === oldKey);
  if (!target) return;
  target.key = newKey;
  target.filename = newKey.split("/").pop() ?? target.filename;
  await saveIndex(idx);
}

/** All entries — read-only snapshot */
export async function getAllEntries(): Promise<IndexEntry[]> {
  return loadIndex();
}

/** Count entries grouped by ai_folder_id */
export async function countByAiFolder(): Promise<Record<string, number>> {
  const idx = await loadIndex();
  const out: Record<string, number> = {};
  for (const e of idx) out[e.ai_folder_id] = (out[e.ai_folder_id] ?? 0) + 1;
  return out;
}

export async function entriesByAiFolder(folderId: string): Promise<IndexEntry[]> {
  const idx = await loadIndex();
  return idx.filter((e) => e.ai_folder_id === folderId);
}

/** Substring search across keywords + subject + filename. Case-insensitive. */
export async function search(query: string): Promise<IndexEntry[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const idx = await loadIndex();
  return idx.filter((e) => {
    if (e.subject.toLowerCase().includes(q)) return true;
    if (e.filename.toLowerCase().includes(q)) return true;
    if (e.detail.toLowerCase().includes(q)) return true;
    return e.keywords.some((kw) => kw.toLowerCase().includes(q));
  });
}
