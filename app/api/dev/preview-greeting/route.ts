/**
 * Dev-only preview endpoint for the LINE Flex bubbles.
 *
 * Returns the `contents` object of a Flex message, ready to paste into
 *   https://developers.line.biz/flex-simulator/playground/
 * to render the design without deploying.
 *
 * Gated on NODE_ENV — 404 in production so it can't leak.
 *
 * Usage:
 *   npm run dev
 *   open http://localhost:8000/api/dev/preview-greeting          (welcome)
 *   open http://localhost:8000/api/dev/preview-greeting?b=success
 *   open http://localhost:8000/api/dev/preview-greeting?b=help
 */

import { helpBubble, uploadSuccessBubble, welcomeBubble } from "@/lib/line";

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const liffUrl = liffId ? `https://liff.line.me/${liffId}` : "https://line.me";

  const which = new URL(req.url).searchParams.get("b") ?? "welcome";

  const message =
    which === "success"
      ? uploadSuccessBubble({
          filename:   "receipt_starbucks_18-5-26.pdf",
          folderName: "🧾 Receipts",
          liffUrl,
          detail:     "Coffee receipt — Starbucks, 245 THB",
          analyzed:   true,
        })
      : which === "help"
      ? helpBubble(liffUrl)
      : welcomeBubble(liffUrl);

  return Response.json(message.contents, {
    headers: { "Cache-Control": "no-store" },
  });
}
