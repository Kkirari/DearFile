/**
 * LINE Messaging API webhook.
 *
 * LINE POSTs events here (follow, join, message, …). We:
 *   1. Verify the HMAC-SHA256 signature against LINE_CHANNEL_SECRET.
 *   2. Reply with a welcome Flex bubble on `follow` (user added OA as friend)
 *      and `join` (OA added to a group/room).
 *   3. Return 200 OK so LINE doesn't retry — even on internal failures we
 *      log and ack, otherwise LINE would re-send identical events.
 *
 * Webhook URL to register in LINE Developers Console:
 *   https://<your-domain>/api/line/webhook
 */

import { verifyLineSignature, replyMessage, welcomeBubble } from "@/lib/line";

interface LineEventSource {
  type: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
}

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: LineEventSource;
  timestamp?: number;
}

interface LineWebhookBody {
  destination?: string;
  events?: LineEvent[];
}

function liffUrl(): string {
  const id = process.env.NEXT_PUBLIC_LIFF_ID;
  return id ? `https://liff.line.me/${id}` : "https://line.me";
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");

  if (!verifyLineSignature(rawBody, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: LineWebhookBody;
  try {
    payload = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const events = payload.events ?? [];
  const url = liffUrl();

  // LINE webhook verification (from Dev Console "Verify" button) sends an
  // empty events array — return 200 quickly.
  if (events.length === 0) {
    return new Response("OK", { status: 200 });
  }

  await Promise.allSettled(
    events.map(async (event) => {
      try {
        if ((event.type === "follow" || event.type === "join") && event.replyToken) {
          await replyMessage(event.replyToken, [welcomeBubble(url)]);
        }
      } catch (err) {
        console.error(`[line/webhook] event ${event.type} failed:`, err);
      }
    }),
  );

  return new Response("OK", { status: 200 });
}
