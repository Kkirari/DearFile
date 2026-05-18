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
 * Welcome carousel — 4-panel onboarding slider users swipe through.
 *
 * Design choices (UX rationale):
 *   - 4 panels: enough to tell the story, few enough to finish swiping (≥5
 *     and completion drops sharply on mobile carousels).
 *   - First panel = hero (sets context), last panel = CTA (action target).
 *   - Each middle panel teaches ONE feature so the eye scans top-to-bottom
 *     instead of left-to-right inside a cramped bubble.
 *   - Step indicator at the bottom of each panel = "I'm on slide N of 4"
 *     since LINE's native carousel has no built-in dot indicator.
 *   - Color-coded hero band per panel (brand → blue → purple → brand)
 *     gives a perceived sense of progress and closes the loop on CTA.
 *
 * Naming: a "Flex message" is the wrapper; its `contents` can be a single
 *   bubble or a carousel of bubbles. We return one message either way.
 */

type FlexComponent = Record<string, unknown>;

const BRAND_GREEN = "#06C755";
const ACCENT_BLUE = "#3B82F6";
const ACCENT_PURPLE = "#8B5CF6";
const TEXT_PRIMARY = "#111111";
const TEXT_SECONDARY = "#6B7280";
const DOT_ACTIVE = "#111111";
const DOT_INACTIVE = "#E5E7EB";

function stepDots(activeIndex: number, total = 4): FlexComponent {
  const dots: FlexComponent[] = [];
  for (let i = 0; i < total; i++) {
    dots.push({
      type: "box",
      layout: "vertical",
      width: "6px",
      height: "6px",
      cornerRadius: "3px",
      backgroundColor: i === activeIndex ? DOT_ACTIVE : DOT_INACTIVE,
      contents: [{ type: "filler" }],
    });
  }
  return {
    type: "box",
    layout: "horizontal",
    spacing: "xs",
    justifyContent: "center",
    alignItems: "center",
    margin: "lg",
    contents: dots,
  };
}

function hero(
  badge: string,
  heading: string,
  background: string,
): FlexComponent {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: background,
    paddingAll: "20px",
    spacing: "sm",
    contents: [
      {
        type: "text",
        text: badge,
        size: "xs",
        weight: "bold",
        color: "#FFFFFF",
        letterSpacing: "2px",
      },
      {
        type: "text",
        text: heading,
        size: "xl",
        weight: "bold",
        color: "#FFFFFF",
        wrap: true,
      },
    ],
  };
}

function bodyText(thai: string, english: string): FlexComponent[] {
  return [
    {
      type: "text",
      text: thai,
      size: "md",
      weight: "bold",
      color: TEXT_PRIMARY,
      wrap: true,
    },
    {
      type: "text",
      text: english,
      size: "sm",
      color: TEXT_SECONDARY,
      wrap: true,
      margin: "xs",
    },
  ];
}

function panel(
  badge: string,
  heading: string,
  background: string,
  thai: string,
  english: string,
  activeIndex: number,
  footer?: FlexComponent,
): FlexComponent {
  return {
    type: "bubble",
    size: "kilo",
    hero: hero(badge, heading, background),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "16px",
      contents: [
        ...bodyText(thai, english),
        stepDots(activeIndex),
      ],
    },
    ...(footer ? { footer } : {}),
  };
}

export function welcomeBubble(liffUrl: string): LineFlexMessage {
  const ctaFooter: FlexComponent = {
    type: "box",
    layout: "vertical",
    paddingAll: "12px",
    contents: [
      {
        type: "button",
        style: "primary",
        color: BRAND_GREEN,
        height: "sm",
        action: {
          type: "uri",
          label: "Open DearFile",
          uri: liffUrl,
        },
      },
    ],
  };

  return {
    type: "flex",
    altText: "ยินดีต้อนรับสู่ DearFile / Welcome to DearFile",
    contents: {
      type: "carousel",
      contents: [
        panel(
          "WELCOME",
          "DearFile",
          BRAND_GREEN,
          "คลังไฟล์ AI ในแอป LINE",
          "Your AI-powered cloud storage, right inside LINE. Swipe to see how it works.",
          0,
        ),
        panel(
          "STEP 01",
          "Send",
          ACCENT_BLUE,
          "ส่งไฟล์ในแชตได้เลย",
          "Drop photos, PDFs, or docs into this chat — DearFile catches them all.",
          1,
        ),
        panel(
          "STEP 02",
          "Organize",
          ACCENT_PURPLE,
          "AI ตั้งชื่อและจัดให้อัตโนมัติ",
          "Files are auto-named and sorted into smart folders. No manual work.",
          2,
        ),
        panel(
          "STEP 03",
          "Find",
          BRAND_GREEN,
          "ค้นหาทุกอย่างได้ทันที",
          "Search by keyword, anytime. Tap below to open your library.",
          3,
          ctaFooter,
        ),
      ],
    },
  };
}
