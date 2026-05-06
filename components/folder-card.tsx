import { Folder, Sparkles, MoreHorizontal } from "lucide-react";
import type { FolderItem } from "@/types/folder";

interface FolderCardProps {
  folder: FolderItem;
  index?: number;
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

export function FolderCard({ folder, index = 0, onClick, onMore }: FolderCardProps) {
  const isAi = folder.owner === "ai";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick?.()}
      className={`card-enter w-full text-left rounded-2xl p-4 transition-all active:scale-95 cursor-pointer ${
        isAi
          ? "border border-[#9b869c]/20 bg-[#9b869c]/5 shadow-[0_1px_3px_rgba(74,64,54,0.05)]"
          : "border border-[#e0d8cc] bg-white shadow-[0_1px_3px_rgba(74,64,54,0.07)]"
      }`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            isAi ? "bg-[#9b869c]/15" : "bg-[#9b869c]/10"
          }`}
        >
          {isAi ? (
            <Sparkles size={18} className="text-[#9b869c]" />
          ) : (
            <Folder size={21} className="text-[#9b869c]" />
          )}
        </div>
        {onMore && (
          <button
            onClick={(e) => { e.stopPropagation(); onMore(e); }}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[#b0a396] active:bg-[#e0d8cc] transition-colors"
          >
            <MoreHorizontal size={15} />
          </button>
        )}
      </div>
      <p className="text-[14px] font-bold leading-tight text-[#4a4036]">{folder.name}</p>
      <p className="mt-1 text-[11px] text-[#b0a396]">{timeAgo(folder.updatedAt)}</p>
    </div>
  );
}
