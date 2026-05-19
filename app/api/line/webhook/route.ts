/**
 * LINE Messaging API webhook.
 *
 * LINE POSTs events here (follow, join, leave, message, ...). We:
 *   1. Verify the HMAC-SHA256 signature against LINE_CHANNEL_SECRET.
 *   2. follow              → welcome carousel (DM bot was added as friend)
 *   3. join                → welcome carousel + create a shared workspace
 *                            bound to the LINE group
 *   4. leave               → mark workspace as orphaned (no file deletion)
 *   5. message in DM       → personal storage flow (existing behavior)
 *   6. message in group    → workspace storage flow (NEW)
 *      - sender must have friended bot (source.userId present)
 *      - file lands in workspaces/{W}/inbox/
 *      - "/folder <name>" from owner creates a workspace folder
 *   7. Return 200 OK so LINE doesn't retry — internal failures are logged
 *      and swallowed, otherwise LINE would re-send identical events.
 *
 * Webhook URL to register in LINE Developers Console:
 *   https://<your-domain>/api/line/webhook
 */

import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  fetchGroupSummary,
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
  workspaceInboxPrefix,
  workspaceFolderMetaKey,
} from "@/lib/s3";
import { analyzeFile } from "@/lib/analyzer";
import { AI_FOLDERS, mapToAiFolder } from "@/lib/ai-folders";
import {
  upsertEntry,
  upsertWorkspaceEntry,
} from "@/lib/search-index";
import { invalidatePreviews } from "@/lib/previews-cache";
import {
  addMember,
  createGroupWorkspace,
  findWorkspaceByLineGroup,
  markOrphaned,
  type WorkspaceMeta,
} from "@/lib/workspace";

// ── Allow-lists / limits ──────────────────────────────────────────────────

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

// ── LINE event shapes ─────────────────────────────────────────────────────

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
  /** LINE-assigned unique id per event delivery. Same on retries. */
  webhookEventId?: string;
  deliveryContext?: { isRedelivery?: boolean };
}

interface LineWebhookBody {
  destination?: string;
  events?: LineEvent[];
}

// ── Idempotency: webhookEventId dedupe ────────────────────────────────────
//
// LINE retries webhook deliveries on timeouts/5xx, sending identical event
// payloads with the same webhookEventId. If we re-process a retry, each run
// stamps a fresh Date.now() timestamp into the S3 key → duplicate files.
//
// We keep an in-process Set of recently-seen webhookEventIds. Fluid Compute
// reuses warm instances so this catches the typical "retry within a minute"
// pattern. The Set is bounded so it can't grow forever; a 10-minute TTL
// covers LINE's documented retry window.
const SEEN_TTL_MS = 10 * 60 * 1000;
const SEEN_MAX = 5000;
const seenEvents = new Map<string, number>();

function shouldSkipEvent(event: LineEvent): boolean {
  // LINE flags retries explicitly — cheapest path, no state needed.
  if (event.deliveryContext?.isRedelivery) return true;

  const id = event.webhookEventId;
  if (!id) return false;

  const now = Date.now();
  // Sweep expired entries opportunistically (cheap, amortized).
  if (seenEvents.size > SEEN_MAX) {
    for (const [k, t] of seenEvents) {
      if (now - t > SEEN_TTL_MS) seenEvents.delete(k);
    }
  }

  const seen = seenEvents.get(id);
  if (seen !== undefined && now - seen < SEEN_TTL_MS) return true;

  seenEvents.set(id, now);
  return false;
}

// ── Helpers ───────────────────────────────────────────────────────────────

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

