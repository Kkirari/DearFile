/**
 * MCP (Model Context Protocol) server — Phase 11.
 *
 * Single Streamable HTTP endpoint at `/api/mcp`. Bearer-gated per-user via the
 * tokens issued from /api/mcp/tokens. Read-only v1: 4 tools that mirror what
 * the LIFF app already shows the user (files, captures, daily brief).
 *
 *   - search             keyword + semantic across files + notes/links
 *   - get_file           full metadata for one file (presigned URL)
 *   - get_daily_summary  AI brief for an ICT day (cached when available)
 *   - list_recent        recent files and/or captures
 *
 * The MCP server delegates auth to mcp-handler's `experimental_withMcpAuth`
 * wrapper; the userId is stuffed into AuthInfo.extra so each tool reads it
 * via `extra.authInfo.extra.userId`.
 *
 * Stateless mode (sessionIdGenerator: undefined). No SSE (`disableSse: true`)
 * — clients reconnect per request, which is fine for Claude Desktop and
 * matches Fluid Compute's instance reuse model.
 */

import { createMcpHandler, experimental_withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { verifyMcpToken } from "@/lib/mcp-tokens";
import { getUserKeys } from "@/lib/byok";
import { embedOne, embeddingsEnabled } from "@/lib/embeddings";
import { searchChunks, getDailySummary, getItem, listItems, type CaptureSearchHit, type ContentItem } from "@/lib/db";
import {
  getAllEntries,
  searchScored,
  type FilterMode,
  type IndexEntry,
} from "@/lib/search-index";
import { searchFiles } from "@/lib/file-search";
import { s3, BUCKET } from "@/lib/s3";
import { buildSummaryForDate } from "@/lib/summary";
import { ictDateLabel } from "@/lib/summary";

export const maxDuration = 60;

const SEARCH_DEFAULT_LIMIT = 6;
const SEARCH_MAX_LIMIT     = 20;
const RECENT_DEFAULT_LIMIT = 20;
const RECENT_MAX_LIMIT     = 50;

const FILTER_CATEGORY: Record<string, string> = {
  photos: "photo", documents: "document", finance: "finance", academic: "academic",
};

interface ToolCtx {
  authInfo?: { extra?: { userId?: string } };
}

function readUserId(extra: ToolCtx): string {
  const userId = extra.authInfo?.extra?.userId;
  if (typeof userId !== "string" || !userId) {
    throw new Error("Missing userId in auth context");
  }
  return userId;
}

async function presign(key: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 });
}

function fileResult(entry: IndexEntry, score: number, url: string) {
  return {
    kind:      "file" as const,
    key:       entry.key,
    filename:  entry.filename,
    subject:   entry.subject,
    detail:    entry.detail,
    category:  entry.category,
    date:      entry.date,
    keywords:  entry.keywords,
    score,
    url,
    createdAt: entry.createdAt,
  };
}

function captureResult(hit: CaptureSearchHit) {
  return {
    kind:      "capture" as const,
    id:        hit.id,
    itemType:  hit.type,
    title:     hit.title,
    summary:   hit.summary,
    sourceUrl: hit.sourceUrl,
    tags:      hit.tags,
    createdAt: hit.createdAt,
    score:     hit.score,
  };
}

function asFilter(s: string | undefined): FilterMode {
  if (s === "photos" || s === "documents" || s === "finance" || s === "academic") return s;
  return "all";
}

function captureFromItem(item: ContentItem) {
  return {
    kind:      "capture" as const,
    id:        item.id,
    itemType:  item.type,
    title:     item.title,
    summary:   item.summary,
    sourceUrl: item.sourceUrl,
    tags:      item.tags,
    createdAt: item.createdAt,
  };
}

