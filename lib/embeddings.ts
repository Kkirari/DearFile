/**
 * Voyage embeddings (warm-tier semantic backbone). Voyage-3-large is multilingual
 * and strong on Thai — the agreed choice over OpenAI for this market.
 *
 * Output dimension is pinned to 1024 to match the `vector(1024)` column.
 * Called best-effort at capture time; a missing key / API error must NOT lose a
 * capture (the caller catches and stores the item without a chunk).
 *
 * Env: VOYAGE_API_KEY, optional EMBED_MODEL (default voyage-3-large).
 */

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = process.env.EMBED_MODEL ?? "voyage-3-large";
export const EMBED_DIMS = 1024;

export function embeddingsEnabled(): boolean {
  return !!process.env.VOYAGE_API_KEY;
}

/**
 * Embed one or more texts → array of 1024-d vectors (same order as input).
 * `inputType` lets Voyage optimize: "document" when storing, "query" when searching.
 * Throws on misconfiguration / API error — callers decide whether to degrade.
 */
export async function embed(
  texts: string[],
  inputType: "document" | "query" = "document",
): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set");
  if (texts.length === 0) return [];

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: texts,
      input_type: inputType,
      output_dimension: EMBED_DIMS,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage embeddings failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { data?: { embedding: number[] }[] };
  const out = (data.data ?? []).map((d) => d.embedding);
  if (out.length !== texts.length) {
    throw new Error(`Voyage returned ${out.length} embeddings for ${texts.length} inputs`);
  }
  return out;
}

/** Convenience for a single text. */
export async function embedOne(
  text: string,
  inputType: "document" | "query" = "document",
): Promise<number[]> {
  const [v] = await embed([text], inputType);
  return v;
}