function deriveFilename(msg: LineMessageContent, contentType: string): string {
  if (msg.type === "file" && msg.fileName) {
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

function getSourceContext(event: LineEvent): {
  userId: string | null;
  groupId: string | null;
  isGroup: boolean;
} {
  const src = event.source;
  return {
    userId:  src?.userId ?? null,
    groupId: src?.type === "group" ? (src.groupId ?? null) : null,
    isGroup: src?.type === "group" || src?.type === "room",
  };
}

// ── Personal-storage upload (DM flow, unchanged) ──────────────────────────

async function handlePersonalFileMessage(
  userId: string,
  msg: LineMessageContent,
): Promise<LineMessage[]> {
  const content = await fetchLineContent(msg.id);

  if (content.buffer.length > MAX_UPLOAD_BYTES) {
    return [{ type: "text", text: "⚠️ ไฟล์ใหญ่เกิน 25MB / File exceeds 25MB" }];
  }

  const filename = deriveFilename(msg, content.contentType);
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return [{ type: "text", text: `❌ ไม่รองรับ .${ext} / Unsupported .${ext}` }];
  }

  const initialKey = `${userUploadsPrefix(userId)}${Date.now()}-${filename}`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: initialKey, Body: content.buffer, ContentType: content.contentType,
  }));

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
          console.warn("[line/webhook] rename failed:", renameErr);
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
        console.warn("[line/webhook] tagging failed:", tagErr);
      }

      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: finalKey }));
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
        console.warn("[line/webhook] index update failed:", idxErr);
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

// ── Workspace upload (group flow) ─────────────────────────────────────────

async function handleWorkspaceFileMessage(
  workspace: WorkspaceMeta,
  uploaderId: string,
  msg: LineMessageContent,
): Promise<LineMessage[]> {
  const content = await fetchLineContent(msg.id);

  if (content.buffer.length > MAX_UPLOAD_BYTES) {
    return [{ type: "text", text: "⚠️ ไฟล์ใหญ่เกิน 25MB / File exceeds 25MB" }];
  }

  const filename = deriveFilename(msg, content.contentType);
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return [{ type: "text", text: `❌ ไม่รองรับ .${ext} / Unsupported .${ext}` }];
  }

  const initialKey = `${workspaceInboxPrefix(workspace.id)}${Date.now()}-${filename}`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: initialKey, Body: content.buffer, ContentType: content.contentType,
  }));

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
          console.warn("[line/webhook] rename failed:", renameErr);
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
          df_uploader:     uploaderId,
          df_workspace:    workspace.id,
        });
      } catch (tagErr) {
        console.warn("[line/webhook] tagging failed:", tagErr);
      }

      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: finalKey }));
        await upsertWorkspaceEntry(workspace.id, {
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
          uploaderId,
        });
      } catch (idxErr) {
        console.warn("[line/webhook] workspace index update failed:", idxErr);
      }

      analyzed = analysis.via !== "fallback";
    } catch (analyzerErr) {
      console.warn("[line/webhook] analyzer skipped:", analyzerErr);
    }
  }

  return [
    uploadSuccessBubble({
      filename:      finalFilename,
      folderName:    aiFolderName(aiFolderId),
      liffUrl:       liffUrl(),
      detail,
      analyzed,
      workspaceName: workspace.name,
    }),
  ];
}

// ── /folder command (group, owner only) ───────────────────────────────────

async function handleFolderCommand(
  workspace: WorkspaceMeta,
  uploaderId: string,
  text: string,
): Promise<LineMessage[] | null> {
  // accept: /folder Name, /new folder Name, /สร้างโฟลเดอร์ Name
  const match = text.match(/^\/(?:folder|new folder|สร้างโฟลเดอร์)\s+(.+)$/i);
  if (!match) return null;

  const isOwner = workspace.members.some(
    (m) => m.userId === uploaderId && m.role === "owner",
  );
  if (!isOwner) {
    return [{
      type: "text",
      text:
        "🔒 เฉพาะเจ้าของพื้นที่เท่านั้นที่สร้างโฟลเดอร์ได้\n" +
        "Only the workspace owner can create folders.",
    }];
  }

  const name = match[1].trim().slice(0, 80);
  if (!name) return null;

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         workspaceFolderMetaKey(workspace.id, id),
    Body:        JSON.stringify({ id, name, owner: "user", createdAt, createdBy: uploaderId }),
    ContentType: "application/json",
  }));

  return [{
    type: "text",
    text:
      `✅ สร้างโฟลเดอร์ "${name}" ใน ${workspace.name}\n` +
      `Created folder "${name}" in ${workspace.name}.`,
  }];
}

// ── Event dispatch ────────────────────────────────────────────────────────

