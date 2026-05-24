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
import { after } from "next/server";
import {
  answerBubble,
  captureResultBubble,
  fetchGroupSummary,
  fetchLineContent,
  greetingBubble,
  helpBubble,
  pushMessage,
  replyMessage,
  summaryBubble,
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
  getAllEntries,
  upsertEntry,
  upsertWorkspaceEntry,
} from "@/lib/search-index";
import { askDearFile, type AskScope } from "@/lib/ask";
import { buildDailySummary } from "@/lib/summary";
import { ingestLink, ingestNote, processCapture } from "@/lib/capture";
import { checkAndIncrementAsk } from "@/lib/rate-limit";
import { routeIntent } from "@/lib/intent";
import { invalidatePreviews } from "@/lib/previews-cache";
import {
  addMember,
  createGroupWorkspace,
  findWorkspaceByLineGroup,
  markOrphaned,
  type WorkspaceMeta,
} from "@/lib/workspace";

// Background capture processing runs in `after()` past the 200 response — give
// the function room beyond the default for transcript fetch + summarize + embed.
export const maxDuration = 60;

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
// Three layers, cheapest first:
//   1. `deliveryContext.isRedelivery` flag (free, LINE tells us explicitly)
//   2. In-process Map of recently-seen ids (fast, same-instance only)
//   3. S3 marker file with If-None-Match (cross-instance, ~50ms per check)
//
// Layer 3 is the only one that survives a cold start landing on a fresh
// Vercel instance. Marker files at `webhook-seen/{eventId}.json` are
// ~80 bytes each — storage cost is negligible. Add a 1-day lifecycle rule
// on that prefix if you want tidiness; not required for correctness.
const SEEN_TTL_MS = 10 * 60 * 1000;
const SEEN_MAX = 5000;
const seenEvents = new Map<string, number>();

function isPreconditionFailed(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "PreconditionFailed" || e.$metadata?.httpStatusCode === 412;
}

/**
 * Atomically claim a webhookEventId by creating an S3 marker file. Returns
 * false if a marker already exists (i.e. this event was already claimed by
 * another instance). On unexpected S3 errors we fail OPEN — better to risk
 * a duplicate than to drop the event entirely.
 */
async function claimWebhookEvent(eventId: string): Promise<boolean> {
  try {
    await s3.send(new PutObjectCommand({
      Bucket:       BUCKET,
      Key:          `webhook-seen/${eventId}.json`,
      Body:         JSON.stringify({ at: new Date().toISOString() }),
      ContentType:  "application/json",
      IfNoneMatch:  "*",
    }));
    return true;
  } catch (err) {
    if (isPreconditionFailed(err)) return false;
    console.warn("[line/webhook] dedupe marker write failed, failing open:", err);
    return true;
  }
}

