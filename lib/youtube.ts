/**
 * YouTube content fetch for capture — **transcript-first, serverless-friendly**.
 *
 * We deliberately do NOT use Gemini native video ingestion (heavy media uploads,
 * a poor fit for serverless). Instead we pull the caption text (cheap, fast) and
 * let Haiku summarize it downstream (lib/capture.ts). Caption fetch is tiered:
 * free youtube-transcript → hosted transcript API (Supadata, recovers captions
 * that datacenter IPs are blocked from + AI-generates one for caption-less
 * clips, env SUPADATA_API_KEY) → title + description as a last resort.
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Hosted transcript API (Supadata) — tier-2. Recovers captions that the free
 * `youtube-transcript` path can't get, most importantly when YouTube blocks
 * caption scraping from datacenter IPs (the common "no captions" cause in
 * production). `mode=auto` returns existing manual/auto captions, and falls
 * back to AI-generating a transcript when a video has none — so this also
 * covers genuinely caption-less clips. Skipped (returns null) when no key is
 * set, and never throws. Env: SUPADATA_API_KEY.
 */
const SUPADATA_BASE = "https://api.supadata.ai/v1/transcript";
const SUPADATA_POLL_MS = 2_000;
const SUPADATA_MAX_WAIT_MS = 45_000; // bounded to fit the webhook's after() budget

async function fetchHostedTranscript(url: string): Promise<string | null> {
  const key = process.env.SUPADATA_API_KEY;
  if (!key) return null;
  const headers = { "x-api-key": key };
  try {
    const res = await fetch(
      `${SUPADATA_BASE}?url=${encodeURIComponent(url)}&text=true&mode=auto`,
      { headers },
    );
    if (res.status === 200) {
      const data = (await res.json()) as { content?: string };
      return typeof data.content === "string" && data.content.trim() ? data.content : null;
    }
    // Long videos (>~20 min) return a job to poll.
    if (res.status === 202) {
      const { jobId } = (await res.json()) as { jobId?: string };
      if (!jobId) return null;
      const deadline = Date.now() + SUPADATA_MAX_WAIT_MS;
      while (Date.now() < deadline) {
        await sleep(SUPADATA_POLL_MS);
        const pRes = await fetch(`${SUPADATA_BASE}/${encodeURIComponent(jobId)}`, { headers });
        if (!pRes.ok) return null;
        const job = (await pRes.json()) as { status?: string; content?: string };
        if (job.status === "completed") {
          return typeof job.content === "string" && job.content.trim() ? job.content : null;
        }
        if (job.status === "failed") return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function clampTranscript(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, TRANSCRIPT_MAX_CHARS);
}

/**
 * Fetch the best available text for a YouTube URL, cheapest source first:
 *   1) free youtube-transcript (works when not IP-blocked),
 *   2) hosted transcript API (recovers blocked/auto captions + AI fallback),
 *   3) the description.
 * Never throws — the capture must not be lost.
 */
export async function fetchYouTubeContent(url: string): Promise<YouTubeContent> {
  // 1) Free transcript scrape (primary; fast-fail so we can fall over quickly).
  try {
    const segments = await Promise.race([
      YoutubeTranscript.fetchTranscript(url),
      sleep(8_000).then(() => { throw new Error("transcript timeout"); }),
    ]);
    const text = clampTranscript(segments.map((s) => s.text).join(" "));
    if (text) return { title: await fetchOEmbedTitle(url), text, via: "transcript" };
  } catch {
    /* fall through */
  }

  // 2) Hosted transcript API (Supadata) — fixes datacenter-IP blocks + no-caption clips.
  try {
    const hosted = await fetchHostedTranscript(url);
    if (hosted) {
      const text = clampTranscript(hosted);
      if (text) return { title: await fetchOEmbedTitle(url), text, via: "transcript" };
    }
  } catch {
    /* fall through */
  }

  // 3) Description fallback (no captions anywhere / private / restricted).
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
