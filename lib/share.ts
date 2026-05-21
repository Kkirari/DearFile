/**
 * Share helpers — wraps LIFF shareTargetPicker (LINE) and Web Share API.
 *
 * For LINE share:
 *   - Photos (JPEG/PNG) are sent as real image messages, so they land in the
 *     chat as inline pictures the recipient can tap and save.
 *   - Every file (image or not) also gets a compact Flex "link card" with an
 *     Open button — that's the only way to deliver PDFs / docs / video / etc.,
 *     since the LINE chat protocol has no generic "file" message type.
 *
 * For Web Share:
 *   - Uses navigator.share (system share menu) with a URL.
 *   - Falls back to copying the link to the clipboard.
 */

import type { FileItem } from "@/types/file";

// ── Types & guards ────────────────────────────────────────────────────────────
// `window.liff` is declared globally in types/liff.d.ts as the full LIFF
// SDK type, so we don't redeclare it here.

// Discriminated union of the message shapes we send. Cast to the SDK's
// parameter type at the call site (the SDK's Message union is stricter than
// we need for `contents`).
type LiffMessage =
  | { type: "text"; text: string }
  | { type: "image"; originalContentUrl: string; previewImageUrl: string }
  | { type: "flex"; altText: string; contents: unknown };

// DearFile palette — keep in sync with lib/line.ts so shared cards match the
// product everywhere they appear.
const BRAND_MAUVE    = "#9b869c";
const CARD_CREAM     = "#fbfaf6";
const TEXT_DARK_WARM = "#4a4036";
const TEXT_TAUPE     = "#b0a396";

function isImage(file: FileItem): boolean {
  return file.mimeType.startsWith("image/");
}

/**
 * LINE image messages only accept JPEG/PNG. Other "image" types (webp, heic,
 * gif) can't be sent as inline pictures, so they fall back to the link card.
 */
function isLineInlineImage(file: FileItem): boolean {
  return file.mimeType === "image/jpeg" || file.mimeType === "image/png";
}

function fileKindLabel(file: FileItem): string {
  if (isImage(file))                         return "🖼️ รูปภาพ / Image";
  if (file.mimeType.startsWith("video/"))    return "🎬 วิดีโอ / Video";
  if (file.mimeType.startsWith("audio/"))    return "🎵 เสียง / Audio";
  if (file.mimeType === "application/pdf")   return "📄 PDF";
  return "📎 ไฟล์ / File";
}

/** One compact Flex bubble linking to a single file. */
function fileLinkBubble(file: FileItem): unknown {
  return {
    type: "bubble",
    size: "micro",
    styles: {
      body:   { backgroundColor: CARD_CREAM },
      footer: { backgroundColor: CARD_CREAM },
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      spacing: "xs",
      contents: [
        {
          type: "text",
          text: file.name,
          weight: "bold",
          size: "sm",
          color: TEXT_DARK_WARM,
          wrap: true,
          maxLines: 2,
        },
        {
          type: "text",
          text: fileKindLabel(file),
          size: "xs",
          color: TEXT_TAUPE,
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      paddingTop: "0px",
      contents: [
        {
          type: "button",
          style: "primary",
          color: BRAND_MAUVE,
          height: "sm",
          action: { type: "uri", label: "เปิดไฟล์ / Open", uri: file.url },
        },
      ],
    },
  };
}

/** A Flex message carrying a link card per file (carousel when >1). */
function linkCardMessage(files: FileItem[]): LiffMessage {
  const bubbles = files.slice(0, 12).map(fileLinkBubble); // LINE carousel cap
  const altText =
    files.length === 1
      ? `ไฟล์จาก DearFile: ${files[0].name}`
      : `${files.length} ไฟล์จาก DearFile`;
  return {
    type: "flex",
    altText,
    contents:
      bubbles.length === 1
        ? bubbles[0]
        : { type: "carousel", contents: bubbles },
  };
}

// ── LINE share ────────────────────────────────────────────────────────────────

/**
 * Returns true if LINE share is available in the current LIFF environment.
 *
 * Note: shareTargetPicker must be enabled per-channel in the LINE Developers
 * Console (LIFF tab → shareTargetPicker → accept agreement → Enable) AND the
 * app must be opened inside the LINE client — otherwise isApiAvailable is
 * false and we hide the button.
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

  // Photos go first as inline image messages; everything is then covered by a
  // single link-card (carousel) message so PDFs/docs/video/etc. are reachable.
  const messages: LiffMessage[] = [];

  for (const file of files) {
    if (isLineInlineImage(file)) {
      messages.push({
        type: "image",
        originalContentUrl: file.url,
        previewImageUrl:    file.url,
      });
    }
  }

  // LIFF caps a share at 5 messages — keep room for the link card.
  const imageMessages = messages.slice(0, 4);
  const finalMessages: LiffMessage[] = [...imageMessages, linkCardMessage(files)];

  try {
    // The SDK's Message union types `contents` more strictly than we model it.
    const res = await liff.shareTargetPicker!(
      finalMessages as unknown as Parameters<NonNullable<typeof liff.shareTargetPicker>>[0],
    );
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
