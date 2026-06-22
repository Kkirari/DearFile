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
import type { IndexEntry } from "./search-index";

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

const LINE_MAX_MESSAGES = 5;
const LINE_TEXT_MAX_CHARS = 5000;
const LINE_ALT_TEXT_MAX_CHARS = 400;
// Keep a safety margin under LINE's Flex payload constraints so generated
// answers/summaries can't make the Messaging API reject the whole reply.
const LINE_FLEX_SAFE_JSON_BYTES = 45_000;

const LINE_FLEX_LONG_TEXT_CHARS = 1200;
const LINE_FLEX_MEDIUM_TEXT_CHARS = 240;
const LINE_FLEX_SHORT_TEXT_CHARS = 80;

function truncateText(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) return value;
  if (maxChars <= 1) return "…";
  return `${chars.slice(0, maxChars - 1).join("")}…`;
}

function truncateMiddle(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) return value;
  if (maxChars <= 1) return "…";
  const keep = maxChars - 1;
  const start = Math.ceil(keep / 2);
  const end = Math.floor(keep / 2);
  return `${chars.slice(0, start).join("")}…${chars.slice(chars.length - end).join("")}`;
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function flexTooLargeFallback(): LineTextMessage {
  return {
    type: "text",
    text:
      "บันทึกแล้ว แต่ข้อความยาวเกินกว่าที่ LINE แสดงได้ เปิด DearFile เพื่อดูรายละเอียด\n" +
      "Saved, but the LINE preview was too large. Open DearFile to view details.",
  };
}

function sanitizeLineMessages(messages: LineMessage[]): LineMessage[] {
  return messages.slice(0, LINE_MAX_MESSAGES).map((message) => {
    if (message.type === "text") {
      return {
        ...message,
        text: truncateText(message.text, LINE_TEXT_MAX_CHARS),
      };
    }

    const sanitized: LineFlexMessage = {
      ...message,
      altText: truncateText(message.altText, LINE_ALT_TEXT_MAX_CHARS),
    };

    return jsonByteLength(sanitized) > LINE_FLEX_SAFE_JSON_BYTES
      ? flexTooLargeFallback()
      : sanitized;
  });
}

export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
): boolean {
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
    body: JSON.stringify({
      replyToken,
      messages: sanitizeLineMessages(messages),
    }),
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
export async function pushMessage(
  to: string,
  messages: LineMessage[],
): Promise<void> {
  const res = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken()}`,
    },
    body: JSON.stringify({ to, messages: sanitizeLineMessages(messages) }),
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
  const res = await fetch(
    `https://api.line.me/v2/bot/group/${groupId}/summary`,
    {
      headers: { Authorization: `Bearer ${accessToken()}` },
    },
  );
  if (!res.ok) return null;
  return res.json() as Promise<{
    groupId: string;
    groupName: string;
    pictureUrl?: string;
  }>;
}

/**
 * Make the bot leave a LINE group. LINE returns 200 on success; 404 if the
 * bot isn't in the group anymore (already left / kicked). We treat 404 as a
 * no-op so the caller can fire-and-forget.
 */
export async function leaveGroup(groupId: string): Promise<void> {
  const res = await fetch(`https://api.line.me/v2/bot/group/${groupId}/leave`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  if (res.ok || res.status === 404) return;
  const body = await res.text();
  throw new Error(`LINE leave group failed (${res.status}): ${body}`);
}

/**
 * Phrases a group member can type to make the bot leave the group with a
 * witty one-liner reply. Exact match (case-insensitive, leading / ! @ tolerated).
 * Extend this list to add more kick phrases.
 */
export const GROUP_LEAVE_COMMANDS: readonly string[] = [
  "!น้องกวาง หมดเวลาแล้วเธอคงต้องไป",
];

/** Reply sent back to the group right before the bot leaves. */
export const GROUP_LEAVE_REPLY_TEXT = "พริ๊ๆจะทำจริงๆหรอครับ 😢";

export function isGroupLeaveCommand(text: string): boolean {
  const t = (text ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[/!@]/, "")
    .trim();
  return GROUP_LEAVE_COMMANDS.some((cmd) => {
    const normalized = cmd
      .trim()
      .toLowerCase()
      .replace(/^[/!@]/, "")
      .trim();
    return (
      t === normalized ||
      t.startsWith(`${normalized} `) ||
      t.startsWith(`${normalized}\n`)
    );
  });
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

export async function fetchLineContent(
  messageId: string,
): Promise<LineContent> {
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
const BRAND_MAUVE = "#9b869c";
const CARD_CREAM = "#fbfaf6";
const TEXT_DARK_WARM = "#4a4036";
const TEXT_TAUPE = "#b0a396";
const BORDER_BEIGE = "#e0d8cc";

function imageBubble(imageUrl: string, action: ImageBubbleAction) {
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
          action,
        },
      ],
    },
  };
}

