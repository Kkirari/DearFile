"use client";

import { useEffect, useState } from "react";
import { Folder, Sparkles, MoreHorizontal, Pin } from "lucide-react";
import {
  isPinned as isPinnedPref,
  getFolderColor,
  getFolderEmoji,
  getColorHex,
  AI_ACCENT,
} from "@/lib/folder-prefs";
import type { FolderItem } from "@/types/folder";
import type { FolderPreview } from "@/hooks/use-folder-previews";

interface FolderCardProps {
  folder: FolderItem;
  index?: number;
  preview?: FolderPreview;
  /** Bump this number to force re-read of localStorage prefs after customize. */
  prefsVersion?: number;
  onClick?: () => void;
  onMore?: (e: React.MouseEvent) => void;
}

function timeAgo(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

export function FolderCard({ folder, index = 0, preview, prefsVersion = 0, onClick, onMore }: FolderCardProps) {
  const isAi = folder.owner === "ai";
  const fileCount = preview?.total ?? folder.count ?? 0;

  // Reactive prefs (re-read when prefsVersion changes)
  const [pinned, setPinned]    = useState(false);
  const [colorId, setColorId]  = useState<string>("default");
  const [emoji, setEmoji]      = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPinned(isPinnedPref(folder.id));
    if (!isAi) {
      setColorId(getFolderColor(folder.id));
      setEmoji(getFolderEmoji(folder.id));
    }
  }, [folder.id, isAi, prefsVersion]);

  const colorHex = getColorHex(colorId);
  const accent   = isAi ? AI_ACCENT : colorHex;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick?.()}
      className={`card-enter relative w-full text-left rounded-2xl p-4 transition-all active:scale-95 cursor-pointer ${
        isAi
          ? "border border-[#d99c5b]/25 dark:border-[#d99c5b]/35 bg-[#d99c5b]/[0.06] dark:bg-[#d99c5b]/10 shadow-[0_1px_3px_rgba(74,64,54,0.05)]"
          : "border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] shadow-[0_1px_3px_rgba(74,64,54,0.07)]"
      }`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* ── PIN BADGE ── */}
      {pinned && (
        <div
          className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#9b869c]/15"
          aria-label="Pinned"
        >
          <Pin size={9} className="text-[#9b869c]" strokeWidth={2.5} fill="currentColor" />
        </div>
      )}

      {/* ── ICON + MORE BUTTON ── */}
      <div className="flex items-start justify-between mb-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl text-[20px]"
          style={{ background: `${accent}1a` }}
        >
          {emoji ? (
            <span className="leading-none">{emoji}</span>
          ) : isAi ? (
            <Sparkles size={18} style={{ color: accent }} />
          ) : (
            <Folder size={21} style={{ color: accent }} />
          )}
        </div>
        {onMore && (
          <button
            onClick={(e) => { e.stopPropagation(); onMore(e); }}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[#b0a396] dark:text-[#6e6460] active:bg-[#e0d8cc] dark:active:bg-[#3a3430] transition-colors"
          >
            <MoreHorizontal size={15} />
          </button>
        )}
      </div>

      {/* ── NAME + META ── */}
      <p className="text-[14px] font-bold leading-tight text-[#4a4036] dark:text-[#e8ddd4] line-clamp-2">
        {folder.name}
      </p>
      <p className="mt-1 text-[11px] text-[#b0a396] dark:text-[#6e6460]">
        {fileCount} {fileCount === 1 ? "file" : "files"} · {timeAgo(folder.updatedAt)}
      </p>
    </div>
  );
}
