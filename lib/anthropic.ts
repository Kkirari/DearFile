import Anthropic from "@anthropic-ai/sdk";

const MODEL_ID = process.env.ANTHROPIC_MODEL_ID ?? "claude-haiku-4-5";

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

export async function invokeHaiku(
  messages: HaikuMessage[],
  systemPrompt?: string,
  opts?: { apiKey?: string },
): Promise<string> {
  const apiKey = opts?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL_ID,
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