/**
 * Action attached to an image bubble.
 * - `uri`      — opens a link
 * - `message`  — sends a user-typed text (LINE echoes it as if the user typed it)
 * - `postback` — fires a silent webhook event; bot replies via replyMessage /
 *                pushMessage. Used when the OA itself should send the message.
 */
export type ImageBubbleAction =
  | { type: "uri"; label?: string; uri: string }
  | { type: "message"; label?: string; text: string }
  | { type: "postback"; label?: string; data: string };

const ADD_FRIEND_OA_URL = "https://line.me/R/ti/p/@297ybspj";

const GROUP_WELCOME_EXAMPLES_TEXT =
  "พริ๊ๆสามารถสั่งน้องกวางได้มากมายเช่น\n" +
  "!น้องกวาง หารูปแมวส้ม\n" +
  "!น้องกวาง สร้างโฟลเดอร์ชื่อการบ้านครั้งที่1";

const GROUP_WELCOME_KICK_TEXT =
  'พริ๊ๆสามารถไล่น้องกวางโดยพิมพ์ว่า "!น้องกวาง หมดเวลาแล้วเธอคงต้องไป" พริ๊ๆจะทำจริงๆหรอครับ';

/**
 * Welcome carousel.
 *
 * - DM (`follow` event): all 4 cards open the LIFF URL — same as before.
 * - Group (`join` event): mixed actions so members can poke the bot from the
 *   bubble itself.
 *     1 — open LIFF (same)
 *     2 — sends the example-commands text (the user can then tap Send)
 *     3 — opens the OA add-friend page so non-friends can friend it
 *     4 — sends the kick-command text (so the user just taps Send to fire it)
 */
export function welcomeBubble(
  liffUrl: string,
  opts: { forGroup?: boolean } = {},
): LineFlexMessage {
  if (!opts.forGroup) {
    return {
      type: "flex",
      altText: "ยินดีต้อนรับสู่ DearFile / Welcome to DearFile",
      contents: {
        type: "carousel",
        contents: [1, 2, 3, 4].map((n) =>
          imageBubble(`${IMAGE_ORIGIN}/liff/${n}.png`, {
            type: "uri",
            label: `action ${n}`,
            uri: liffUrl,
          }),
        ),
      },
    };
  }

  return {
    type: "flex",
    altText: "ยินดีต้อนรับสู่ DearFile / Welcome to DearFile",
    contents: {
      type: "carousel",
      contents: [
        imageBubble(`${IMAGE_ORIGIN}/liff/1.png`, {
          type: "uri",
          label: "เปิด / Open",
          uri: liffUrl,
        }),
        // Bubble 2: bot replies with a formatted examples Flex when tapped
        // (postback → webhook → replyMessage). No user-typed message.
        imageBubble(`${IMAGE_ORIGIN}/liff/2.png`, {
          type: "postback",
          label: "สั่งน้องกวาง",
          data: "welcome:examples",
        }),
        imageBubble(`${IMAGE_ORIGIN}/liff/3.png`, {
          type: "uri",
          label: "แอด OA",
          uri: ADD_FRIEND_OA_URL,
        }),
        // Bubble 4: bot replies with a formatted kick-hint Flex when tapped
        imageBubble(`${IMAGE_ORIGIN}/liff/4.png`, {
          type: "postback",
          label: "ไล่น้องกวาง",
          data: "welcome:kick_hint",
        }),
      ],
    },
  };
}

/**
 * Formatted "examples" reply bubble. Sent by the bot (via replyMessage) when a
 * group member taps bubble 2 of the welcome carousel. Replaces the plain
 * multi-line text we'd otherwise post into a busy chat.
 */
