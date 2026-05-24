/**
 * YouTube content fetch for capture — **transcript-first, serverless-friendly**.
 *
 * We deliberately do NOT use Gemini native video ingestion (heavy media uploads,
 * a poor fit for serverless). Instead we pull the caption text (cheap, fast) and
 * let Haiku summarize it downstream (lib/capture.ts). If there are no captions
 * (music, many vlogs, private videos) we fall back to the title + description.
 *
 * Exposes only fetching here; the actual summarization (3–5 bullets, ignoring
 * messy auto-caption spelling) happens in lib/capture.ts so all content types
 * share one summarizer.
 */

import { YoutubeTranscript } from "youtube-transcript";

export interface YouTubeContent {
  title: string | null;
  /** Caption text (via "transcript") or the description (via "description"). */
  text: string;
  via: "transcript" | "description";
  /** User-facing note prepended to the summary when captions were unavailable. */
  note?: string;
}

const NO_CAPTION_NOTE_TH =
  "วิดีโอนี้ไม่มีคำบรรยาย จึงสรุปจากคำอธิบายแทน";
const NO_CAPTION_NOTE_EN =
  "No captions available — summarized from the video description.";

const TRANSCRIPT_MAX_CHARS = 100_000; // generous; Haiku's context easily holds a full video

export function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

/** Extract the 11-char video id from any common YouTube URL shape. */
export function youtubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/\/(?:shorts|embed|v)\/([^/?#]+)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Title via the public oEmbed endpoint (no API key needed). */
async function fetchOEmbedTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; DearFileBot/1.0)" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    return data.title ?? null;
  } catch {
    return null;
  }
}

/** og:description scraped from the watch page (used only on the no-caption path). */
async function fetchOgDescription(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DearFileBot/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m =
      html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch the best available text for a YouTube URL: the transcript if it exists,
 * otherwise the description. Never throws — the capture must not be lost.
 */
export async function fetchYouTubeContent(url: string): Promise<YouTubeContent> {
  // 1) Transcript (primary).
  try {
    const segments = await YoutubeTranscript.fetchTranscript(url);
    const text = segments
      .map((s) => s.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, TRANSCRIPT_MAX_CHARS);
    if (text) {
      return { title: await fetchOEmbedTitle(url), text, via: "transcript" };
    }
  } catch {
    /* fall through to description */
  }

  // 2) Description fallback (no captions / private / restricted).
  const [title, description] = await Promise.all([
    fetchOEmbedTitle(url),
    fetchOgDescription(url),
  ]);
  return {
    title,
    text: description ?? title ?? url,
    via: "description",
    note: `${NO_CAPTION_NOTE_TH} / ${NO_CAPTION_NOTE_EN}`,
  };
}
