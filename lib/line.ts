/**
 * LINE Messaging API helpers — webhook signature verification, content
 * download, reply/push, and Flex bubble factories for the OA bot.
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
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
// Note: media bytes live on the api-DATA host, not api.line.me.
const LINE_CONTENT_URL = (messageId: string) =>
  `https://api-data.line.me/v2/bot/message/${messageId}/content`;

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

function accessToken(): string {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
  return token;
}

export async function replyMessage(
  replyToken: string,
  messages: LineMessage[],
): Promise<void> {
  const res = await fetch(LINE_REPLY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken()}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE reply failed (${res.status}): ${body}`);
  }
}

/**
 * Push a message to a user without a replyToken (charged against the LINE
 * push-message quota — use replyMessage when a token is available).
 */
export async function pushMessage(to: string, messages: LineMessage[]): Promise<void> {
  const res = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken()}`,
    },
    body: JSON.stringify({ to, messages }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push failed (${res.status}): ${body}`);
  }
}

/**
 * Fetch a LINE group summary (display name, picture URL). Returns null if
 * the group isn't accessible — e.g. the bot was kicked between events.
 */
export async function fetchGroupSummary(
  groupId: string,
): Promise<{ groupId: string; groupName: string; pictureUrl?: string } | null> {
  const res = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  if (!res.ok) return null;
  return res.json() as Promise<{ groupId: string; groupName: string; pictureUrl?: string }>;
}

/**
 * Download the binary content of a user-uploaded image/video/audio/file
 * message from LINE. Buffers the entire response — LINE caps content at
 * ~300MB but we should fail gracefully on anything close to function memory.
 */
export interface LineContent {
  buffer: Buffer;
  contentType: string;
}

export async function fetchLineContent(messageId: string): Promise<LineContent> {
  const res = await fetch(LINE_CONTENT_URL(messageId), {
    headers: { Authorization: `Bearer ${accessToken()}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE content fetch failed (${res.status}): ${body}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
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

// DearFile palette — keep these in sync with app/globals.css so chat bubbles
// feel like the same product as the LIFF web app.
//   --color-background  #f4f3ee  warm cream page bg
//   --color-card        #fbfaf6  warmer near-white surface
//   --color-foreground  #4a4036  warm dark brown text
//   accent              #9b869c  dusty mauve (buttons / focus)
//   muted               #b0a396  taupe
//   border              #e0d8cc  light beige rule
const BRAND_MAUVE     = "#9b869c";
const CARD_CREAM      = "#fbfaf6";
const TEXT_DARK_WARM  = "#4a4036";
const TEXT_TAUPE      = "#b0a396";
const BORDER_BEIGE    = "#e0d8cc";

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

/**
 * Compact confirmation bubble shown after a chat-uploaded file lands in S3.
 *
 * Deliberately minimal — a `micro` bubble with just a ✓ + filename, one muted
 * folder line, and an Open button — so it barely takes any room in a busy chat.
 * `opts.liffUrl` is a deep link that opens the saved file directly in the LIFF
 * app (built by the webhook). `workspaceName` is set for shared-workspace saves
 * and is shown alongside the folder so members see which space it joined.
 */
export interface UploadSuccessOpts {
  filename: string;
  folderName: string;
  liffUrl: string;
  workspaceName?: string;
}

export function uploadSuccessBubble(opts: UploadSuccessOpts): LineFlexMessage {
  const folderLine = opts.workspaceName
    ? `👥 ${opts.workspaceName} · 📁 ${opts.folderName}`
    : `📁 ${opts.folderName}`;

  return {
    type: "flex",
    altText: `บันทึก ${opts.filename} แล้ว / Saved ${opts.filename}`,
    contents: {
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
        spacing: "sm",
        contents: [
          {
            type: "box",
            layout: "baseline",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: "✓",
                color: BRAND_MAUVE,
                weight: "bold",
                size: "sm",
                flex: 0,
              },
              {
                type: "text",
                text: opts.filename,
                weight: "bold",
                size: "sm",
                color: TEXT_DARK_WARM,
                flex: 1,
                wrap: true,
              },
            ],
          },
          {
            type: "text",
            text: folderLine,
            size: "xs",
            color: TEXT_TAUPE,
            wrap: true,
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
            action: {
              type: "uri",
              label: "เปิด / Open",
              uri: opts.liffUrl,
            },
          },
        ],
      },
    },
  };
}

/**
 * Friendly help bubble shown when the user texts the OA (vs sending media).
 */
export function helpBubble(liffUrl: string): LineFlexMessage {
  return {
    type: "flex",
    altText: "ส่งไฟล์ให้ DearFile / Send a file to DearFile",
    contents: {
      type: "bubble",
      size: "kilo",
      styles: {
        header: { backgroundColor: BRAND_MAUVE },
        body:   { backgroundColor: CARD_CREAM },
        footer: { backgroundColor: CARD_CREAM },
      },
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        paddingBottom: "16px",
        spacing: "xs",
        contents: [
          {
            type: "text",
            text: "DearFile",
            weight: "bold",
            color: "#FFFFFF",
            size: "xl",
          },
          {
            type: "text",
            text: "ส่งไฟล์มาในแชตได้เลย",
            color: "#FFFFFF",
            size: "sm",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        spacing: "md",
        contents: [
          {
            type: "box",
            layout: "baseline",
            spacing: "md",
            contents: [
              { type: "text", text: "📷", flex: 0, size: "md" },
              {
                type: "text",
                text: "ส่งรูป / Send a photo",
                size: "sm",
                color: TEXT_DARK_WARM,
                weight: "bold",
                flex: 0,
              },
            ],
          },
          {
            type: "box",
            layout: "baseline",
            spacing: "md",
            contents: [
              { type: "text", text: "📄", flex: 0, size: "md" },
              {
                type: "text",
                text: "ส่งเอกสาร / Send a document",
                size: "sm",
                color: TEXT_DARK_WARM,
                weight: "bold",
                flex: 0,
              },
            ],
          },
          {
            type: "box",
            layout: "baseline",
            spacing: "md",
            contents: [
              { type: "text", text: "🎬", flex: 0, size: "md" },
              {
                type: "text",
                text: "ส่งวิดีโอ / Send a video",
                size: "sm",
                color: TEXT_DARK_WARM,
                weight: "bold",
                flex: 0,
              },
            ],
          },
          {
            type: "separator",
            margin: "md",
            color: BORDER_BEIGE,
          },
          {
            type: "text",
            text: "AI จะตั้งชื่อและจัดเก็บให้อัตโนมัติ",
            size: "xs",
            color: TEXT_TAUPE,
            margin: "sm",
            wrap: true,
          },
          {
            type: "text",
            text: "AI auto-names and organizes everything",
            size: "xs",
            color: TEXT_TAUPE,
            wrap: true,
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
            action: {
              type: "uri",
              label: "เปิด DearFile / Open",
              uri: liffUrl,
            },
          },
        ],
      },
    },
  };
}