const baseHandler = createMcpHandler(
  (server) => {
    // ── search (files + captures, keyword + semantic) ────────────────────────
    server.registerTool(
      "search",
      {
        description:
          "Search the user's saved files (keyword + meaning) and notes/links (meaning). " +
          "Returns the most relevant items ranked by score. Use kind to restrict.",
        inputSchema: {
          query:  z.string().min(1).describe("Keywords or a short phrase in any language."),
          kind:   z.enum(["all", "files", "captures"]).optional().describe('"all" (default), "files", or "captures".'),
          filter: z.enum(["all", "photos", "documents", "finance", "academic"]).optional()
                   .describe("Restrict files to a category (no effect on captures)."),
          limit:  z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional()
                   .describe(`Max items per source (default ${SEARCH_DEFAULT_LIMIT}).`),
        },
      },
      async ({ query, kind, filter, limit }, extra) => {
        const userId = readUserId(extra as ToolCtx);
        const n      = limit ?? SEARCH_DEFAULT_LIMIT;
        const k      = kind ?? "all";
        const f      = asFilter(filter);
        const keys   = await getUserKeys(userId);

        const wantFiles    = k === "all" || k === "files";
        const wantCaptures = k === "all" || k === "captures";

        const filesP   = wantFiles    ? searchScored(userId, query, { filter: f, sort: "relevance" }) : Promise.resolve([] as Awaited<ReturnType<typeof searchScored>>);
        const semFP    = wantFiles    ? searchFiles(userId, query, n, { voyageApiKey: keys.voyage })  : Promise.resolve([] as Awaited<ReturnType<typeof searchFiles>>);
        const capP     = wantCaptures && embeddingsEnabled({ apiKey: keys.voyage })
                          ? embedOne(query, "query", { apiKey: keys.voyage }).then((vec) => searchChunks(userId, vec, n))
                          : Promise.resolve([] as CaptureSearchHit[]);

        const [keywordFiles, semFiles, captures] = await Promise.all([filesP, semFP, capP]);

        // Merge keyword + semantic file hits by key (max score).
        const byKey = new Map<string, { entry: IndexEntry; score: number }>();
        for (const r of keywordFiles) {
          byKey.set(r.key, { entry: r, score: r.score });
        }
        if (semFiles.length) {
          const all = new Map((await getAllEntries(userId)).map((e) => [e.key, e]));
          const cat = f === "all" ? null : FILTER_CATEGORY[f];
          for (const h of semFiles) {
            const entry = all.get(h.fileKey);
            if (!entry) continue;
            if (cat && entry.category !== cat) continue;
            const prev = byKey.get(h.fileKey);
            if (!prev || h.score > prev.score) byKey.set(h.fileKey, { entry, score: h.score });
          }
        }
        const fileTopN = [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, n);

        const files = await Promise.all(
          fileTopN.map(async ({ entry, score }) => fileResult(entry, score, await presign(entry.key))),
        );

        const results = [
          ...files,
          ...captures.map(captureResult),
        ].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

        return { content: [{ type: "text", text: JSON.stringify({ results }) }] };
      },
    );

    // ── get_file ─────────────────────────────────────────────────────────────
    server.registerTool(
      "get_file",
      {
        description: "Get full metadata for one of the user's files by its key (from a search result).",
        inputSchema: {
          key: z.string().describe("The file key returned by `search` or `list_recent`."),
        },
      },
      async ({ key }, extra) => {
        const userId = readUserId(extra as ToolCtx);
        const all = await getAllEntries(userId);
        const entry = all.find((e) => e.key === key);
        if (!entry) {
          return { content: [{ type: "text", text: JSON.stringify({ found: false }) }] };
        }
        const url = await presign(entry.key);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ found: true, file: fileResult(entry, 1, url) }),
          }],
        };
      },
    );

    // ── get_daily_summary ────────────────────────────────────────────────────
    server.registerTool(
      "get_daily_summary",
      {
        description:
          "Get the AI-generated daily brief of what the user saved on one ICT calendar day. " +
          "Defaults to today. Past days are typically cached; today may rebuild on demand.",
        inputSchema: {
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ICT date YYYY-MM-DD; default = today."),
        },
      },
      async ({ date }, extra) => {
        const userId = readUserId(extra as ToolCtx);
        const day = date ?? ictDateLabel(Date.now());
        const cached = await getDailySummary(userId, day).catch(() => null);
        if (cached) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                date:       cached.date,
                text:       cached.text,
                fileCount:  cached.fileCount,
                itemCount:  cached.itemCount,
                createdAt:  cached.createdAt,
                cached:     true,
              }),
            }],
          };
        }
        const built = await buildSummaryForDate(userId, day).catch(() => null);
        if (!built) {
          return { content: [{ type: "text", text: JSON.stringify({ date: day, summary: null }) }] };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              date:      built.date,
              text:      built.text,
              fileCount: built.captures.length,
              itemCount: built.count - built.captures.length,
              cached:    false,
            }),
          }],
        };
      },
    );

    // ── list_recent ──────────────────────────────────────────────────────────
    server.registerTool(
      "list_recent",
      {
        description: "List the user's most recent files and/or captures (notes/links).",
        inputSchema: {
          kind:  z.enum(["all", "files", "captures"]).optional(),
          limit: z.number().int().min(1).max(RECENT_MAX_LIMIT).optional(),
        },
      },
      async ({ kind, limit }, extra) => {
        const userId = readUserId(extra as ToolCtx);
        const n = limit ?? RECENT_DEFAULT_LIMIT;
        const k = kind ?? "all";

        const filesP    = k !== "captures" ? getAllEntries(userId) : Promise.resolve([] as IndexEntry[]);
        const capturesP = k !== "files"    ? listItems(userId, { limit: n }) : Promise.resolve([] as ContentItem[]);

        const [allFiles, allCaptures] = await Promise.all([filesP, capturesP]);
        const files = allFiles
          .slice()
          .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
          .slice(0, n);

        const fileResults = await Promise.all(
          files.map(async (e) => fileResult(e, 0, await presign(e.key))),
        );
        const captureResults = allCaptures
          .filter((it) => it.status === "ready")
          .map(captureFromItem);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              files:    fileResults,
              captures: captureResults,
            }),
          }],
        };
      },
    );
  },
  {
    serverInfo: { name: "dearfile", version: "1.0.0" },
  },
  {
    basePath:   "/api",
    disableSse: true,
    maxDuration: 60,
    verboseLogs: false,
  },
);

const protectedHandler = experimental_withMcpAuth(
  baseHandler,
  async (_req, bearer) => {
    const userId = await verifyMcpToken(bearer);
    if (!userId) return undefined;
    return {
      token:    bearer ?? "",
      clientId: userId,
      scopes:   ["mcp"],
      extra:    { userId },
    };
  },
  { required: true },
);

export const GET    = protectedHandler;
export const POST   = protectedHandler;
export const DELETE = protectedHandler;