async function handleMessageEvent(event: LineEvent): Promise<LineMessage[] | null> {
  const msg = event.message;
  if (!msg) return null;

  const { userId, groupId, isGroup } = getSourceContext(event);

  // Sender must be identifiable. In DM source.userId is always present; in
  // groups it's present only when the sender has friended the bot.
  if (!userId) {
    if (isGroup && (msg.type === "image" || msg.type === "video" || msg.type === "file")) {
      return [{
        type: "text",
        text:
          "👋 เพิ่ม DearFile เป็นเพื่อนก่อน เพื่อบันทึกไฟล์จากกลุ่ม\n" +
          "Add DearFile as a friend first to save files from group chats.",
      }];
    }
    return null;
  }

  // ── Group flow ─────────────────────────────────────────────────────────
  if (isGroup && groupId) {
    let workspace = await findWorkspaceByLineGroup(groupId);

    // Self-heal: if join event was missed (or owner could not be resolved),
    // create the workspace lazily on first authenticated message.
    if (!workspace) {
      const summary = await fetchGroupSummary(groupId);
      workspace = await createGroupWorkspace({
        lineGroupId: groupId,
        ownerId:     userId,
        name:        summary?.groupName,
      });
    } else if (!workspace.members.some((m) => m.userId === userId)) {
      // Auto-add as member on first upload
      workspace = await addMember(workspace.id, userId, "member");
    }

    if (workspace.orphaned) {
      return [{
        type: "text",
        text:
          "ℹ️ พื้นที่นี้ถูกตัดจากกลุ่มแล้ว เปิด DearFile เพื่อดูไฟล์ที่บันทึกไว้\n" +
          "This workspace is no longer linked to a group. Open DearFile to view saved files.",
      }];
    }

    if (msg.type === "text") {
      const folderResp = await handleFolderCommand(workspace, userId, msg.text ?? "");
      if (folderResp) return folderResp;
      // Stay silent on other text in groups — don't be a chatbot in busy rooms.
      return null;
    }

    if (msg.type === "image" || msg.type === "video" || msg.type === "audio" || msg.type === "file") {
      try {
        return await handleWorkspaceFileMessage(workspace, userId, msg);
      } catch (err) {
        console.error("[line/webhook] workspace file upload failed:", err);
        return [{ type: "text", text: "⚠️ อัปโหลดไม่สำเร็จ / Upload failed" }];
      }
    }

    return null;
  }

  // ── DM flow ────────────────────────────────────────────────────────────
  if (msg.type === "image" || msg.type === "video" || msg.type === "audio" || msg.type === "file") {
    try {
      return await handlePersonalFileMessage(userId, msg);
    } catch (err) {
      console.error("[line/webhook] personal file upload failed:", err);
      return [{ type: "text", text: "⚠️ อัปโหลดไม่สำเร็จ / Upload failed" }];
    }
  }

  if (msg.type === "text") {
    return [helpBubble(liffUrl())];
  }

  return null;
}

// ── POST handler ──────────────────────────────────────────────────────────

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

  if (events.length === 0) {
    return new Response("OK", { status: 200 });
  }

  await Promise.allSettled(
    events.map(async (event) => {
      try {
        // Drop retries / duplicates before doing any work. LINE will keep
        // re-delivering the same webhookEventId until it gets a 2xx, and
        // each run would otherwise stamp a fresh timestamp into the S3 key
        // producing duplicate files.
        if (shouldSkipEvent(event)) {
          console.log(`[line/webhook] skipping duplicate event ${event.webhookEventId ?? "(no id)"}`);
          return;
        }

        // follow → welcome carousel (DM bot was friended)
        if (event.type === "follow" && event.replyToken) {
          await replyMessage(event.replyToken, [welcomeBubble(url)]);
          return;
        }

        // join → welcome + create workspace bound to the group (only if
        // we can resolve an inviter; otherwise defer to the first
        // authenticated message in the group so we never write a phantom
        // empty-string member).
        if (event.type === "join") {
          const { groupId, userId } = getSourceContext(event);
          if (groupId && userId) {
            const summary = await fetchGroupSummary(groupId);
            await createGroupWorkspace({
              lineGroupId: groupId,
              ownerId:     userId,
              name:        summary?.groupName,
            });
          }
          if (event.replyToken) {
            await replyMessage(event.replyToken, [welcomeBubble(url)]);
          }
          return;
        }

        // leave → mark workspace orphaned (don't delete data)
        if (event.type === "leave") {
          const { groupId } = getSourceContext(event);
          if (groupId) {
            const ws = await findWorkspaceByLineGroup(groupId);
            if (ws) await markOrphaned(ws.id);
          }
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
