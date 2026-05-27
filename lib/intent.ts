/**
 * Hybrid Intent Router — a cheap front-door for DM text so only real file
 * questions reach the (expensive) agentic Ask pipeline.
 *
 * Tier 1 — rules (free, synchronous): high-precision buckets for greetings,
 *   help, and noise, plus a high-recall STRONG_ASK so real questions skip the
 *   classifier. Anything left is "unsure".
 * Tier 2 — small LLM classifier (flag-gated by INTENT_CLASSIFIER=on): a single
 *   cheap, tool-less, index-less call that buckets only the "unsure" minority.
 *   ASK-biased: any failure defaults to "ask" so we never refuse a real question.
 *
 * Only DM text uses this. Group chats already require a /dearfile|/น้องกวาง
 * prefix — that prefix IS the ASK signal, so the router is skipped there.
 */

import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel } from "./ask";
import { getUserKeys } from "./byok";

export type Intent = "ask" | "greeting" | "help" | "noise" | "note";
export interface Decision {
  intent: Intent;
  via: "rules" | "llm";
}

const DEFAULT_INTENT_MODEL = "anthropic/claude-haiku-4-5";

// ── Lexicons ───────────────────────────────────────────────────────────────

// Whole-token greetings/acks (English). Tested against a token stripped of
// surrounding punctuation/emoji.
const GREETING_EN =
  /^(hi+|hey+|hello+|hiya|yo+|good(morning|night|evening|afternoon)|gm|gn|thanks?|thankyou|thx|ty|ok|okay|kk?|cool|nice|great|awesome|bye+|goodbye|np)$/;

// Thai politeness particles to peel off the end before matching a greeting root.
const TH_PARTICLES = ["ครับ", "คับ", "ค่ะ", "คะ", "ค่า", "นะ", "น่ะ", "จ้ะ", "จ้า", "ฮะ", "ผม", "หนู", "เลย"];
const TH_GREET_ROOTS = ["สวัสดี", "หวัดดี", "ขอบคุณ", "ขอบใจ", "โอเค", "ฮัลโหล", "ไง", "ดี"];

// Help / capability questions (substring match, both languages).
const HELP_EN =
  /\b(help|how (to|do i) use|how does (this|it) work|what can you do|what do you do|what is this|who are you|what are you|commands?|menu)\b/;
const HELP_TH = ["ช่วยอะไร", "ช่วยไร", "ทำอะไรได้", "ทำอะไรเป็น", "ใช้ยังไง", "ใช้งานยังไง", "วิธีใช้", "คืออะไร", "ใช้ไง"];

// STRONG_ASK cues — high recall so real questions skip the classifier.
const ASK_EN =
  /\b(files?|photos?|pictures?|images?|docs?|documents?|pdf|receipts?|invoices?|contracts?|reports?|videos?|screenshots?|notes?|slips?|find|search|where|show|locate|look for|do i have)\b/;
const ASK_TH = [
  "ไฟล์", "รูป", "ภาพ", "เอกสาร", "ใบเสร็จ", "ใบกำกับ", "สัญญา", "รายงาน",
  "วิดีโอ", "คลิป", "สลิป", "โน้ต", "สกรีนช็อต", "หา", "ค้นหา", "อยู่ไหน", "ขอดู",
];

// NOTE cues — explicit "save this thought" markers (high precision). Matched on
// the punctuation-stripped, lowercased text. Only used when NO ask cue is present,
// so a question is never mis-saved (e.g. "remember to find my receipt" → ask).
const NOTE_EN = /^(note|todo|to do|remember|remind me|reminder|dont forget|idea|fyi)\b/;
const NOTE_TH = ["อย่าลืม", "จดว่า", "จดไว้", "โน้ตว่า", "เตือนว่า", "เตือนความจำ", "บันทึกว่า"];

// ── Helpers ─────────────────────────────────────────────────────────────────

const EMOJI = /[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}]/gu;

/**
 * Strip emoji + punctuation/symbols, keep letters, numbers, whitespace AND
 * combining marks (\p{M}) — Thai vowel/tone marks are marks, not letters, so
 * dropping them would mangle words like "ใบเสร็จ" → "ใบเสรจ". Lowercased.
 */
function visible(text: string): string {
  return text.replace(EMOJI, "").replace(/[^\p{L}\p{N}\p{M}\s]/gu, "").trim().toLowerCase();
}

