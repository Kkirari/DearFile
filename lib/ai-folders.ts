/**
 * AI folder catalog — fixed, deterministic IDs.
 * Auto-folders are virtual: files don't physically live inside them.
 * Membership is determined by S3 object tag `df_ai_folder_id`.
 */

export interface AiFolderDef {
  id: string;
  name: string;
  category: "photo" | "document" | "finance" | "academic";
  type: string;
}

export const AI_FOLDERS: AiFolderDef[] = [
  { id: "ai-photos-general",  name: "📸 Photos",       category: "photo",    type: "general"    },
  { id: "ai-photos-people",   name: "👥 People",       category: "photo",    type: "people"     },
  { id: "ai-photos-animals",  name: "🐾 Animals",      category: "photo",    type: "animal"     },
  { id: "ai-photos-food",     name: "🍜 Food",         category: "photo",    type: "food"       },
  { id: "ai-photos-places",   name: "🗺️ Places",       category: "photo",    type: "place"      },
  { id: "ai-screenshots",     name: "📷 Screenshots",  category: "photo",    type: "screenshot" },
  { id: "ai-docs-receipt",    name: "🧾 Receipts",     category: "finance",  type: "receipt"    },
  { id: "ai-docs-contract",   name: "📋 Contracts",    category: "document", type: "contract"   },
  { id: "ai-docs-report",     name: "📊 Reports",      category: "document", type: "report"     },
  { id: "ai-docs-academic",   name: "🎓 Academic",     category: "academic", type: "general"    },
  { id: "ai-docs-general",    name: "📄 Documents",    category: "document", type: "general"    },
];

const BY_ID = new Map(AI_FOLDERS.map((f) => [f.id, f]));

/** Map analyzer (category, type) → AI folder id. Falls back to general per category. */
export function mapToAiFolder(category: string, type: string): string {
  const exact = AI_FOLDERS.find((f) => f.category === category && f.type === type);
  if (exact) return exact.id;

  // category-level fallbacks
  const fallback: Record<string, string> = {
    photo:    "ai-photos-general",
    finance:  "ai-docs-receipt",
    academic: "ai-docs-academic",
    document: "ai-docs-general",
  };
  return fallback[category] ?? "ai-docs-general";
}

export function getAiFolder(id: string): AiFolderDef | undefined {
  return BY_ID.get(id);
}

export function isAiFolderId(id: string): boolean {
  return id.startsWith("ai-");
}
