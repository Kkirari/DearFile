/**
 * Client-side folder preferences stored in localStorage:
 *   - Pinned folder IDs (favorites, shown at top)
 *   - Recently visited folder IDs (most-recent-first)
 *   - Custom color overrides per folder
 *   - Custom emoji overrides per folder
 */

const PIN_KEY     = "dearfile.foldersPinned";
const RECENT_KEY  = "dearfile.foldersRecent";
const COLORS_KEY  = "dearfile.folderColors";
const EMOJIS_KEY  = "dearfile.folderEmojis";

const RECENT_LIMIT = 6;

// ── Available customization palettes ─────────────────────────────────────────

export const FOLDER_COLORS = [
  { id: "default", label: "Lavender", hex: "#9b869c" },
  { id: "rose",    label: "Rose",     hex: "#d97a8a" },
  { id: "amber",   label: "Amber",    hex: "#d99c5b" },
  { id: "olive",   label: "Olive",    hex: "#8fa572" },
  { id: "teal",    label: "Teal",     hex: "#5fa3a3" },
  { id: "sky",     label: "Sky",      hex: "#7ba2d4" },
  { id: "violet",  label: "Violet",   hex: "#9c84d4" },
  { id: "graphite",label: "Graphite", hex: "#6e6460" },
];

// Reserved accents — keep `LAVENDER` (mauve) for interaction state only;
// `AI_ACCENT` (warm amber) marks AI-organized surfaces as a distinct lane.
export const LAVENDER   = "#9b869c";
export const AI_ACCENT  = "#d99c5b";

export const FOLDER_EMOJIS = [
  "📁", "📂", "🗂️", "📦", "🎁", "💼",
  "📚", "📝", "📷", "🎨", "🎵", "🎬",
  "💼", "🧾", "📊", "🎓", "💡", "⭐",
  "🔥", "❤️", "🌸", "🌿", "☕", "🍕",
];

export type FolderColorId = (typeof FOLDER_COLORS)[number]["id"];

// ── Generic localStorage helpers ──────────────────────────────────────────────

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* ignore quota */ }
}

// ── Pinned folders ────────────────────────────────────────────────────────────

// Pinning is restricted to user-owned folders. AI folders are virtual and
// auto-organized, so pinning them adds no value. This filter also removes
// any AI ids that may have been pinned by older builds.
export function getPinned(): string[] {
  return readJson<string[]>(PIN_KEY, [])
    .filter((x) => typeof x === "string" && !x.startsWith("ai-"));
}

export function isPinned(id: string): boolean {
  return getPinned().includes(id);
}

export function togglePin(id: string): boolean {
  // Defense in depth — UI hides Pin for AI folders, but if a caller slips
  // through, refuse silently instead of polluting the pin list.
  if (id.startsWith("ai-")) return false;
  const list = getPinned();
  const i = list.indexOf(id);
  if (i >= 0) {
    list.splice(i, 1);
    writeJson(PIN_KEY, list);
    return false;
  }
  list.unshift(id);
  writeJson(PIN_KEY, list);
  return true;
}

// ── Recent folders ────────────────────────────────────────────────────────────

export function getRecent(): string[] {
  return readJson<string[]>(RECENT_KEY, []).filter((x) => typeof x === "string");
}

export function trackVisit(id: string): void {
  if (!id || id === "inbox") return;
  const list = getRecent().filter((x) => x !== id);
  list.unshift(id);
  writeJson(RECENT_KEY, list.slice(0, RECENT_LIMIT));
}

export function clearRecent(): void {
  writeJson(RECENT_KEY, []);
}

// ── Colors ────────────────────────────────────────────────────────────────────

export function getFolderColor(id: string): string {
  const map = readJson<Record<string, string>>(COLORS_KEY, {});
  return map[id] ?? "default";
}

export function setFolderColor(id: string, colorId: string): void {
  const map = readJson<Record<string, string>>(COLORS_KEY, {});
  if (colorId === "default") delete map[id];
  else map[id] = colorId;
  writeJson(COLORS_KEY, map);
}

export function getColorHex(colorId: string): string {
  return FOLDER_COLORS.find((c) => c.id === colorId)?.hex ?? FOLDER_COLORS[0].hex;
}

// ── Emojis ────────────────────────────────────────────────────────────────────

export function getFolderEmoji(id: string): string | null {
  const map = readJson<Record<string, string>>(EMOJIS_KEY, {});
  return map[id] ?? null;
}

export function setFolderEmoji(id: string, emoji: string | null): void {
  const map = readJson<Record<string, string>>(EMOJIS_KEY, {});
  if (!emoji) delete map[id];
  else map[id] = emoji;
  writeJson(EMOJIS_KEY, map);
}
