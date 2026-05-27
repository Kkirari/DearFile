/**
 * Voice-note transcription — OpenAI `/v1/audio/transcriptions`, hosted only
 * for v1. Used by the LINE webhook's audio branch to turn a voice message
 * into text that flows through the existing note-capture pipeline.
 *
 * Env:
 *   OPENAI_API_KEY         — required to enable the feature (graceful no-op otherwise)
 *   TRANSCRIBE_MODEL_ID    — default "gpt-4o-mini-transcribe"; swap to whisper-1
 *                            or gpt-4o-transcribe without code change
 *   TRANSCRIBE_MAX_BYTES   — optional early-reject guard (default 10 MB)
 *
 * Uses native global FormData + Blob (Node 22+ on Vercel) — no extra deps.
 */

const URL_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export function transcriptionEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export function transcriptionMaxBytes(): number {
  const raw = Number(process.env.TRANSCRIBE_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BYTES;
}

function pickFilename(contentType: string): string {
  const lower = contentType.toLowerCase();
  if (lower.includes("mp4") || lower.includes("m4a") || lower.includes("aac")) return "voice.m4a";
  if (lower.includes("ogg")) return "voice.ogg";
  if (lower.includes("wav")) return "voice.wav";
  if (lower.includes("webm")) return "voice.webm";
  if (lower.includes("mpeg")) return "voice.mp3";
  return "voice.m4a"; // LINE's most common audio container
}

/**
 * Transcribe one audio buffer to plain text. Throws on misconfiguration or
 * API error — the caller is expected to catch and surface a friendly message.
 *
 * `languageHint` ("th" / "en") biases the model but doesn't restrict it;
 * mixed Thai/English usually still transcribes well.
 */
export async function transcribeAudio(
  buffer: Buffer,
  contentType: string,
  opts: { languageHint?: string } = {},
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  if (buffer.byteLength === 0) throw new Error("Empty audio buffer");

  const model    = process.env.TRANSCRIBE_MODEL_ID ?? DEFAULT_MODEL;
  const filename = pickFilename(contentType);
  // The Web standard FormData expects a Blob; a Node Buffer is acceptable as
  // BlobPart in modern undici (Node 18.17+ / 20+).
  const blob = new Blob([new Uint8Array(buffer)], { type: contentType || "audio/m4a" });

  const form = new FormData();
  form.set("file", blob, filename);
  form.set("model", model);
  form.set("response_format", "text"); // returns the transcript as plain text
  if (opts.languageHint) form.set("language", opts.languageHint);

  const res = await fetch(URL_ENDPOINT, {
    method:  "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body:    form,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI transcription failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  // With response_format=text the body is the transcript itself (no JSON).
  const text = (await res.text()).trim();
  if (!text) throw new Error("Empty transcript returned");
  return text;
}
