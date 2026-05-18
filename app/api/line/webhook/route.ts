/**
 * LINE Messaging API webhook.
 *
 * LINE POSTs events here (follow, join, message, …). We:
 *   1. Verify the HMAC-SHA256 signature against LINE_CHANNEL_SECRET.
 *   2. follow / join → welcome carousel.
 *   3. message (image/video/audio/file) → download from LINE → store in
 *      the user's S3 inbox → run analyzer (best-effort) → reply with a
 *      confirmation bubble.
 *   4. message (text) → friendly help bubble.
 *   5. Return 200 OK so LINE doesn't retry — even on internal failures we
 *      log and ack, otherwise LINE would re-send identical events.
 *
 * Source restriction: only DMs (source.type === "user") are accepted for
 * uploads. Groups/rooms get a hint to DM the bot — we don't yet have a
 * mapping from group → owner user, so storage location would be ambiguous.
 *
 * Webhook URL to register in LINE Developers Console:
 *   https://<your-domain>/api/line/webhook
 */

import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  fetchLineContent,
  helpBubble,
  replyMessage,
  uploadSuccessBubble,
  verifyLineSignature,
  welcomeBubble,
  type LineMessage,
} from "@/lib/line";
import {
  BUCKET,
  mimeFromFilename,
  renameS3Object,
  s3,
  setS3ObjectTags,
  userUploadsPrefix,
} from "@/lib/s3";
import { analyzeFile } from "@/lib/analyzer";
import { AI_FOLDERS, mapToAiFolder } from "@/lib/ai-folders";
import { upsertEntry } from "@/lib/search-index";
import { invalidatePreviews } from "@/lib/previews-cache";

// LINE → file routing
const ALLOWED_EXTENSIONS = new Set([
  "pdf",  "txt",
  "jpg",  "jpeg", "png", "gif", "webp", "heic",
  "mp4",  "mov",  "mp3", "m4a",
  "xlsx", "xls",  "docx", "doc",
  "zip",  "rar",
]);

// Analyzer only handles these — others get uploaded raw without rename.
const ANALYZER_EXTENSIONS = new Set(["jpg", "jpeg", "png", "pdf", "docx"]);

// 25 MB cap. LINE allows larger uploads but Vercel function memory makes
// big buffers risky. Bigger files should use the LIFF web uploader.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

interface LineEventSource {
  type: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
}

interface LineMessageContent {
  id: string;
  type: "text" | "image" | "video" | "audio" | "file" | string;
  text?: string;
  fileName?: string;
  fileSize?: number;
}

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: LineEventSource;
  timestamp?: number;
  message?: LineMessageContent;
}

interface LineWebhookBody {
  destination?: string;
  events?: LineEvent[];
}

function liffUrl(): string {
  const id = process.env.NEXT_PUBLIC_LIFF_ID;
  return id ? `https://liff.line.me/${id}` : "https://line.me";
}

function extFromContentType(contentType: string): string | null {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg":      "jpg",
    "image/png":       "png",
    "image/gif":       "gif",
    "image/webp":      "webp",
    "image/heic":      "heic",
    "video/mp4":       "mp4",
    "video/quicktime": "mov",
    "audio/mpeg":      "mp3",
    "audio/mp4":       "m4a",
    "audio/x-m4a":     "m4a",
    "audio/aac":       "m4a",
    "application/pdf": "pdf",
  };
  return map[ct] ?? null;
}

/**
 * Pick a clean filename for the incoming LINE message. For `file` we trust
 * the LINE-provided filename (sanitized). For media we synthesize one from
 * the content type plus timestamp.
 */
function deriveFilename(msg: LineMessageContent, contentType: string): string {
  if (msg.type === "file" && msg.fileName) {
    // Strip path separators and parent-dir traversal; LINE shouldn't send
    // them but defense in depth — these are used in S3 keys.
    const clean = msg.fileName.replace(/[\\/]/g, "_").replace(/\.\.+/g, ".");
    return clean.slice(0, 200);
  }

  const ext = extFromContentType(contentType) ?? ({
    image: "jpg",
    video: "mp4",
    audio: "m4a",
  } as const)[msg.type as "image" | "video" | "audio"] ?? "bin";

  return `${msg.type}_${Date.now()}.${ext}`;
}

function aiFolderName(folderId: string): string {
  return AI_FOLDERS.find((f) => f.id === folderId)?.name ?? "📥 Inbox";
}

/**
 * The core chat-upload flow. Returns the reply messages to send.
 *
 * Best-effort design: we always upload the raw file to S3 first, then try
 * to analyze. Analyzer failures (unsupported type, Claude quota, etc.) are
 * non-fatal — the file is still saved and indexed.
 */
