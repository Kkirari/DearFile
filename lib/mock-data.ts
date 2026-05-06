// ── File types ───────────────────────────────────────────────────────────────

export type FileType = "pdf" | "image" | "doc" | "video" | "audio" | "archive";

// ── Browse chips ──────────────────────────────────────────────────────────────

export const TYPE_CHIPS = ["All", "Images", "Documents", "Videos", "Audio", "Others"] as const;
