import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { analyzeFile } from "@/lib/analyzer";
import { mapToAiFolder } from "@/lib/ai-folders";
import {
  renameS3Object,
  setS3ObjectTags,
  mimeFromFilename,
  isUserOwnedKey,
  s3,
  BUCKET,
} from "@/lib/s3";
import { upsertEntry } from "@/lib/search-index";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";

/**
 * Extract user folder id from a per-user key.
 *   `users/{userId}/folders/{folderId}/file.pdf` → folderId
 *   `users/{userId}/uploads/file.pdf`            → null
 */
function extractUserFolderId(key: string, userId: string): string | null {
  const m = key.match(new RegExp(`^users/${userId}/folders/([^/]+)/`));
  return m?.[1] ?? null;
}

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const { key } = (await req.json()) as { key?: unknown };
    if (!isUserOwnedKey(key, userId)) {
      return Response.json(
        { error: "Invalid key — must belong to the authenticated user" },
        { status: 400 }
      );
    }

    // 1. Analyze
    const analysis = await analyzeFile(key);

    // 2. Resolve AI folder + final S3 key (rename only when we have real signal)
    const aiFolderId = mapToAiFolder(analysis.category, analysis.type);
    let newKey = key;

    if (analysis.via !== "fallback") {
      try {
        newKey = await renameS3Object(key, analysis.suggested_filename);
      } catch (renameErr) {
        console.warn("[analyze] rename failed, keeping original key:", renameErr);
      }
    }

    // 3. Tag the (possibly renamed) S3 object — ASCII-safe metadata only
    try {
      await setS3ObjectTags(newKey, {
        df_category:     analysis.category,
        df_type:         analysis.type,
        df_date:         analysis.date ?? "",
        df_ai_folder_id: aiFolderId,
        df_via:          analysis.via,
        df_analyzed:     "1",
      });
    } catch (tagErr) {
      console.warn("[analyze] tagging failed (non-fatal):", tagErr);
    }

    // 4. Update search index (full Thai/English keywords live here)
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: newKey }));
      const filename = newKey.split("/").pop() ?? newKey;
      await upsertEntry(userId, {
        key:            newKey,
        filename,
        category:       analysis.category,
        type:           analysis.type,
        subject:        analysis.subject,
        detail:         analysis.detail,
        date:           analysis.date,
        keywords:       analysis.keywords,
        ai_folder_id:   aiFolderId,
        user_folder_id: extractUserFolderId(newKey, userId),
        size:           head.ContentLength ?? 0,
        mimeType:       head.ContentType ?? mimeFromFilename(filename),
        createdAt:      head.LastModified?.toISOString() ?? new Date().toISOString(),
      });
    } catch (idxErr) {
      console.warn("[analyze] index update failed (non-fatal):", idxErr);
    }

    return Response.json({
      ...analysis,
      originalKey:   key,
      newKey,
      ai_folder_id:  aiFolderId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/analyze]", message);
    if (message.startsWith("Unsupported file type")) {
      return Response.json({ error: message }, { status: 422 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