function stripThParticles(s: string): string {
  let prev: string;
  do {
    prev = s;
    for (const p of TH_PARTICLES) if (s.endsWith(p)) s = s.slice(0, -p.length);
  } while (s !== prev);
  return s;
}

function isGreetingToken(tok: string): boolean {
  const t = tok.replace(/[^\p{L}\p{N}\p{M}]/gu, "");
  if (t === "") return true;                 // was punctuation/emoji only
  if (/^5{2,}$/.test(t)) return true;        // Thai "555" laugh
  if (GREETING_EN.test(t)) return true;
  const r = stripThParticles(t);
  if (r === "") return true;                 // particle-only ack ("ครับ")
  return TH_GREET_ROOTS.some((root) => r === root || r.startsWith(root));
}

function hasAskCue(text: string): boolean {
  if (ASK_EN.test(text)) return true;
  if (ASK_TH.some((w) => text.includes(w))) return true;
  if (/มี[\s\S]{0,20}ไหม/.test(text)) return true;   // "do I have … ?"
  return false;
}

function hasNoteCue(text: string): boolean {
  if (NOTE_EN.test(text)) return true;
  if (NOTE_TH.some((w) => text.includes(w))) return true;
  return false;
}

function isNoise(original: string): boolean {
  const stripped = original.replace(EMOJI, "").replace(/[\s\p{P}\p{S}]/gu, "");
  return stripped.length === 0; // emoji / punctuation / whitespace only
}

// ── Tier 1: rules ────────────────────────────────────────────────────────────

/**
 * Classify by rules alone. Returns a concrete Intent or "unsure".
 * Precedence: noise → strong_ask → note → greeting → help → unsure.
 * (strong_ask before note/greeting so a question with a reminder word — e.g.
 * "remember to find my receipt" — stays an ask, never a saved note.)
 */
export function classifyByRules(text: string): Intent | "unsure" {
  const raw = text.trim();
  if (!raw) return "noise";
  if (isNoise(raw)) return "noise";

  const v = visible(raw);
  if (!v) return "noise";

  if (hasAskCue(v)) return "ask";
  if (hasNoteCue(v)) return "note";

  const tokens = v.split(/\s+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every(isGreetingToken)) return "greeting";

  if (HELP_EN.test(v) || HELP_TH.some((w) => v.includes(w))) return "help";

  return "unsure";
}

// ── Tier 2: small LLM classifier (flag-gated) ────────────────────────────────

const INTENT_SYSTEM =
  "Classify the user's chat message to a personal file/notes assistant into ONE intent:\n" +
  '- "ask": they want to find, search, or ask about their saved files.\n' +
  '- "note": a reminder, idea, or thought to SAVE for later — NOT a request to find anything.\n' +
  '- "greeting": a greeting, thanks, or small talk.\n' +
  '- "help": asking what the bot can do or how to use it.\n' +
  'When unsure, choose "ask" — never classify a real question as a note. Reply with the intent only.';

/** Cheap single-shot classifier. Only call for "unsure" text. ASK-biased. */
export async function classifyByLLM(text: string, opts?: { anthropicApiKey?: string }): Promise<Intent> {
  try {
    const { object } = await generateObject({
      model:  resolveModel(process.env.INTENT_MODEL_ID ?? DEFAULT_INTENT_MODEL, { anthropicApiKey: opts?.anthropicApiKey }),
      system: INTENT_SYSTEM,
      prompt: text,
      schema: z.object({ intent: z.enum(["ask", "greeting", "help", "note"]) }),
    });
    return object.intent;
  } catch (err) {
    console.warn("[intent] classifier failed, defaulting to ask:", err);
    return "ask";
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Route a DM message to an intent. Rules first; the LLM tier runs only on
 * "unsure" AND only when INTENT_CLASSIFIER=on. With the flag off, "unsure"
 * falls back to "ask" — i.e. today's behavior, zero added cost.
 */
export async function routeIntent(text: string, userId?: string): Promise<Decision> {
  const ruled = classifyByRules(text);
  if (ruled !== "unsure") return { intent: ruled, via: "rules" };

  if (process.env.INTENT_CLASSIFIER === "on") {
    const userKeys = userId ? await getUserKeys(userId) : {};
    return { intent: await classifyByLLM(text, { anthropicApiKey: userKeys.anthropic }), via: "llm" };
  }
  return { intent: "ask", via: "rules" };
}
