/**
 * LINE Messaging API helpers — webhook signature verification, reply, and
 * Flex bubble factories for the OA bot.
 *
 * Env:
 *   LINE_CHANNEL_SECRET        — used to verify x-line-signature
 *   LINE_CHANNEL_ACCESS_TOKEN  — bearer token for the Messaging API
 *
 * Signature note: LINE signs the *raw* request bytes. JSON.parse + stringify
 * loses key order and will break verification — always hash req.text() output.
 */

import crypto from "crypto";

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";

export interface LineTextMessage {
  type: "text";
  text: string;
}

export interface LineFlexMessage {
  type: "flex";
  altText: string;
  contents: unknown;
}

export type LineMessage = LineTextMessage | LineFlexMessage;

export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;

  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    console.error("[line] LINE_CHANNEL_SECRET is not set");
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;

  try {
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

export async function replyMessage(
  replyToken: string,
  messages: LineMessage[],
): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");

  const res = await fetch(LINE_REPLY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE reply failed (${res.status}): ${body}`);
  }
}

/**
 * Welcome carousel — 4 full-bleed image bubbles, each tappable to open the
 * LIFF app. The images live in /public/liff and are served from the app's
 * public origin.
 *
 * LINE renders bubble images from a public HTTPS URL — we can't reference
 * /public assets relative to the bot, so we need an absolute origin. Set
 * NEXT_PUBLIC_APP_URL (e.g. https://dear-file.kkiss.site) in the env;
 * falls back to that domain in production.
 */

const IMAGE_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
  "https://dear-file.kkiss.site";

function imageBubble(imageUrl: string, label: string, linkUrl: string) {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "0px",
      contents: [
        {
          type: "image",
          url: imageUrl,
          size: "full",
          aspectMode: "cover",
          aspectRatio: "4:4",
          action: {
            type: "uri",
            label,
            uri: linkUrl,
          },
        },
      ],
    },
  };
}

export function welcomeBubble(liffUrl: string): LineFlexMessage {
  return {
    type: "flex",
    altText: "ยินดีต้อนรับสู่ DearFile / Welcome to DearFile",
    contents: {
      type: "carousel",
      contents: [1, 2, 3, 4].map((n) =>
        imageBubble(`${IMAGE_ORIGIN}/liff/${n}.png`, `action ${n}`, liffUrl),
      ),
    },
  };
}
