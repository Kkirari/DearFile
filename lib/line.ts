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
 * Welcome Flex bubble — bilingual (Thai primary, English secondary) with an
 * "Open DearFile" CTA that deep-links into the LIFF app.
 */
export function welcomeBubble(liffUrl: string): LineFlexMessage {
  return {
    type: "flex",
    altText: "ยินดีต้อนรับสู่ DearFile / Welcome to DearFile",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "DearFile",
            weight: "bold",
            size: "xxl",
            color: "#111111",
          },
          {
            type: "text",
            text: "คลังไฟล์ส่วนตัวขับเคลื่อนด้วย AI ในแอป LINE\nYour AI-powered cloud storage in LINE",
            size: "sm",
            color: "#666666",
            wrap: true,
          },
          { type: "separator", margin: "lg" },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            margin: "lg",
            contents: [
              {
                type: "text",
                text: "• ส่งไฟล์ในแชต / Send files in chat",
                size: "sm",
                color: "#333333",
                wrap: true,
              },
              {
                type: "text",
                text: "• ตั้งชื่อและจัดอัตโนมัติ / Auto-named & organized",
                size: "sm",
                color: "#333333",
                wrap: true,
              },
              {
                type: "text",
                text: "• ค้นหาด้วยคำค้น / Search by keyword",
                size: "sm",
                color: "#333333",
                wrap: true,
              },
            ],
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#06C755",
            action: {
              type: "uri",
              label: "Open DearFile",
              uri: liffUrl,
            },
          },
        ],
      },
    },
  };
}
