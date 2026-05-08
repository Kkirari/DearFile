/**
 * Share helpers — wraps LIFF shareTargetPicker (LINE) and Web Share API.
 *
 * For LINE share:
 *   - Images are sent as image messages
 *   - Other files are sent as text with the download URL
 *
 * For Web Share:
 *   - Uses navigator.share with files when supported (modern Chrome/Safari)
 *   - Falls back to URL-only share
 */

import type { FileItem } from "@/types/file";

// ── Types & guards ────────────────────────────────────────────────────────────

interface LiffMessage {
  type: "text" | "image";
  text?: string;
  originalContentUrl?: string;
  previewImageUrl?: string;
}

interface Liff {
  isApiAvailable?: (apiName: string) => boolean;
  shareTargetPicker?: (
    messages: LiffMessage[],
    options?: { isMultiple?: boolean }
  ) => Promise<{ status: string } | undefined>;
}

declare global {
  interface Window {
    liff?: Liff;
  }
}

function isImage(file: FileItem): boolean {
  return file.mimeType.startsWith("image/");
}

// ── LINE share ────────────────────────────────────────────────────────────────

/**
 * Returns true if LINE share is available in the current LIFF environment.
 */
export function canShareToLine(): boolean {
  if (typeof window === "undefined") return false;
  const liff = window.liff;
  if (!liff?.shareTargetPicker) return false;
  if (liff.isApiAvailable && !liff.isApiAvailable("shareTargetPicker")) return false;
  return true;
}

export async function shareToLine(files: FileItem[]): Promise<"success" | "cancelled" | "error"> {
  if (!canShareToLine() || files.length === 0) return "error";
  const liff = window.liff!;

  // Build message list — images become image messages, others get a text message
  const messages: LiffMessage[] = [];
  const nonImages: FileItem[] = [];

  for (const file of files) {
    if (isImage(file)) {
      messages.push({
        type: "image",
        originalContentUrl: file.url,
        previewImageUrl:    file.url,
      });
    } else {
      nonImages.push(file);
    }
  }

  // Combine non-images into a single text message
  if (nonImages.length > 0) {
    const lines = nonImages.map((f) => `📄 ${f.name}\n${f.url}`).join("\n\n");
    messages.push({
      type: "text",
      text: nonImages.length === 1
        ? lines
        : `Sharing ${nonImages.length} files:\n\n${lines}`,
    });
  }

  // LIFF caps at 5 messages per share — slice if needed
  const truncated = messages.slice(0, 5);

  try {
    const res = await liff.shareTargetPicker!(truncated);
    return res?.status === "success" ? "success" : "cancelled";
  } catch (err) {
    console.error("[shareToLine] failed:", err);
    return "error";
  }
}

// ── Web Share API (other apps) ────────────────────────────────────────────────

export function canShareViaWeb(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export async function shareViaWeb(files: FileItem[]): Promise<"success" | "cancelled" | "error"> {
  if (!canShareViaWeb() || files.length === 0) return "error";

  // Compose share payload — try to attach actual files first; fall back to URLs.
  const title = files.length === 1 ? files[0].name : `${files.length} files`;
  const urls  = files.map((f) => `${f.name}\n${f.url}`).join("\n\n");

  try {
    await navigator.share({
      title,
      text:  files.length === 1 ? `Shared from DearFile` : `Sharing ${files.length} files from DearFile`,
      url:   files[0].url, // Web Share API only accepts one URL — use the first
    });
    return "success";
  } catch (err) {
    // AbortError = user cancelled — not an actual error
    if (err instanceof Error && err.name === "AbortError") return "cancelled";
    console.error("[shareViaWeb] failed:", err);
    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(urls);
      return "success";
    } catch {
      return "error";
    }
  }
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

export async function copyLinks(files: FileItem[]): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  if (files.length === 0) return false;
  const text = files.length === 1
    ? files[0].url
    : files.map((f) => `${f.name}\n${f.url}`).join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error("[copyLinks] failed:", err);
    return false;
  }
}