async function handleFileMessage(
  userId: string,
  msg: LineMessageContent,
): Promise<LineMessage[]> {
  // 1. Download from LINE Content API
  const content = await fetchLineContent(msg.id);

  if (content.buffer.length > MAX_UPLOAD_BYTES) {
    return [
      {
        type: "text",
        text:
          `⚠️ ไฟล์ใหญ่เกิน 25MB กรุณาอัปโหลดผ่านแอป\n` +
          `File exceeds 25MB — please use the DearFile app.`,
      },
    ];
  }

  // 2. Pick a filename + validate extension
  const filename = deriveFilename(msg, content.contentType);
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return [
      {
        type: "text",
        text:
          `❌ ไม่รองรับไฟล์ .${ext}\n` +
          `Unsupported file type: .${ext}`,
      },
    ];
  }

  // 3. Upload to the user's inbox in S3
  const initialKey = `${userUploadsPrefix(userId)}${Date.now()}-${filename}`;
  await s3.send(
    new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         initialKey,
      Body:        content.buffer,
      ContentType: content.contentType,
    }),
  );

  // 4. Try to analyze + rename + tag + index (best-effort)
  let finalKey = initialKey;
  let finalFilename = filename;
  let analyzed = false;
  let detail: string | undefined;
  let aiFolderId = "ai-docs-general";

  if (ANALYZER_EXTENSIONS.has(ext)) {
    try {
      const analysis = await analyzeFile(initialKey);
      aiFolderId = mapToAiFolder(analysis.category, analysis.type);
      detail = analysis.detail || undefined;

      if (analysis.via !== "fallback") {
        try {
          finalKey = await renameS3Object(initialKey, analysis.suggested_filename);
          finalFilename = analysis.suggested_filename;
        } catch (renameErr) {
          console.warn("[line/webhook] rename failed, keeping original key:", renameErr);
        }
      }

      try {
        await setS3ObjectTags(finalKey, {
          df_category:     analysis.category,
          df_type:         analysis.type,
          df_date:         analysis.date ?? "",
          df_ai_folder_id: aiFolderId,
          df_via:          analysis.via,
          df_analyzed:     "1",
        });
      } catch (tagErr) {
        console.warn("[line/webhook] tagging failed (non-fatal):", tagErr);
      }

      try {
        const head = await s3.send(
          new HeadObjectCommand({ Bucket: BUCKET, Key: finalKey }),
        );
        await upsertEntry(userId, {
          key:            finalKey,
          filename:       finalFilename,
          category:       analysis.category,
          type:           analysis.type,
          subject:        analysis.subject,
          detail:         analysis.detail,
          date:           analysis.date,
          keywords:       analysis.keywords,
          ai_folder_id:   aiFolderId,
          user_folder_id: null,
          size:           head.ContentLength ?? content.buffer.length,
          mimeType:       head.ContentType ?? mimeFromFilename(finalFilename),
          createdAt:      head.LastModified?.toISOString() ?? new Date().toISOString(),
        });
      } catch (idxErr) {
        console.warn("[line/webhook] index update failed (non-fatal):", idxErr);
      }

      analyzed = analysis.via !== "fallback";
    } catch (analyzerErr) {
      console.warn("[line/webhook] analyzer skipped:", analyzerErr);
    }
  }

  invalidatePreviews(userId);

  return [
    uploadSuccessBubble({
      filename:   finalFilename,
      folderName: aiFolderName(aiFolderId),
      liffUrl:    liffUrl(),
      detail,
      analyzed,
    }),
  ];
}

/**
 * Handle one message event. Returns the messages to reply with, or null
 * if the event should be silently dropped (e.g. an unsupported type from
 * a group chat where we don't want to be noisy).
 */
async function handleMessageEvent(event: LineEvent): Promise<LineMessage[] | null> {
  const msg = event.message;
  if (!msg) return null;

  // Only DMs for now — groups/rooms don't have a canonical owner-user we
  // can attribute uploads to.
  if (event.source?.type !== "user" || !event.source.userId) {
    if (msg.type === "image" || msg.type === "video" || msg.type === "file") {
      return [
        {
          type: "text",
          text:
            "📁 ส่ง DM มาที่ฉันโดยตรงเพื่ออัปโหลด\n" +
            "DM me directly to upload files into your DearFile.",
        },
      ];
    }
    return null;
  }

  const userId = event.source.userId;

  if (
    msg.type === "image" ||
    msg.type === "video" ||
    msg.type === "audio" ||
    msg.type === "file"
  ) {
    try {
      return await handleFileMessage(userId, msg);
    } catch (err) {
      console.error("[line/webhook] file upload failed:", err);
      return [
        {
          type: "text",
          text:
            "⚠️ อัปโหลดไม่สำเร็จ ลองอีกครั้งนะ\n" +
            "Upload failed — please try again.",
        },
      ];
    }
  }

  if (msg.type === "text") {
    return [helpBubble(liffUrl())];
  }

  return null;
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
          return;
        }

        if (event.type === "message") {
          const messages = await handleMessageEvent(event);
          if (messages && event.replyToken) {
            await replyMessage(event.replyToken, messages);
          }
        }
      } catch (err) {
        console.error(`[line/webhook] event ${event.type} failed:`, err);
      }
    }),
  );

  return new Response("OK", { status: 200 });
}