async function shouldSkipEvent(event: LineEvent): Promise<boolean> {
  // Layer 1 — LINE flags retries explicitly.
  if (event.deliveryContext?.isRedelivery) return true;

  const id = event.webhookEventId;
  if (!id) return false;

  // Layer 2 — in-memory check (fast).
  const now = Date.now();
  if (seenEvents.size > SEEN_MAX) {
    for (const [k, t] of seenEvents) {
      if (now - t > SEEN_TTL_MS) seenEvents.delete(k);
    }
  }
  const seen = seenEvents.get(id);
  if (seen !== undefined && now - seen < SEEN_TTL_MS) return true;

  // Layer 3 — S3 marker (cross-instance).
  const claimed = await claimWebhookEvent(id);
  if (!claimed) {
    // Cache the negative result so this instance doesn't pay the S3 cost
    // again for the same event during its warm lifetime.
    seenEvents.set(id, now);
    return true;
  }

  seenEvents.set(id, now);
  return false;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build a LIFF URL. With no args it opens the app home; pass `file` (an S3
 * key) and optionally `ws` (workspace id) to deep-link straight to that file —
 * LIFF forwards the query to the endpoint, where home-screen.tsx reads it.
 */
function liffUrl(params?: { file?: string; ws?: string; tab?: string }): string {
  const id = process.env.NEXT_PUBLIC_LIFF_ID;
  const base = id ? `https://liff.line.me/${id}` : "https://line.me";
  if (!params?.file && !params?.ws && !params?.tab) return base;
  const qs = new URLSearchParams();
  if (params.file) qs.set("file", params.file);
  if (params.ws)   qs.set("ws", params.ws);
  if (params.tab)  qs.set("tab", params.tab);
  return `${base}?${qs.toString()}`;
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
  let aiFolderId = "ai-docs-general";

  if (ANALYZER_EXTENSIONS.has(ext)) {
    try {
      const analysis = await analyzeFile(initialKey);
      aiFolderId = mapToAiFolder(analysis.category, analysis.type);

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
    } catch (analyzerErr) {
      console.warn("[line/webhook] analyzer skipped:", analyzerErr);
    }
  }

  invalidatePreviews(userId);

  return [
    uploadSuccessBubble({
      filename:   finalFilename,
      folderName: aiFolderName(aiFolderId),
      liffUrl:    liffUrl({ file: finalKey }),
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
  let aiFolderId = "ai-docs-general";

  if (ANALYZER_EXTENSIONS.has(ext)) {
    try {
      const analysis = await analyzeFile(initialKey);
      aiFolderId = mapToAiFolder(analysis.category, analysis.type);

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
    } catch (analyzerErr) {
      console.warn("[line/webhook] analyzer skipped:", analyzerErr);
    }
  }

  return [
    uploadSuccessBubble({
      filename:      finalFilename,
      folderName:    aiFolderName(aiFolderId),
      liffUrl:       liffUrl({ file: finalKey, ws: workspace.id }),
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

// ── Ask DearFile (chat retrieval) ─────────────────────────────────────────

// Sigils + triggers that explicitly address the bot. Matched by string, NOT a
// regex: a JS `\b` word boundary is ASCII-only and never fires after Thai
// characters, which silently broke the `/น้องกวาง` trigger entirely. Accept
// `/`, `!`, and `@` so users aren't punished for guessing the sigil.
const ASK_SIGILS = ["/", "!", "@"];
const ASK_TRIGGERS = ["dearfile", "น้องกวาง"];

/**
 * If `text` explicitly addresses the bot (a sigil + trigger, e.g. "/dearfile",
 * "!น้องกวาง", "@dearfile"), return the remaining question (may be empty).
 * Otherwise return null — meaning "not addressed to Ask".
 */
function parseAskCommand(text: string): string | null {
  const t = (text ?? "").trimStart();
  for (const sigil of ASK_SIGILS) {
    if (!t.startsWith(sigil)) continue;
    const rest = t.slice(sigil.length).trimStart();
    const lower = rest.toLowerCase();
    for (const trig of ASK_TRIGGERS) {
      if (lower.startsWith(trig.toLowerCase())) return rest.slice(trig.length).trim();
    }
  }
  return null;
}

// ── Daily summary (on-demand) ──────────────────────────────────────────────

// Whole-message triggers for an on-demand "today's recap". Kept tight (exact
// match after stripping a leading sigil) so it never steals a real question
// like "หาสรุปการประชุม".
const SUMMARY_COMMANDS = new Set(["summary", "recap", "สรุป", "สรุปวันนี้"]);

function isSummaryCommand(text: string): boolean {
  const t = (text ?? "").trim().toLowerCase().replace(/^[/!@]/, "").trim();
  return SUMMARY_COMMANDS.has(t);
}

/**
 * Build today's brief for a DM user on demand. Replies (free reply token, no
 * push quota) so it doubles as the easiest way to test the summary in LINE.
 * Empty day → a gentle nudge; any error → a graceful text reply.
 */
async function handleSummaryCommand(userId: string): Promise<LineMessage[]> {
  try {
    const summary = await buildDailySummary(userId);
    if (!summary) {
      return [{
        type: "text",
        text:
          "📭 วันนี้ยังไม่มีไฟล์ที่บันทึกไว้ ลองส่งไฟล์มาได้เลย\n" +
          "Nothing saved yet today — send me a file to get started.",
      }];
    }
    return [summaryBubble(
      {
        date:       summary.date,
        count:      summary.count,
        text:       summary.text,
        highlights: summary.highlights,
      },
      (e) => liffUrl({ file: e.key }),
      liffUrl(),
    )];
  } catch (err) {
    console.error("[line/webhook] summary command failed:", err);
    return [{
      type: "text",
      text:
        "⚠️ สรุปไม่ได้ตอนนี้ ลองใหม่อีกครั้งนะ\n" +
        "Couldn't build your summary right now — please try again.",
    }];
  }
}

// ── Capture (notes / links → Timeline) ─────────────────────────────────────

// Explicit "save this as a note" prefixes (English + Thai). A bare URL anywhere
// in the message is also treated as a link capture.
const NOTE_PREFIXES = ["/note", "/save", "/โน้ต", "บันทึก"];

type CaptureRequest =
  | { kind: "note"; text: string }
  | { kind: "link"; url: string };

/**
 * Detect a capture in DM text: an explicit /note … (or Thai บันทึก …), or any
 * URL in the message. Returns null when it's not a capture (→ falls through to
 * the Ask flow, so questions are never mis-saved).
 */
function parseCaptureCommand(text: string): CaptureRequest | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  for (const p of NOTE_PREFIXES) {
    if (lower.startsWith(p.toLowerCase())) {
      const rest = t.slice(p.length).trim();
      return rest ? { kind: "note", text: rest } : null;
    }
  }
  const m = t.match(/https?:\/\/[^\s]+/i);
  if (m) return { kind: "link", url: m[0] };
  return null;
}

/**
 * Process an already-ingested capture in the background and deliver the summary
 * bubble — reply if still inside the token's single-use window, else push.
 */
function deliverCaptureInBackground(
  id: string,
  userId: string,
  replyToken: string | undefined,
): void {
  after(async () => {
    try {
      const item = await processCapture(id);
      if (!item) return;
      const bubble = captureResultBubble(
        {
          type:      item.type,
          title:     item.title,
          summary:   item.summary,
          sourceUrl: item.sourceUrl,
          tags:      item.tags,
        },
        liffUrl({ tab: "timeline" }),
      );
      try {
        if (replyToken) await replyMessage(replyToken, [bubble]);
        else await pushMessage(userId, [bubble]);
      } catch {
        await pushMessage(userId, [bubble]); // reply token expired → push
      }
    } catch (err) {
      console.error("[line/webhook] capture processing failed:", err);
    }
  });
}

/**
 * Run a question through the Ask engine and build the reply. Rate-limits per
 * LINE user first (a friendly cap message, no model call, when exceeded). Any
 * generation/Gateway error degrades to a graceful text reply — the webhook
 * still returns 200 either way.
 */
async function handleAskMessage(
  scope: AskScope,
  userId: string,
  question: string,
): Promise<LineMessage[]> {
  const { allowed } = await checkAndIncrementAsk(userId);
  if (!allowed) {
    return [{
      type: "text",
      text:
        "📊 วันนี้ถามครบจำนวนแล้ว ลองใหม่พรุ่งนี้นะ\n" +
        "You've reached today's question limit — try again tomorrow.",
    }];
  }

  try {
    const { answer, citations } = await askDearFile(scope, question);
    const wsId = scope.kind === "workspace" ? scope.workspaceId : undefined;
    return [answerBubble(answer, citations, (e) => liffUrl({ file: e.key, ws: wsId }))];
  } catch (err) {
    console.error("[line/webhook] ask failed:", err);
    return [{
      type: "text",
      text:
        "⚠️ ตอบไม่ได้ตอนนี้ ลองใหม่อีกครั้งนะ\n" +
        "Couldn't answer right now — please try again.",
    }];
  }
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
      const text = msg.text ?? "";
      const folderResp = await handleFolderCommand(workspace, userId, text);
      if (folderResp) return folderResp;

      // Ask is opt-in in groups: only answer when explicitly addressed with a
      // sigil + trigger (/dearfile · !dearfile · /น้องกวาง · !น้องกวาง). Other
      // chatter stays silent — don't be a chatbot in busy rooms.
      const question = parseAskCommand(text);
      if (question === null) return null;
      if (question.length === 0) {
        // Bare trigger with no question — confirm we're listening + show how.
        return [{
          type: "text",
          text:
            '🦌 พิมพ์คำถามต่อท้ายได้เลย เช่น "/น้องกวาง หาใบเสร็จเดือนที่แล้ว"\n' +
            'Add your question after the trigger, e.g. "/dearfile find last month\'s receipt".',
        }];
      }
      return handleAskMessage(
        { kind: "workspace", workspaceId: workspace.id },
        userId,
        question,
      );
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
    // In a DM, plain text is a question. A typed prefix is still stripped.
    const raw = msg.text ?? "";

    // On-demand daily recap: "/summary" · "สรุป" · "recap" · "สรุปวันนี้".
    if (isSummaryCommand(raw)) return handleSummaryCommand(userId);

    // Capture: an explicit /note … or any URL → save to the Timeline. Ingest
    // synchronously (a durable `pending` row), then process + deliver the summary
    // in the background; return null so the webhook returns 200 fast.
    const cap = parseCaptureCommand(raw);
    if (cap) {
      let id: string;
      try {
        id = cap.kind === "link"
          ? await ingestLink(userId, cap.url)
          : await ingestNote(userId, cap.text);
      } catch (err) {
        console.error("[line/webhook] capture ingest failed:", err);
        return [{
          type: "text",
          text: "⚠️ บันทึกไม่ได้ตอนนี้ ลองใหม่อีกครั้งนะ\nCouldn't save that right now — please try again.",
        }];
      }
      deliverCaptureInBackground(id, userId, event.replyToken);
      return null;
    }

    const stripped = parseAskCommand(raw);
    const hadPrefix = stripped !== null;
    const question = (hadPrefix ? stripped : raw).trim();

    // Blank question, or nothing saved yet → onboarding help bubble instead of
    // an "I found nothing" AI call.
    if (!question) return [helpBubble(liffUrl())];
    const index = await getAllEntries(userId);
    if (index.length === 0) return [helpBubble(liffUrl())];

    // An explicit /dearfile|/น้องกวาง prefix is an explicit ASK — skip the
    // router. Otherwise let the Hybrid Intent Router decide so greetings /
    // help / noise don't pay for the Ask pipeline.
    const intent = hadPrefix ? "ask" : (await routeIntent(question)).intent;
    switch (intent) {
      case "ask":
        return handleAskMessage({ kind: "user", userId }, userId, question);
      case "help":
        return [helpBubble(liffUrl())];
      case "greeting":
        return [greetingBubble(liffUrl())];
      case "noise":
        return null; // stray emoji / punctuation — stay quiet
    }
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
        // producing duplicate files. The check is async because the
        // bottom layer hits S3 for cross-instance dedupe.
        if (await shouldSkipEvent(event)) {
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
