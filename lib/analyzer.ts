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
import { invokeHaiku, type ContentBlock } from "./anthropic";
import { getUserKeys } from "./byok";

// ── Public types ──────────────────────────────────────────────────────────────

export interface FileAnalysis {
  category: string;            // photo | document | finance | academic
  type: string;                // sub-type (animal, food, receipt, slide, ...)
  subject: string;             // kebab-case English topic
  detail: string;              // one-line description
  date: string | null;
  keywords: string[];          // mixed Thai + English for search
  /**
   * What to call the file. When the uploaded name already describes the content
   * this is that name, unchanged — "keep it" is expressed as the suggestion
   * rather than as a flag, because callers derive the display name from the
   * final S3 key and the raw key still carries the "{timestamp}-" upload prefix.
   */
  suggested_filename: string;
  via: "metadata" | "claude" | "fallback";
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = ["jpg", "jpeg", "png", "pdf", "docx"] as const;
// Anthropic measures base64 STRING length (not binary size)
// base64 ≈ 4/3 × binary → max safe binary = 5MB × 3/4 = 3.75MB, use 3.5MB for margin
const MAX_IMAGE_BYTES_FOR_AI = Math.floor(3.5 * 1024 * 1024); // ~3.5 MB
const MAX_TEXT_CHARS_FOR_AI = 4000;

const SYSTEM_PROMPT = `You are the file analyzer for DearFile — a Thai user's personal cloud storage.
Look at the file's actual content and return a JSON object that names what it IS, specifically.
Never invent details. Never identify named individuals.

PROCESS (do this in order):
1. Read any visible text FIRST — signs, receipt totals, brand names, headings, screen content,
   captions, dates. Specific real text always beats a generic scene description.
2. Pick the most specific category + type for what the file IS.
3. Choose a subject that names the concrete thing (merchant, dish, breed, place, document title),
   not a generic word. If you can't tell anything specific, fall back to the dominant visual
   noun (e.g. "outdoor-landscape", "white-cat-portrait") — but NEVER write "untitled",
   "general-photo", "scan", or just the category name.

JSON FIELDS:
  category   — one of: photo, document, finance, academic
  type       — sub-type. Allowed values per category:
                photo:    general | people | animal | food | place | screenshot
                document: contract | report | general
                finance:  receipt | invoice | statement
                academic: exam | worksheet | slide | research | general
              Cues:
                screenshot  → visible status bar / battery icon / phone notch / app UI chrome /
                              browser address bar / OS buttons / pixel-perfect rectangles
                animal      → identify SPECIES (and breed if visible): "siamese-cat", "shiba-dog",
                              "parrot-bird". Never the animal's name.
                food        → name the DISH or drink: "pad-thai", "iced-latte", "khao-soi"
                place       → indoor/outdoor + landmark or type: "temple-courtyard",
                              "chiangmai-street", "office-meeting-room"
                people      → group size + context: "group-portrait", "wedding-ceremony",
                              "team-photo". NEVER write a person's name.
                receipt     → finance.receipt — has a merchant + line items + total
                invoice     → finance.invoice — issued by a business with VAT / invoice no.
                statement   → finance.statement — bank / credit card account history
                contract    → document.contract — agreement / MOU / signature block
                report      → document.report — multi-section analysis
                exam/worksheet/slide/research → academic — student / school / paper context
  subject    — 2-5 words, lowercase a-z digits hyphens only. Must be SPECIFIC.
                Good: "starbucks-receipt", "pad-thai-bowl", "siamese-cat-portrait",
                       "boarding-pass-bkk-cnx", "monthly-sales-q2", "math-worksheet-fractions"
                Bad:  "photo", "image", "scan", "untitled-photo", "general-photo",
                       "outdoor-photograph", "document", "untitled"
  detail     — ONE sentence (≤ 20 words) describing what is in the file.
                Language rule (important): use the language of the visible text in the file.
                  • If Thai text dominates → write detail in Thai.
                  • If English text dominates → write detail in English.
                  • If there is NO visible text → write detail in Thai (the user's primary
                    language).
                Examples:
                  • Thai receipt → "ใบเสร็จร้านกาแฟ Starbucks ยอดรวม 175 บาท"
                  • English book cover → "Cover of 'Atomic Habits' by James Clear"
                  • Scenic photo (no text) → "วิวทะเลตอนพระอาทิตย์ตกที่ชายหาด"
  date       — date that is PRINTED / VISIBLE in the file content, formatted "DD-M-YY"
                (e.g. "06-5-26"). If no visible date in the content, return null.
                Do NOT guess from file metadata; that's handled separately.
  keywords   — 4-8 search terms MIXED Thai + English: brand names, dish, type, language-specific
                terms a user might search by. Example: ["ใบเสร็จ","กาแฟ","starbucks","receipt"].
  suggested_filename — "[category]_[subject]_[DD-M-YY].[ext]" or "[category]_[subject].[ext]" if
                no date. Lowercase a-z, digits, hyphens, underscores only.
  keep_original — Answer ONE factual question: did a HUMAN type this filename, or did a device
                or app generate it? Do not judge whether the name is as good as the one you
                would write.
                  true  — a person chose these words. Thai or English both count.
                          "สัญญาเช่าบ้าน-2569.pdf", "ใบเสร็จค่าน้ำ-มกราคม.pdf",
                          "สลิปโอนเงิน-ทรูมันนี่-7พค.png", "Q2-sales-report-final.docx",
                          "โจทย์เลข-บทที่3.pdf"
                  false — a camera, scanner, screenshot tool or bot produced it.
                          "IMG_0001.jpg", "DCIM_4567.png", "image_1755648000000.jpg",
                          "Scan_20260101.pdf", "20260820_143022.jpg", "untitled.docx",
                          "document (3).pdf", "photo.png"
                  false — also when the name plainly contradicts what you see in the content.
                CRITICAL: that YOUR filename would be more detailed, more specific, or would add
                the amount / date / merchant is NOT a reason to return false. A human-typed name
                is the words its owner chose to find it by; your extra precision does not
                outrank that. Only device-generated names get replaced.
                When you cannot tell who wrote it, return true.

STRICT RULES (any violation = invalid response):
- NEVER include a person's name, a pet's name, or any identifiable individual's name.
- subject + suggested_filename: only a-z, 0-9, "-" and "_" (in filename) — no spaces, no Thai.
- keywords MUST be a JSON array of plain strings.
- keep_original MUST be a boolean. Fill in suggested_filename and every other field normally even
  when keep_original is true — they power search regardless of what the file ends up called.
- Return ONLY the JSON object. No markdown fences, no commentary, no leading text.`;

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

/**
 * Many phone cameras stuff useless boilerplate into ImageDescription / UserComment
 * (e.g. "IMG_0001", "DCIM_4567", "Photo", "Camera Photo", "Scan"). When that's
 * all we have, we shouldn't use it as a filename or skip Claude — we should
 * still ask Claude what's actually in the image.
 */
const MEANINGLESS_EXIF_PATTERNS: RegExp[] = [
  /^(img|dsc|dcim|mvimg|pano|scan|photo|camera|image|untitled|capture|snapshot)[\s_\-.]*\d*$/i,
  /^[\s\d_\-.]+$/,                 // pure digits / separators
  /^.{0,2}$/,                      // 0-2 chars
];

function isMeaningfulExifDescription(s: string): boolean {
  const trimmed = s.trim();
  return trimmed.length >= 3 && !MEANINGLESS_EXIF_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Recover the name the file was uploaded under. Every upload path writes the key
 * as `{prefix}/{Date.now()}-{filename}`, so stripping that timestamp gives the
 * original name back. `\d{10,}` so a real name starting with a year ("2026-q2.pdf")
 * survives.
 */
function originalNameFromKey(s3Key: string): string {
  return (s3Key.split("/").pop() ?? "").replace(/^\d{10,}-/, "");
}

/**
 * Does the uploaded filename already say what the file is? Camera and app noise
 * (IMG_4821, DCIM0032, Scan_001, 20260820_143022) says nothing; a name a human
 * typed ("ใบเสร็จค่าน้ำ-มกราคม") says plenty and is worth keeping — it's also the
 * highest-weighted field in search.
 *
 * Reuses the EXIF junk patterns. Stripping the extension first is load-bearing,
 * not cosmetic: LINE names every image/video/audio message `image_1755678901234.jpg`
 * (deriveFilename in the webhook), and the junk pattern ends in `\d*$` — the ".jpg"
 * would block the match and every LINE photo would falsely look meaningful.
 */
function looksMeaningfulFilename(name: string | undefined): boolean {
  const base = (name ?? "").trim().replace(/\.[^.]+$/, "").trim();
  return isMeaningfulExifDescription(base);
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
  knownDate: string | null,
  originalName: string,
  opts?: { anthropicApiKey?: string },
): Promise<FileAnalysis> {
  const nameLine = originalName ? `\nOriginal filename: ${originalName}` : "";

  const userText =
    typeof content === "string"
      ? `File type: .${ext}${nameLine}${knownDate ? `\nKnown date: ${knownDate}` : ""}\n\nContent:\n${content}`
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
                text: `File extension: .${ext}${nameLine}${knownDate ? `\nEXIF date: ${knownDate}` : ""}\n\nAnalyze and return JSON as instructed.`,
              },
            ] as ContentBlock[],
          },
        ];

  let raw: string;
  try {
    raw = await invokeHaiku(messages, SYSTEM_PROMPT, {
      apiKey:  opts?.anthropicApiKey,
      modelId: process.env.ANALYZER_MODEL_ID, // optional — falls back to ANTHROPIC_MODEL_ID then default
    });
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

  // `keep_original` is wire-only: the model answers it, we act on it here, and it
  // never reaches callers.
  const parsed = JSON.parse(jsonMatch[0]) as Partial<FileAnalysis> & {
    keep_original?: boolean;
  };
  const date = parsed.date ?? knownDate;
  const category = parsed.category ?? "document";
  const subject = parsed.subject ?? "untitled";

  // A boolean, then substituting the string ourselves — rather than asking the
  // model to echo the filename back — because Thai names carry combining vowel
  // and tone marks (\p{M}) that a re-emitted string can silently drop, and the
  // result would be a subtly different filename. The second half of the check
  // costs nothing (the helper is needed for the metadata paths regardless) and
  // stops the model keeping camera noise like "image_1755648000000.jpg".
  const keepOriginal =
    parsed.keep_original === true && looksMeaningfulFilename(originalName);

  return {
    category,
    type: parsed.type ?? "general",
    subject,
    detail: parsed.detail ?? "",
    date,
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((k) => typeof k === "string" && k.trim().length > 0).slice(0, 12) : [],
    suggested_filename: keepOriginal
      ? originalName
      : (parsed.suggested_filename ?? buildFilename(category, subject, date, ext)),
    via: "claude",
  };
}

