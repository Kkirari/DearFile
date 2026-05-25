/**
 * Interest-profile learner (Phase 9) — the WRITE path of DearFile's memory.
 *
 * Once a day (piggybacking the 20:00 daily-summary cron) we merge the user's
 * existing profile with what they saved today into an updated interest profile:
 * a short list of recurring topic tags + a 1–2 sentence Thai "about you". The
 * profile is read back to personalize the daily brief (lib/summary.ts) and Ask
 * (lib/ask.ts), and is shown — and clearable — in the LIFF Profile tab.
 *
 * Best-effort: never throws (a model/DB hiccup must not break the daily push).
 * Privacy: never stores a person's/pet's/individual's name.
 *
 * Env: PROFILE_MODEL_ID (default anthropic/claude-haiku-4-5).
 */

import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel } from "./ask";
import { getUserProfile, upsertUserProfile, type ContentItem } from "./db";
import type { IndexEntry } from "./search-index";

const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";
const MAX_INTERESTS = 12;

const ProfileSchema = z.object({
  interests: z.array(z.string()).describe("Short topic tags the user is interested in, most relevant first (merge old + new, dedupe)."),
  about: z.string().describe("1–2 short Thai sentences on what the user is into / working on. No personal names."),
});

const SYSTEM = [
  "You maintain a concise, evolving interest profile for a DearFile user, learned from what they save.",
  "Merge the EXISTING profile with TODAY's saved items into an UPDATED profile.",
  "interests: short topic tags, most relevant first; drop stale or duplicate ones.",
  "about: 1–2 short sentences in Thai (ภาษาไทย) describing their interests/what they're working on.",
  "Never include a person's, pet's, or individual's name. Generalizing topics is fine.",
].join("\n");

/**
 * Update the user's profile from today's files + ready captures. No-op when the
 * day is empty. Caps interests at MAX_INTERESTS; keeps the old `about` if the
 * model returns nothing.
 */
export async function updateUserProfile(
  userId: string,
  files: IndexEntry[],
  items: ContentItem[],
): Promise<void> {
  if (files.length === 0 && items.length === 0) return;
  try {
    const existing = await getUserProfile(userId);

    const fileLines = files.slice(0, 40).map((e) => `- [file/${e.category}] ${e.subject || e.filename}`);
    const itemLines = items.slice(0, 40).map((it) => {
      const label = it.title || (it.type === "link" ? it.sourceUrl ?? "link" : "note");
      const detail = it.summary ? ` — ${it.summary.replace(/\s+/g, " ").slice(0, 120)}` : "";
      return `- [${it.type}/${it.category ?? "general"}] ${label}${detail}`;
    });

    const prompt = [
      existing
        ? `Existing interests: ${existing.interests.join(", ") || "(none)"}\nExisting about: ${existing.about ?? "(none)"}`
        : "No existing profile yet.",
      "",
      "Saved today:",
      ...fileLines,
      ...itemLines,
    ].join("\n");

    const { object } = await generateObject({
      model:           resolveModel(process.env.PROFILE_MODEL_ID ?? DEFAULT_MODEL),
      system:          SYSTEM,
      prompt,
      schema:          ProfileSchema,
      maxOutputTokens: 600,
    });

    await upsertUserProfile({
      userId,
      interests: (object.interests ?? []).map((s) => s.trim()).filter(Boolean).slice(0, MAX_INTERESTS),
      about:     object.about?.trim() || existing?.about || null,
    });
  } catch (err) {
    console.warn("[profile] update skipped:", err);
  }
}
