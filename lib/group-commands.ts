/**
 * Explicit commands for LINE group chats.
 *
 * The caller strips the sigil + trigger first (`parseAskCommand` in the webhook
 * already does that, and is the single implementation of it) and hands us just
 * the remainder. So `!น้องกวาง ตั้งค่า ปิดการตอบกลับ` arrives here as
 * `ตั้งค่า ปิดการตอบกลับ`.
 *
 * Anything unrecognised returns null and falls through to Ask, unchanged. That
 * fallthrough is the point: this is a fast, free shortcut in front of the model,
 * not a gate.
 *
 * Deliberately NOT a verb here: bare `หา`. The bot's own canonical Ask example is
 * "หาใบเสร็จเดือนที่แล้ว", so making `หา` mean keyword-search would fork on a
 * space nobody can see. `ค้นหา` / `search` / `find` are unambiguous; `หา…` keeps
 * going to Ask, which also finds files.
 */

export type GroupCommand =
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "quiet"; on: boolean }
  | { kind: "search"; query: string };

/** Exact-match verbs (no argument). Compared lowercased + trimmed. */
const EXACT: Array<[string[], GroupCommand]> = [
  [["ช่วยเหลือ", "คำสั่ง", "help", "commands", "?"], { kind: "help" }],
  [["สถานะ", "ตั้งค่า", "status", "settings"], { kind: "status" }],
  [
    [
      "ตั้งค่า ปิดการตอบกลับ",
      "ปิดการตอบกลับ",
      "ปิดตอบกลับ",
      "เงียบ",
      "quiet on",
      "mute",
    ],
    { kind: "quiet", on: true },
  ],
  [
    [
      "ตั้งค่า เปิดการตอบกลับ",
      "เปิดการตอบกลับ",
      "เปิดตอบกลับ",
      "quiet off",
      "unmute",
    ],
    { kind: "quiet", on: false },
  ],
];

/** Verbs taking the rest of the line as an argument. A space is required. */
const SEARCH_PREFIXES = ["ค้นหา", "search", "find"];

/**
 * @param rest the message with the sigil + trigger already removed
 */
export function parseGroupCommand(rest: string): GroupCommand | null {
  const t = (rest ?? "").trim();
  if (!t) return null;

  // Collapse internal whitespace so "ตั้งค่า   ปิดการตอบกลับ" still matches.
  const normalized = t.replace(/\s+/g, " ").toLowerCase();

  for (const [aliases, cmd] of EXACT) {
    if (aliases.some((a) => a.toLowerCase() === normalized)) return cmd;
  }

  for (const prefix of SEARCH_PREFIXES) {
    const p = prefix.toLowerCase();
    if (normalized.startsWith(p + " ")) {
      const query = t.slice(t.toLowerCase().indexOf(p) + p.length).trim();
      if (query) return { kind: "search", query };
    }
  }

  return null;
}
