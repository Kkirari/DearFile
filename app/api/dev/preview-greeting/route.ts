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
 *   open http://localhost:8000/api/dev/preview-greeting            (DM welcome)
 *   open http://localhost:8000/api/dev/preview-greeting?b=group    (group welcome)
 *   open http://localhost:8000/api/dev/preview-greeting?b=examples (examples reply)
 *   open http://localhost:8000/api/dev/preview-greeting?b=kick     (kick-hint reply)
 *   open http://localhost:8000/api/dev/preview-greeting?b=success
 *   open http://localhost:8000/api/dev/preview-greeting?b=help
 *   open http://localhost:8000/api/dev/preview-greeting?b=grouphelp (group command menu)
 *   open http://localhost:8000/api/dev/preview-greeting?b=status    (group status)
 *   open http://localhost:8000/api/dev/preview-greeting?b=quiet     (quiet-mode ack)
 *   open http://localhost:8000/api/dev/preview-greeting?b=search    (search results)
 */

import {
  answerBubble,
  examplesBubble,
  groupHelpBubble,
  helpBubble,
  kickHintBubble,
  uploadSuccessBubble,
  welcomeBubble,
} from "@/lib/line";

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
          filename:      "receipt_starbucks_18-5-26.pdf",
          folderName:    "🧾 Receipts",
          liffUrl,
          workspaceName: "Team Finance",
        })
      : which === "help"
      ? helpBubble(liffUrl)
      : which === "group"
      ? welcomeBubble(liffUrl, { forGroup: true })
      : which === "examples"
      ? examplesBubble(liffUrl)
      : which === "kick"
      ? kickHintBubble(liffUrl)
      : which === "grouphelp"
      ? groupHelpBubble(liffUrl)
      : which === "status"
      ? answerBubble(
          [
            "📊 Team Finance",
            "",
            "📄 ไฟล์ทั้งหมด: 128",
            "👥 สมาชิก: 6",
            "🔕 ตอบกลับตอนเซฟไฟล์: ปิด",
            "",
            'เปิดกลับ: "!น้องกวาง เปิดการตอบกลับ"',
          ].join("\n"),
          [{ icon: "📂", label: "เปิด DearFile / Open", uri: liffUrl }],
        )
      : which === "quiet"
      ? answerBubble(
          `🦌 รับทราบแล้วพริ๊ๆ

จะไม่ตอบกลับเวลาเซฟไฟล์แล้วนะ แต่การเซฟอัตโนมัติยังทำงานอยู่ตามปกติ เข้าดูไฟล์ได้ที่ปุ่มนี้เลย

อยากให้ตอบกลับอีกครั้ง พิมพ์ "!น้องกวาง เปิดการตอบกลับ"`,
          [{ icon: "📂", label: "เปิด DearFile / Open", uri: liffUrl }],
        )
      : which === "search"
      ? answerBubble("🔍 เจอ 12 ไฟล์ · แสดง 3 อันดับแรก", [
          { icon: "📄", label: "ใบเสร็จค่าน้ำ-มกราคม.pdf", uri: liffUrl },
          { icon: "📄", label: "finance_starbucks-receipt_18-5-26.jpg", uri: liffUrl },
          { icon: "📄", label: "ใบแจ้งหนี้-ค่าไฟฟ้า-กุมภาพันธ์.pdf", uri: liffUrl },
        ])
      : welcomeBubble(liffUrl);

  return Response.json(message.contents, {
    headers: { "Cache-Control": "no-store" },
  });
}
