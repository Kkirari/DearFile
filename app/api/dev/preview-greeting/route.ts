/**
 * Dev-only preview endpoint for the LINE welcome carousel.
 *
 * Returns the `contents` object of the Flex message (carousel of bubbles),
 * ready to paste into https://developers.line.biz/flex-simulator/playground/
 * to render the design without deploying.
 *
 * Gated on NODE_ENV — 404 in production so it can't leak.
 *
 * Usage:
 *   npm run dev
 *   open http://localhost:8000/api/dev/preview-greeting
 */

import { welcomeBubble } from "@/lib/line";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const liffUrl = liffId ? `https://liff.line.me/${liffId}` : "https://line.me";

  const message = welcomeBubble(liffUrl);

  // The Flex Simulator wants the `contents` (carousel/bubble), not the wrapper.
  return Response.json(message.contents, {
    headers: { "Cache-Control": "no-store" },
  });
}
