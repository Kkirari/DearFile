import { askDearFile, type AskScope } from "@/lib/ask";
import { requireUserId, authErrorResponse, AuthError } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { isSafeWorkspaceId } from "@/lib/s3";

/**
 * Test/headless endpoint for the "Ask DearFile" engine — lets us exercise the
 * agentic retrieval loop without going through LINE (mirrors /api/analyze).
 *
 *   POST /api/ask  { question: string, workspaceId?: string }
 *     → { answer: string, citations: IndexEntry[] }
 *
 * Personal scope by default; pass `workspaceId` (and be a member) to ask over
 * a shared workspace's index.
 */
export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId(req);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    throw err;
  }

  try {
    const { question, workspaceId } = (await req.json()) as {
      question?: unknown;
      workspaceId?: unknown;
    };

    if (typeof question !== "string" || !question.trim()) {
      return Response.json({ error: "Missing question" }, { status: 400 });
    }

    let scope: AskScope;
    const isWorkspaceCall =
      workspaceId !== undefined && workspaceId !== null && workspaceId !== "";

    if (isWorkspaceCall) {
      if (!isSafeWorkspaceId(workspaceId)) {
        return Response.json({ error: "Invalid workspaceId" }, { status: 400 });
      }
      await requireWorkspaceAccess(userId, workspaceId);
      scope = { kind: "workspace", workspaceId };
    } else {
      scope = { kind: "user", userId };
    }

    const result = await askDearFile(scope, question.trim());
    return Response.json(result);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/ask]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
