import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL_ID = "claude-haiku-4-5";

export type TextBlock = { type: "text"; text: string };
export type ImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
};
export type ContentBlock = TextBlock | ImageBlock;

export interface HaikuMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

/**
 * Direct Anthropic Messages call. Used by the file analyzer (image vision) and
 * any non-AI-SDK caller. Defaults to Haiku for cost; pass `opts.modelId` to
 * override per-call (e.g. analyzer can flip to Sonnet for sharper vision via
 * ANALYZER_MODEL_ID).
 */
export async function invokeHaiku(
  messages: HaikuMessage[],
  systemPrompt?: string,
  opts?: { apiKey?: string; modelId?: string },
): Promise<string> {
  const apiKey = opts?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = opts?.modelId || process.env.ANTHROPIC_MODEL_ID || DEFAULT_MODEL_ID;
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: messages as Anthropic.MessageParam[],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Unexpected or empty response from Claude");
  }
  return block.text;
}