export function examplesBubble(liffUrl: string): LineFlexMessage {
  return {
    type: "flex",
    altText: "ตัวอย่างคำสั่งน้องกวาง / Example DearFile commands",
    contents: {
      type: "bubble",
      size: "kilo",
      styles: {
        header: { backgroundColor: BRAND_MAUVE },
        body: { backgroundColor: CARD_CREAM },
        footer: { backgroundColor: CARD_CREAM },
      },
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        contents: [
          {
            type: "text",
            text: "🦌 สั่งน้องกวางได้หลายแบบ",
            weight: "bold",
            color: "#FFFFFF",
            size: "lg",
            wrap: true,
          },
          {
            type: "text",
            text: "พิมพ์ข้อความนี้ส่งมาในกลุ่มเลย",
            color: "#FFFFFFCC",
            size: "xs",
            margin: "sm",
            wrap: true,
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "md",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            spacing: "md",
            alignItems: "center",
            contents: [
              { type: "text", text: "🐱", size: "xxl", flex: 0 },
              {
                type: "box",
                layout: "vertical",
                flex: 1,
                spacing: "xs",
                contents: [
                  {
                    type: "text",
                    text: "หารูปแมวส้ม",
                    weight: "bold",
                    color: TEXT_DARK_WARM,
                    size: "sm",
                  },
                  {
                    type: "text",
                    text: "!น้องกวาง หารูปแมวส้ม",
                    color: BRAND_MAUVE,
                    size: "xs",
                    wrap: true,
                  },
                ],
              },
            ],
          },
          {
            type: "separator",
            margin: "xs",
            color: BORDER_BEIGE,
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "md",
            alignItems: "center",
            contents: [
              { type: "text", text: "📁", size: "xxl", flex: 0 },
              {
                type: "box",
                layout: "vertical",
                flex: 1,
                spacing: "xs",
                contents: [
                  {
                    type: "text",
                    text: "สร้างโฟลเดอร์",
                    weight: "bold",
                    color: TEXT_DARK_WARM,
                    size: "sm",
                  },
                  {
                    type: "text",
                    text: "!น้องกวาง สร้างโฟลเดอร์ชื่อการบ้านครั้งที่1",
                    color: BRAND_MAUVE,
                    size: "xs",
                    wrap: true,
                  },
                ],
              },
            ],
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
              label: "เปิด DearFile",
              uri: liffUrl,
            },
          },
        ],
      },
    },
  };
}

/**
 * Formatted "kick" hint bubble. Sent by the bot when a group member taps
 * bubble 4 of the welcome carousel. Shows the exact kick phrase in a
 * highlighted box plus what the bot will reply.
 */
