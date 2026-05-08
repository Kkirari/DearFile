import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "@/lib/s3";
import {
  searchScored,
  countByFilter,
  type FilterMode,
  type SortMode,
  type ScoredEntry,
} from "@/lib/search-index";
import type { FileItem } from "@/types/file";

export interface SearchResultItem extends FileItem {
  score: number;
  matchedIn: string[];
  category: string;
}

function asFilter(s: string | null): FilterMode {
  if (s === "photos" || s === "documents" || s === "finance" || s === "academic") return s;
  return "all";
}

function asSort(s: string | null): SortMode {
  if (s === "newest" || s === "oldest" || s === "largest") return s;
  return "relevance";
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q      = (searchParams.get("q") ?? "").trim();
    const filter = asFilter(searchParams.get("filter"));
    const sort   = asSort(searchParams.get("sort"));

    // Empty query + no active filter → return empty (UI shows recent/suggestions instead)
    if (!q && filter === "all") {
      const counts = await countByFilter();
      return Response.json({ files: [], query: "", counts });
    }

    const entries = await searchScored(q, { filter, sort });

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
          userId:    "unknown",
          score:     e.score,
          matchedIn: e.matchedIn,
          category:  e.category,
        };
      })
    );

    const counts = await countByFilter();

    return Response.json({
      files,
      query:  q,
      filter,
      sort,
      count:  files.length,
      counts, // category counts for filter chip badges
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/search]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
