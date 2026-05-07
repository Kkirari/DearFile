import Anthropic from "@anthropic-ai/sdk";

const MODEL_ID = process.env.ANTHROPIC_MODEL_ID ?? "claude-haiku-4-5";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

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
  systemPrompt?: string
): Promise<string> {
  const response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 1024,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: messages as Anthropic.MessageParam[],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text;
}
