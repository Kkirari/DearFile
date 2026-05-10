/**
 * File Analyzer — Hybrid method:
 *   1. Extract EXIF / document metadata (free, local)
 *   2. If metadata insufficient → Claude Haiku via Bedrock
 *   Returns: { category, subject, detail, date, suggested_filename }
 *
 * Supported: jpg/jpeg/png (EXIF), pdf (digital), docx
 * Naming format: [category]_[subject]_[DD-M-YY].[ext]
 * IMPORTANT: Never identify or output person/pet names.
 */

import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { Readable } from "stream";
import { s3, BUCKET } from "./s3";
import { invokeHaiku, type ContentBlock } from "./bedrock";

// ── Public types ──────────────────────────────────────────────────────────────

export interface FileAnalysis {
  category: string;            // photo | document | finance | academic
  type: string;                // sub-type (animal, food, receipt, slide, ...)
  subject: string;             // kebab-case English topic
  detail: string;              // one-line description
  date: string | null;
  keywords: string[];          // mixed Thai + English for search
  suggested_filename: string;
  via: "metadata" | "claude" | "fallback";
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = ["jpg", "jpeg", "png", "pdf", "docx"] as const;
// Anthropic measures base64 STRING length (not binary size)
// base64 ≈ 4/3 × binary → max safe binary = 5MB × 3/4 = 3.75MB, use 3.5MB for margin
const MAX_IMAGE_BYTES_FOR_AI = Math.floor(3.5 * 1024 * 1024); // ~3.5 MB
const MAX_TEXT_CHARS_FOR_AI = 4000;

const SYSTEM_PROMPT = `You are a file categorization assistant for a document management app.
Analyze the file content and return ONLY a JSON object — no extra text, no markdown fences.

Required fields:
  category   – one of: photo, document, finance, academic
  type       – sub-type within the category. Use one of:
                photo:    general | people | animal | food | place | screenshot
                document: contract | report | general
                finance:  receipt | invoice | statement
                academic: exam | worksheet | slide | research | general
  subject    – 3-5 word descriptive topic in English (kebab-case, e.g. "monthly-sales-report")
  detail     – one sentence describing the content (English)
  date       – date found in content as "DD-M-YY" (e.g. "06-5-26"), or null if none
  keywords   – array of 4-8 search keywords MIXED Thai and English combined
                (e.g. ["ใบเสร็จ","กาแฟ","starbucks","receipt","coffee"])
                Include topic words, type, and any specific subjects (school subject, brand, etc.)
  suggested_filename – [category]_[subject]_[DD-M-YY].[ext] or [category]_[subject].[ext] if no date

STRICT RULES:
- NEVER include person names, pet names, or any identifiable individual names in any field.
- For animals: identify species (cat, dog, bird) but never the animal's name.
- subject and suggested_filename: only lowercase a-z, digits, hyphens.
- keywords: arbitrary Thai/English allowed.
- Return only the JSON object.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const m = d.getMonth() + 1; // no zero-pad on month
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${m}-${yy}`;
}

function sanitizeSegment(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, maxLen)
    .replace(/-$/, "");
}

function buildFilename(
  category: string,
  subject: string,
  date: string | null,
  ext: string
): string {
  const cat = sanitizeSegment(category) || "document";
  const sub = sanitizeSegment(subject) || "untitled";
  return date ? `${cat}_${sub}_${date}.${ext}` : `${cat}_${sub}.${ext}`;
}

function guessCategory(text: string): string {
  const t = text.toLowerCase();
  if (/receipt|ใบเสร็จ|payment receipt|paid/.test(t)) return "receipt";
  if (/invoice|ใบแจ้งหนี้|tax invoice/.test(t)) return "invoice";
  if (/contract|สัญญา|agreement|memorandum/.test(t)) return "contract";
  if (/report|รายงาน|summary|analysis/.test(t)) return "report";
  if (/certificate|ใบรับรอง|certification/.test(t)) return "certificate";
  if (/form|แบบฟอร์ม|application form/.test(t)) return "form";
  if (/photo|image|รูป|picture/.test(t)) return "photo";
  return "document";
}

function extractXmlTag(xml: string, tag: string): string {
  const escaped = tag.replace(":", "\\:");
  const re = new RegExp(`<${escaped}[^>]*>([^<]*)<\\/${escaped}>`, "i");
  return xml.match(re)?.[1]?.trim() ?? "";
}

