import { analyzeFile } from "@/lib/analyzer";
import { renameS3Object } from "@/lib/s3";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { key?: string };
    const { key } = body;

    if (!key || typeof key !== "string") {
      return Response.json(
        { error: "Missing required field: key (S3 object key)" },
        { status: 400 }
      );
    }

    // 1. Analyze
    const analysis = await analyzeFile(key);

    // 2. Auto-rename in S3 (skip if fallback gave no useful name)
    let newKey = key;
    if (analysis.via !== "fallback") {
      try {
        newKey = await renameS3Object(key, analysis.suggested_filename);
      } catch (renameErr) {
        console.warn("[analyze] rename failed, keeping original key:", renameErr);
      }
    }

    return Response.json({ ...analysis, originalKey: key, newKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/analyze]", message);

    if (message.startsWith("Unsupported file type")) {
      return Response.json({ error: message }, { status: 422 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
