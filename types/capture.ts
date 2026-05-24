/**
 * Client-side shape of a capture (note/link) as returned by /api/captures.
 * Mirrors the server `ContentItem` (lib/db.ts) but lives in its own file so
 * client components don't import the server-only DB module.
 */
export type CaptureType = "note" | "link";
export type CaptureStatus = "pending" | "processing" | "ready" | "failed";

export interface Capture {
  id: string;
  userId: string;
  type: CaptureType;
  status: CaptureStatus;
  sourceUrl: string | null;
  title: string | null;
  rawText: string;
  summary: string | null;
  category: string | null;
  tags: string[] | null;
  lang: string | null;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
}