// ── Image (jpg/png) ───────────────────────────────────────────────────────────

async function analyzeImage(buffer: Buffer, ext: string, originalName: string, opts?: { anthropicApiKey?: string }): Promise<FileAnalysis> {
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

  // Fast-path: only when EXIF gives us BOTH a meaningful description AND a date.
  // Junk-description filenames (IMG_0001, DCIM_4567, "Camera Photo") fall through
  // to Claude so the file actually gets named for its content, not its EXIF noise.
  if (exifDate && isMeaningfulExifDescription(description)) {
    // No model on this path, so judge the uploaded name with the same junk patterns.
    const keepOriginal = looksMeaningfulFilename(originalName);
    return {
      category: "photo",
      type: "general",
      subject: description,
      detail: description,
      date: exifDate,
      keywords: description.split(/\s+/).filter((w) => w.length > 1).slice(0, 6),
      suggested_filename: keepOriginal
        ? originalName
        : buildFilename("photo", description, exifDate, ext),
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

  return callClaude(content, ext, exifDate, originalName, opts);
}

// ── PDF ───────────────────────────────────────────────────────────────────────

async function analyzePdf(buffer: Buffer, originalName: string, opts?: { anthropicApiKey?: string }): Promise<FileAnalysis> {
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
    const keepOriginal = looksMeaningfulFilename(originalName);
    return {
      category,
      type: "general",
      subject: title,
      detail: [author && `Author: ${author}`, subject].filter(Boolean).join(" · ") || "Digital PDF",
      date,
      keywords: kw,
      suggested_filename: keepOriginal
        ? originalName
        : buildFilename(category, title, date, "pdf"),
      via: "metadata",
    };
  }

  // Use extracted text as fallback
  const text = (data.text ?? "").slice(0, MAX_TEXT_CHARS_FOR_AI);
  return callClaude(text || "No readable text found", "pdf", date, originalName, opts);
}

// ── DOCX ──────────────────────────────────────────────────────────────────────

async function analyzeDocx(buffer: Buffer, originalName: string, opts?: { anthropicApiKey?: string }): Promise<FileAnalysis> {
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
    const keepOriginal = looksMeaningfulFilename(originalName);
    return {
      category,
      type: "general",
      subject: title,
      detail: description || "Word document",
      date,
      keywords: kw,
      suggested_filename: keepOriginal
        ? originalName
        : buildFilename(category, title, date, "docx"),
      via: "metadata",
    };
  }

  // Extract document text for Claude
  const docXml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const text = stripXmlTags(docXml).slice(0, MAX_TEXT_CHARS_FOR_AI);
  return callClaude(text || "No readable text found", "docx", date, originalName, opts);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function analyzeFile(s3Key: string, userId?: string): Promise<FileAnalysis> {
  const ext = s3Key.split(".").pop()?.toLowerCase() ?? "";

  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(`Unsupported file type: .${ext}`);
  }

  const buffer = await downloadFromS3(s3Key);
  const originalName = originalNameFromKey(s3Key);
  const opts = userId
    ? { anthropicApiKey: (await getUserKeys(userId)).anthropic }
    : undefined;

  if (ext === "jpg" || ext === "jpeg" || ext === "png") return analyzeImage(buffer, ext, originalName, opts);
  if (ext === "pdf") return analyzePdf(buffer, originalName, opts);
  if (ext === "docx") return analyzeDocx(buffer, originalName, opts);

  throw new Error(`Unhandled extension: .${ext}`);
}
