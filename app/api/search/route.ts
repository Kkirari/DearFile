import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET, isSafeWorkspaceId } from "@/lib/s3";
import {
  searchScored,
  searchWorkspaceScored,
  getAllEntries,
  countByFilter,
  countWorkspaceByFilter,
  type FilterMode,
  type SortMode,
  type ScoredEntry,
} from "@/lib/search-index";
import { searchFiles } from "@/lib/file-search";
import type { FileItem } from "@/types/file";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { ensureWorkspaceMember } from "@/lib/workspace-access";

export interface SearchResultItem extends FileItem {
  score: number;
  matchedIn: string[];
  category: string;
}

function asFilter(s: string | null): FilterMode {
  if (s === "photos" || s === "documents" || s === "finance" || s === "academic") return s;
  return "all";
}

// Filter chip → analyzer category (for filtering semantic-only hits).
const FILTER_CATEGORY: Record<string, string> = {
  photos: "photo", documents: "document", finance: "finance", academic: "academic",
};

function asSort(s: string | null): SortMode {
  if (s === "newest" || s === "oldest" || s === "largest") return s;
  return "relevance";
}

export async function GET(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const { searchParams } = new URL(req.url);
    const q      = (searchParams.get("q") ?? "").trim();
    const filter = asFilter(searchParams.get("filter"));
    const sort   = asSort(searchParams.get("sort"));
    const workspaceId = searchParams.get("workspaceId");

    // Resolve scope: workspace (membership-gated) or personal.
    let wsId: string | null = null;
    if (workspaceId !== null && workspaceId !== "") {
      if (!isSafeWorkspaceId(workspaceId)) {
        return Response.json({ error: "Invalid workspaceId" }, { status: 400 });
      }
      await ensureWorkspaceMember(workspaceId, userId);
      await requireWorkspaceAccess(userId, workspaceId);
      wsId = workspaceId;
    }

    const getCounts = () =>
      wsId ? countWorkspaceByFilter(wsId) : countByFilter(userId);

    // Empty query + no active filter → return empty (UI shows recent/suggestions instead)
    if (!q && filter === "all") {
      const counts = await getCounts();
      return Response.json({ files: [], query: "", counts });
    }

    let entries: ScoredEntry[] = wsId
      ? await searchWorkspaceScored(wsId, q, { filter, sort })
      : await searchScored(userId, q, { filter, sort });

    // Blend in semantic file matches (user scope, relevance sort, real query) so
    // the Search tab finds files by meaning, not just keywords. Append misses
    // not already in the keyword results; keyword hits keep their top ranking.
    if (!wsId && q && sort === "relevance") {
      try {
        const sem = await searchFiles(userId, q, 10);
        if (sem.length) {
          const byKey = new Map((await getAllEntries(userId)).map((e) => [e.key, e]));
          const present = new Set(entries.map((e) => e.key));
          const cat = filter === "all" ? null : FILTER_CATEGORY[filter];
          for (const h of sem) {
            if (present.has(h.fileKey)) continue;
            const e = byKey.get(h.fileKey);
            if (!e) continue;
            if (cat && e.category !== cat) continue;
            entries.push({ ...e, score: h.score, matchedIn: ["meaning"] });
          }
          entries.sort((a, b) => b.score - a.score);
        }
      } catch (err) {
        console.warn("[GET /api/search] semantic blend skipped:", err);
      }
    }

    const files: SearchResultItem[] = await Promise.all(
      entries.map(async (e: ScoredEntry) => {
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: BUCKET, Key: e.key }),
          { expiresIn: 3600 }
        );
        return {
          id:        e.key,
          name:      e.filename,
          size:      e.size,
          mimeType:  e.mimeType,
          url,
          createdAt: e.createdAt,
          userId,
          score:     e.score,
          matchedIn: e.matchedIn,
          category:  e.category,
        };
      })
    );

    const counts = await getCounts();

    return Response.json({
      files,
      query:  q,
      filter,
      sort,
      count:  files.length,
      counts, // category counts for filter chip badges
    });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/search]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