function stripXmlTags(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
  }
  return Buffer.concat(chunks);
}

async function downloadFromS3(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const response = await s3.send(command);
  if (!response.Body) throw new Error("S3 returned empty body");
  return streamToBuffer(response.Body as Readable);
}

// ── Claude Haiku fallback ─────────────────────────────────────────────────────

async function callClaude(
  content: string | ContentBlock[],
  ext: string,
  knownDate: string | null
): Promise<FileAnalysis> {
  const userText =
    typeof content === "string"
      ? `File type: .${ext}${knownDate ? `\nKnown date: ${knownDate}` : ""}\n\nContent:\n${content}`
      : undefined;

  const messages =
    typeof content === "string"
      ? [{ role: "user" as const, content: userText! }]
      : [
          {
            role: "user" as const,
            content: [
              ...content,
              {
                type: "text" as const,
                text: `File extension: .${ext}${knownDate ? `\nEXIF date: ${knownDate}` : ""}\n\nAnalyze and return JSON as instructed.`,
              },
            ] as ContentBlock[],
          },
        ];

  let raw: string;
  try {
    raw = await invokeHaiku(messages, SYSTEM_PROMPT);
  } catch (err) {
    // API error (size limit, quota, etc.) → graceful fallback
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[analyzer] Claude API error, falling back:", msg);
    return {
      category: "document",
      type: "general",
      subject: "untitled",
      detail: "AI analysis unavailable",
      date: knownDate,
      keywords: [],
      suggested_filename: buildFilename("document", "untitled", knownDate, ext),
      via: "fallback",
    };
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude non-JSON response: ${raw.slice(0, 200)}`);

  const parsed = JSON.parse(jsonMatch[0]) as Partial<FileAnalysis>;
  const date = parsed.date ?? knownDate;
  const category = parsed.category ?? "document";
  const subject = parsed.subject ?? "untitled";

  return {
    category,
    type: parsed.type ?? "general",
    subject,
    detail: parsed.detail ?? "",
    date,
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((k) => typeof k === "string" && k.trim().length > 0).slice(0, 12) : [],
    suggested_filename: parsed.suggested_filename ?? buildFilename(category, subject, date, ext),
    via: "claude",
  };
}

// ── Image (jpg/png) ───────────────────────────────────────────────────────────

async function analyzeImage(buffer: Buffer, ext: string): Promise<FileAnalysis> {
  // Dynamic import — exifr is ESM
  const { default: exifr } = await import("exifr");

  let exifDate: string | null = null;
  let description = "";

  try {
    const exif = (await exifr.parse(buffer, {
      pick: ["DateTimeOriginal", "ImageDescription", "UserComment", "Make", "Model"],
    })) as Record<string, unknown> | undefined;

    if (exif) {
      // Some cameras hand back a Date instance; others return an ISO/EXIF string.
      const dto = exif.DateTimeOriginal;
      if (dto instanceof Date && !isNaN(dto.getTime())) {
        exifDate = formatDate(dto);
      } else if (typeof dto === "string" && dto.trim().length > 0) {
        // EXIF format is "YYYY:MM:DD HH:MM:SS" — Date() doesn't parse colons in date part
        const normalized = dto.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
        const parsed = new Date(normalized);
        if (!isNaN(parsed.getTime())) exifDate = formatDate(parsed);
      }
      description = String(exif.ImageDescription ?? exif.UserComment ?? "").trim();
    }
  } catch {
    // EXIF parse failed — proceed without
  }

  // Sufficient: meaningful description + date both present
  if (description.length > 3 && exifDate) {
    return {
      category: "photo",
      type: "general",
      subject: description,
      detail: "Photo with EXIF metadata",
      date: exifDate,
      keywords: description.split(/\s+/).filter((w) => w.length > 1).slice(0, 6),
      suggested_filename: buildFilename("photo", description, exifDate, ext),
      via: "metadata",
    };
  }

  // Need Claude — skip if too large
  if (buffer.length > MAX_IMAGE_BYTES_FOR_AI) {
    return {
      category: "photo",
      type: "general",
      subject: "untitled-photo",
      detail: "Image too large for AI analysis",
      date: exifDate,
      keywords: [],
      suggested_filename: buildFilename("photo", "untitled-photo", exifDate, ext),
      via: "fallback",
    };
  }

  const mimeType = ext === "png" ? "image/png" : "image/jpeg";
  const content: ContentBlock[] = [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: mimeType as "image/jpeg" | "image/png",
        data: buffer.toString("base64"),
      },
    },
  ];

  return callClaude(content, ext, exifDate);
}

// ── PDF ───────────────────────────────────────────────────────────────────────

async function analyzePdf(buffer: Buffer): Promise<FileAnalysis> {
  // pdf-parse v1 CJS — in serverExternalPackages so bundler skips it (no test-file issue)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse") as (
    buffer: Buffer,
    options?: { max?: number }
  ) => Promise<{ info: Record<string, string>; text: string; numpages: number }>;

  const data = await pdfParse(buffer, { max: 3 });
  const info = (data.info ?? {}) as Record<string, string>;

  const title = (info.Title ?? "").trim();
  const subject = (info.Subject ?? "").trim();
  const author = (info.Author ?? "").trim();
  const rawDate = info.CreationDate ?? info.creationDate ?? "";

  let date: string | null = null;
  if (rawDate) {
    // PDF date: D:YYYYMMDDHHmmSSZ or D:YYYYMMDD — build the DD-M-YY string
    // directly so we don't lose a day to UTC→local conversion.
    const clean = String(rawDate).replace(/^D:/, "");
    const year  = clean.slice(0, 4);
    const month = clean.slice(4, 6);
    const day   = clean.slice(6, 8);
    if (/^\d{4}$/.test(year) && /^\d{2}$/.test(month) && /^\d{2}$/.test(day)) {
      const dd = day;
      const m  = String(parseInt(month, 10)); // strip leading zero
      const yy = year.slice(-2);
      date = `${dd}-${m}-${yy}`;
    }
  }

  // Sufficient: has a real title
  if (title.length > 2) {
    const category = guessCategory(`${title} ${subject}`);
    const kw = `${title} ${subject}`.split(/[\s,;]+/).filter((w) => w.length > 1).slice(0, 8);
    return {
      category,
      type: "general",
      subject: title,
      detail: [author && `Author: ${author}`, subject].filter(Boolean).join(" · ") || "Digital PDF",
      date,
      keywords: kw,
      suggested_filename: buildFilename(category, title, date, "pdf"),
      via: "metadata",
    };
  }

  // Use extracted text as fallback
  const text = (data.text ?? "").slice(0, MAX_TEXT_CHARS_FOR_AI);
  return callClaude(text || "No readable text found", "pdf", date);
}

// ── DOCX ──────────────────────────────────────────────────────────────────────

async function analyzeDocx(buffer: Buffer): Promise<FileAnalysis> {
  const { default: JSZip } = await import("jszip");

  const zip = await JSZip.loadAsync(buffer);

  const coreXml = (await zip.file("docProps/core.xml")?.async("string")) ?? "";
  const title = extractXmlTag(coreXml, "dc:title");
  const description =
    extractXmlTag(coreXml, "dc:description") || extractXmlTag(coreXml, "dc:subject");
  const created = extractXmlTag(coreXml, "dcterms:created");

  let date: string | null = null;
  if (created) {
    try {
      date = formatDate(new Date(created));
    } catch {
      // ignore
    }
  }

  // Sufficient: non-trivial title
  if (title.length > 2) {
    const category = guessCategory(`${title} ${description}`);
    const kw = `${title} ${description}`.split(/[\s,;]+/).filter((w) => w.length > 1).slice(0, 8);
    return {
      category,
      type: "general",
      subject: title,
      detail: description || "Word document",
      date,
      keywords: kw,
      suggested_filename: buildFilename(category, title, date, "docx"),
      via: "metadata",
    };
  }

  // Extract document text for Claude
  const docXml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const text = stripXmlTags(docXml).slice(0, MAX_TEXT_CHARS_FOR_AI);
  return callClaude(text || "No readable text found", "docx", date);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function analyzeFile(s3Key: string): Promise<FileAnalysis> {
  const ext = s3Key.split(".").pop()?.toLowerCase() ?? "";

  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(`Unsupported file type: .${ext}`);
  }

  const buffer = await downloadFromS3(s3Key);

  if (ext === "jpg" || ext === "jpeg" || ext === "png") return analyzeImage(buffer, ext);
  if (ext === "pdf") return analyzePdf(buffer);
  if (ext === "docx") return analyzeDocx(buffer);

  throw new Error(`Unhandled extension: .${ext}`);
}