export function kickHintBubble(liffUrl: string): LineFlexMessage {
  return {
    type: "flex",
    altText: "วิธีไล่น้องกวางออกจากกลุ่ม / How to kick DearFile",
    contents: {
      type: "bubble",
      size: "kilo",
      styles: {
        header: { backgroundColor: BRAND_MAUVE },
        body: { backgroundColor: CARD_CREAM },
        footer: { backgroundColor: CARD_CREAM },
      },
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        contents: [
          {
            type: "text",
            text: "👋 อยากไล่น้องกวาง?",
            weight: "bold",
            color: "#FFFFFF",
            size: "lg",
            wrap: true,
          },
          {
            type: "text",
            text: "พิมพ์ข้อความนี้ส่งมาในกลุ่มเลย",
            color: "#FFFFFFCC",
            size: "xs",
            margin: "sm",
            wrap: true,
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
            layout: "vertical",
            paddingAll: "12px",
            backgroundColor: "#FFFFFF",
            cornerRadius: "md",
            contents: [
              {
                type: "text",
                text: "!น้องกวาง หมดเวลาแล้วเธอคงต้องไป",
                size: "sm",
                color: TEXT_DARK_WARM,
                wrap: true,
                weight: "bold",
              },
            ],
          },
          {
            type: "text",
            text: 'พริ๊ๆจะตอบกลับ "ต้องการผมเมื่อไรเรียกได้ตลอดนะพริ๊ๆ 😢" แล้วออกจากกลุ่มเลย',
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
              label: "เปิด DearFile",
              uri: liffUrl,
            },
          },
        ],
      },
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

export interface UploadBatchSuccessOpts {
  files: UploadSuccessOpts[];
  liffUrl: string;
  workspaceName?: string;
}

export function uploadSuccessBubble(opts: UploadSuccessOpts): LineFlexMessage {
  const filename = truncateMiddle(opts.filename, LINE_FLEX_SHORT_TEXT_CHARS);
  const folderName = truncateMiddle(
    opts.folderName,
    LINE_FLEX_SHORT_TEXT_CHARS,
  );
  const workspaceName = opts.workspaceName
    ? truncateMiddle(opts.workspaceName, LINE_FLEX_SHORT_TEXT_CHARS)
    : null;
  const folderLine = workspaceName
    ? `👥 ${workspaceName} · 📁 ${folderName}`
    : `📁 ${folderName}`;

  return {
    type: "flex",
    altText: truncateText(
      `บันทึก ${filename} แล้ว / Saved ${filename}`,
      LINE_ALT_TEXT_MAX_CHARS,
    ),
    contents: {
      type: "bubble",
      size: "micro",
      styles: {
        body: { backgroundColor: CARD_CREAM },
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
                text: filename,
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
export function uploadBatchSuccessBubble(
  opts: UploadBatchSuccessOpts,
): LineFlexMessage {
  const shown = opts.files.slice(0, 5);
  const hiddenCount = Math.max(opts.files.length - shown.length, 0);
  const uniqueFolders = Array.from(
    new Set(opts.files.map((f) => f.folderName)),
  );
  const folders = uniqueFolders
    .slice(0, 2)
    .map((folder) => truncateMiddle(folder, LINE_FLEX_SHORT_TEXT_CHARS));
  const workspaceName = opts.workspaceName
    ? truncateMiddle(opts.workspaceName, LINE_FLEX_SHORT_TEXT_CHARS)
    : null;
  const folderSuffix = `${folders.join(", ")}${folders.length < uniqueFolders.length ? "…" : ""}`;
  const folderLine = workspaceName
    ? `👥 ${workspaceName} · 📁 ${folderSuffix}`
    : `📁 ${folderSuffix}`;

  return {
    type: "flex",
    altText: truncateText(
      `บันทึก ${opts.files.length} ไฟล์แล้ว / Saved ${opts.files.length} files`,
      LINE_ALT_TEXT_MAX_CHARS,
    ),
    contents: {
      type: "bubble",
      size: "kilo",
      styles: {
        header: { backgroundColor: BRAND_MAUVE },
        body: { backgroundColor: CARD_CREAM },
        footer: { backgroundColor: CARD_CREAM },
      },
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        spacing: "xs",
        contents: [
          {
            type: "text",
            text: `✓ บันทึกแล้ว ${opts.files.length} ไฟล์`,
            weight: "bold",
            color: "#FFFFFF",
            size: "lg",
            wrap: true,
          },
          {
            type: "text",
            text: "Saved as one batch, no chat spam",
            color: "#FFFFFFCC",
            size: "xs",
            wrap: true,
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "sm",
        contents: [
          {
            type: "text",
            text: folderLine,
            size: "xs",
            color: TEXT_TAUPE,
            wrap: true,
          },
          {
            type: "separator",
            margin: "sm",
            color: BORDER_BEIGE,
          },
          ...shown.map((file) => ({
            type: "box" as const,
            layout: "baseline" as const,
            spacing: "sm" as const,
            contents: [
              {
                type: "text" as const,
                text: "•",
                color: BRAND_MAUVE,
                size: "sm" as const,
                flex: 0,
              },
              {
                type: "text" as const,
                text: truncateMiddle(file.filename, LINE_FLEX_SHORT_TEXT_CHARS),
                color: TEXT_DARK_WARM,
                size: "sm" as const,
                weight: "bold" as const,
                flex: 1,
                wrap: true,
              },
            ],
          })),
          ...(hiddenCount > 0
            ? [
                {
                  type: "text" as const,
                  text: `+ อีก ${hiddenCount} ไฟล์ / ${hiddenCount} more files`,
                  color: TEXT_TAUPE,
                  size: "xs" as const,
                  margin: "sm" as const,
                  wrap: true,
                },
              ]
            : []),
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
              label: "เปิดทั้งหมด / Open files",
              uri: opts.liffUrl,
            },
          },
        ],
      },
    },
  };
}

export function helpBubble(liffUrl: string): LineFlexMessage {
  return {
    type: "flex",
    altText: "ส่งไฟล์ให้ DearFile / Send a file to DearFile",
    contents: {
      type: "bubble",
      size: "kilo",
      styles: {
        header: { backgroundColor: BRAND_MAUVE },
        body: { backgroundColor: CARD_CREAM },
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

/**
 * Answer bubble for "Ask DearFile" — the model's grounded reply plus up to a
 * few tappable citations. Each citation deep-links to that file in the LIFF
 * app (the caller builds the URL with `liffUrlFor`, which carries `?file=&ws=`).
 *
 * One compact `kilo` bubble in the DearFile palette: the wrapped answer, a
 * separator, then `📄 {filename}` rows. With no citations (nothing matched)
 * the bubble is just the answer text.
 */
/** A tappable citation row in an answer bubble (icon + label → a deep link/URL). */
export interface AnswerRow {
  icon: string;
  label: string;
  uri: string;
}

export function answerBubble(
  answer: string,
  rows: AnswerRow[],
): LineFlexMessage {
  const safeAnswer = truncateText(
    answer.trim() || "—",
    LINE_FLEX_LONG_TEXT_CHARS,
  );
  const bodyContents: unknown[] = [
    {
      type: "text",
      text: safeAnswer,
      size: "sm",
      color: TEXT_DARK_WARM,
      wrap: true,
    },
  ];

  const safeRows = rows.slice(0, 3);
  if (safeRows.length > 0) {
    bodyContents.push({ type: "separator", margin: "lg", color: BORDER_BEIGE });
    for (const row of safeRows) {
      bodyContents.push({
        type: "box",
        layout: "baseline",
        spacing: "sm",
        margin: "md",
        action: { type: "uri", label: "เปิด / Open", uri: row.uri },
        contents: [
          { type: "text", text: row.icon, flex: 0, size: "sm" },
          {
            type: "text",
            text: truncateMiddle(row.label, LINE_FLEX_SHORT_TEXT_CHARS),
            size: "sm",
            color: BRAND_MAUVE,
            weight: "bold",
            flex: 1,
            wrap: true,
          },
        ],
      });
    }
  }

  const altText = truncateText(safeAnswer, 60);

  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble",
      size: "kilo",
      styles: { body: { backgroundColor: CARD_CREAM } },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        spacing: "sm",
        contents: bodyContents,
      },
    },
  };
}

/**
 * Daily summary bubble — the end-of-day brief (Phase 6). A header strip with
 * the date, the AI-synthesized recap, a count line, and up to a few tappable
 * file highlights that deep-link into the LIFF app. `liffUrlFor` builds each
 * highlight's `?file=` deep link; `liffHome` is the plain app link for the
 * footer button.
 */
export interface DailySummaryView {
  date: string;
  count: number;
  text: string;
  highlights: IndexEntry[];
}

export function summaryBubble(
  view: DailySummaryView,
  liffUrlFor: (entry: IndexEntry) => string,
  liffHome: string,
): LineFlexMessage {
  const summaryText = truncateText(
    view.text.trim() || "—",
    LINE_FLEX_LONG_TEXT_CHARS,
  );
  const highlights = view.highlights.slice(0, 3);
  const bodyContents: unknown[] = [
    {
      type: "text",
      text: `วันนี้บันทึก ${view.count} ไฟล์ / ${view.count} saved today`,
      size: "xs",
      color: TEXT_TAUPE,
      wrap: true,
    },
    {
      type: "text",
      text: summaryText,
      size: "sm",
      color: TEXT_DARK_WARM,
      wrap: true,
      margin: "md",
    },
  ];

  if (highlights.length > 0) {
    bodyContents.push({ type: "separator", margin: "lg", color: BORDER_BEIGE });
    for (const entry of highlights) {
      bodyContents.push({
        type: "box",
        layout: "baseline",
        spacing: "sm",
        margin: "md",
        action: { type: "uri", label: "เปิด / Open", uri: liffUrlFor(entry) },
        contents: [
          { type: "text", text: "📄", flex: 0, size: "sm" },
          {
            type: "text",
            text: truncateMiddle(entry.filename, LINE_FLEX_SHORT_TEXT_CHARS),
            size: "sm",
            color: BRAND_MAUVE,
            weight: "bold",
            flex: 1,
            wrap: true,
          },
        ],
      });
    }
  }

  return {
    type: "flex",
    altText: `📋 สรุปวันนี้ · ${view.date} / Today's recap`,
    contents: {
      type: "bubble",
      size: "kilo",
      styles: {
        header: { backgroundColor: BRAND_MAUVE },
        body: { backgroundColor: CARD_CREAM },
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
            text: "📋 สรุปวันนี้ / Today's recap",
            weight: "bold",
            color: "#FFFFFF",
            size: "md",
          },
          {
            type: "text",
            text: view.date,
            color: "#FFFFFF",
            size: "xs",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        spacing: "sm",
        contents: bodyContents,
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
              uri: liffHome,
            },
          },
        ],
      },
    },
  };
}

/**
 * Capture result bubble (Phase 7) — delivered by the background task after a
 * note/link/YouTube capture is summarized. Shows the title, the AI summary, and
 * tags, with a button into the LIFF Timeline tab (and, for links, the source).
 */
export interface CaptureView {
  type: "note" | "link";
  title: string | null;
  summary: string | null;
  sourceUrl: string | null;
  tags?: string[] | null;
}

export function captureResultBubble(
  item: CaptureView,
  liffTimelineUrl: string,
): LineFlexMessage {
  const icon = item.type === "link" ? "🔗" : "📝";
  const title = truncateText(
    item.title?.trim() || (item.type === "link" ? "Saved link" : "Saved note"),
    LINE_FLEX_SHORT_TEXT_CHARS,
  );
  const summary = truncateText(
    item.summary?.trim() || "—",
    LINE_FLEX_LONG_TEXT_CHARS,
  );
  const tagLine = (item.tags ?? [])
    .filter(Boolean)
    .slice(0, 5)
    .map((t) => `#${truncateText(t, 30)}`)
    .join("  ");

  const bodyContents: unknown[] = [
    {
      type: "box",
      layout: "baseline",
      spacing: "sm",
      contents: [
        { type: "text", text: icon, flex: 0, size: "sm" },
        {
          type: "text",
          text: title,
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
      text: summary,
      size: "sm",
      color: TEXT_DARK_WARM,
      wrap: true,
      margin: "md",
    },
  ];
  if (tagLine) {
    bodyContents.push({
      type: "text",
      text: tagLine,
      size: "xs",
      color: TEXT_TAUPE,
      wrap: true,
      margin: "md",
    });
  }

  const footerButtons: unknown[] = [
    {
      type: "button",
      style: "primary",
      color: BRAND_MAUVE,
      height: "sm",
      action: {
        type: "uri",
        label: "ดูใน DearFile / Open",
        uri: liffTimelineUrl,
      },
    },
  ];
  if (item.type === "link" && item.sourceUrl) {
    footerButtons.push({
      type: "button",
      style: "secondary",
      height: "sm",
      action: { type: "uri", label: "เปิดลิงก์ / Source", uri: item.sourceUrl },
    });
  }

  return {
    type: "flex",
    altText: truncateText(
      `✓ บันทึกแล้ว: ${title} / Saved to Timeline`,
      LINE_ALT_TEXT_MAX_CHARS,
    ),
    contents: {
      type: "bubble",
      size: "kilo",
      styles: {
        header: { backgroundColor: BRAND_MAUVE },
        body: { backgroundColor: CARD_CREAM },
        footer: { backgroundColor: CARD_CREAM },
      },
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: "✓ บันทึกลง Timeline / Saved",
            weight: "bold",
            color: "#FFFFFF",
            size: "sm",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        spacing: "sm",
        contents: bodyContents,
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        paddingTop: "0px",
        spacing: "sm",
        contents: footerButtons,
      },
    },
  };
}

/**
 * Warm canned reply for greetings / small talk (the Hybrid Intent Router routes
 * non-question DM text here instead of paying for the Ask pipeline). A compact
 * bubble that nudges the user toward asking for a file, with an Open button.
 */
export function greetingBubble(liffUrl: string): LineFlexMessage {
  return {
    type: "flex",
    altText: "สวัสดีค่ะ! ลองถามหาไฟล์ได้เลย / Hi! Ask me to find a file.",
    contents: {
      type: "bubble",
      size: "kilo",
      styles: {
        body: { backgroundColor: CARD_CREAM },
        footer: { backgroundColor: CARD_CREAM },
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        spacing: "sm",
        contents: [
          {
            type: "text",
            text: "🦌 สวัสดีค่ะ! น้องกวางช่วยหาไฟล์ที่คุณเก็บไว้ได้",
            size: "sm",
            weight: "bold",
            color: TEXT_DARK_WARM,
            wrap: true,
          },
          {
            type: "text",
            text: 'ลองพิมพ์สิ่งที่อยากหา เช่น "ใบเสร็จเดือนที่แล้ว"',
            size: "xs",
            color: TEXT_TAUPE,
            wrap: true,
          },
          { type: "separator", margin: "md", color: BORDER_BEIGE },
          {
            type: "text",
            text: "Hi! I'm Nong Kwang — ask me to find any file you've saved, e.g. \"last month's receipt.\"",
            size: "xs",
            color: TEXT_TAUPE,
            margin: "sm",
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
