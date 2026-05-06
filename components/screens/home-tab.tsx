"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Search,
  User,
  FileText,
  Film,
  Music,
  Archive,
  Image as ImageIcon,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { FolderCard } from "@/components/folder-card";
import { FileDetailSheet } from "@/components/file-detail-sheet";
import { ImageLightbox } from "@/components/image-lightbox";
import { TYPE_CHIPS } from "@/lib/mock-data";
import { getFileIcon } from "@/lib/utils";
import type { FileItem } from "@/types/file";
import type { FolderItem } from "@/types/folder";
import type { FileType } from "@/lib/mock-data";

// ── File type icon/color config ───────────────────────────────────────────────

const FILE_TYPE_CONFIG: Record<FileType, { icon: React.ElementType; bg: string; color: string }> = {
  pdf:     { icon: FileText,   bg: "bg-red-50",     color: "text-red-500"     },
  image:   { icon: ImageIcon,  bg: "bg-blue-50",    color: "text-blue-500"    },
  doc:     { icon: FileText,   bg: "bg-emerald-50", color: "text-emerald-600" },
  video:   { icon: Film,       bg: "bg-violet-50",  color: "text-violet-500"  },
  audio:   { icon: Music,      bg: "bg-pink-50",    color: "text-pink-500"    },
  archive: { icon: Archive,    bg: "bg-amber-50",   color: "text-amber-500"   },
};

const HOME_FOLDER_LIMIT = 2;
const RECENT_LIMIT = 8;

// ── Props ─────────────────────────────────────────────────────────────────────

interface HomeTabProps {
  displayName?: string;
  pictureUrl?: string;
  onNavigate: (tab: string) => void;
  files: FileItem[];
  filesLoading: boolean;
  onRefresh: () => void;
  folders: FolderItem[];
  foldersLoading: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HomeTab({ displayName, pictureUrl, onNavigate, files, filesLoading, onRefresh, folders, foldersLoading }: HomeTabProps) {
  const [activeChip, setActiveChip]       = useState<string>("All");
  const [selectedFile, setSelectedFile]   = useState<FileItem | null>(null);
  const [lightboxFile, setLightboxFile]   = useState<FileItem | null>(null);

  const userFolders        = folders.filter((f) => f.owner === "user");
  const aiFolders          = folders.filter((f) => f.owner === "ai");
  const previewUserFolders = userFolders.slice(0, HOME_FOLDER_LIMIT);
  const previewAiFolders   = aiFolders.slice(0, HOME_FOLDER_LIMIT);
  const hasMoreFolders     = userFolders.length > HOME_FOLDER_LIMIT || aiFolders.length > HOME_FOLDER_LIMIT;

  const recentFiles = files.slice(0, RECENT_LIMIT);

  return (
    <div className="overflow-y-auto pb-[76px]">

      {/* ── HEADER ── */}
      <div className="bg-[#f4f3ee] px-5 pt-14 pb-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[26px] font-bold leading-none tracking-tight text-[#4a4036]">
            DearFile.
          </h1>
          <div className="h-9 w-9 overflow-hidden rounded-full border border-[#e0d8cc] bg-[#9b869c]/15 flex items-center justify-center">
            {pictureUrl ? (
              <Image
                src={pictureUrl}
                alt={displayName ?? "profile"}
                width={36}
                height={36}
                className="h-full w-full object-cover"
              />
            ) : (
              <User size={17} className="text-[#9b869c]" />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5 rounded-full bg-white border border-[#e0d8cc] px-4 py-[10px] shadow-[0_1px_3px_rgba(74,64,54,0.06)]">
          <Search size={15} className="flex-shrink-0 text-[#9b869c]" />
          <input
            type="text"
            placeholder="Search files..."
            className="flex-1 bg-transparent text-sm text-[#4a4036] placeholder:text-[#b0a396] outline-none"
          />
        </div>
      </div>

      {/* ── BROWSE BY TYPE ── */}
      <section className="mt-1">
        <div className="px-5 mb-3">
          <span className="text-[15px] font-bold text-[#4a4036]">Browse by Type</span>
        </div>
        <div className="flex gap-2 px-5 overflow-x-auto scrollbar-hide pb-0.5">
          {TYPE_CHIPS.map((chip) => {
            const isActive = activeChip === chip;
            return (
              <button
                key={chip}
                onClick={() => setActiveChip(chip)}
                className={`flex-shrink-0 rounded-full px-4 py-[7px] text-[13px] font-medium border transition-all ${
                  isActive
                    ? "bg-[#9b869c] text-white border-transparent shadow-sm"
                    : "bg-white text-[#4a4036] border-[#e0d8cc]"
                }`}
              >
                {chip}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── MY FOLDERS (preview) ── */}
      <section className="mt-6 px-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[15px] font-bold text-[#4a4036]">My Folders</span>
          {hasMoreFolders && (
            <button
              onClick={() => onNavigate("folders")}
              className="flex items-center gap-0.5 text-[13px] font-medium text-[#9b869c]"
            >
              Show more
              <ChevronRight size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>

        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#b0a396]">
          Yours
        </p>
        <div className="grid grid-cols-2 gap-3">
          {foldersLoading
            ? Array.from({ length: 2 }).map((_, i) => <FolderSkeleton key={i} />)
            : previewUserFolders.length === 0
            ? <p className="col-span-2 py-3 text-[13px] text-[#b0a396]">No folders yet — create one in Folders tab.</p>
            : previewUserFolders.map((folder, i) => (
                <FolderCard key={folder.id} folder={folder} index={i} />
              ))
          }
        </div>

        {(foldersLoading || previewAiFolders.length > 0) && (
          <>
            <div className="mt-4 mb-2.5 flex items-center gap-1.5">
              <Sparkles size={11} className="text-[#9b869c]" />
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9b869c]">
                Organized by AI
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {foldersLoading
                ? Array.from({ length: 2 }).map((_, i) => <FolderSkeleton key={i} />)
                : previewAiFolders.map((folder, i) => (
                    <FolderCard key={folder.id} folder={folder} index={i} />
                  ))
              }
            </div>
          </>
        )}
      </section>

      {/* ── RECENT ── */}
      <section className="mt-6">
        <div className="flex items-center justify-between px-5 mb-3">
          <span className="text-[15px] font-bold text-[#4a4036]">Recent</span>
          <button className="text-[13px] font-medium text-[#9b869c]">See all</button>
        </div>

        <div className="flex gap-3 px-5 overflow-x-auto scrollbar-hide pb-1">
          {filesLoading
            ? Array.from({ length: 4 }).map((_, i) => <RecentSkeleton key={i} />)
            : recentFiles.length === 0
            ? <EmptyRecent />
            : recentFiles.map((file, i) => {
                const type = getFileIcon(file.mimeType) as FileType;
                const cfg  = FILE_TYPE_CONFIG[type] ?? FILE_TYPE_CONFIG.archive;
                const Icon = cfg.icon;
                const isImage = type === "image";
                return (
                  <button
                    key={file.id}
                    onClick={() => setSelectedFile(file)}
                    className="card-enter flex-shrink-0 flex flex-col justify-between w-[120px] h-[140px] rounded-2xl bg-white border border-[#e0d8cc] p-3 shadow-[0_1px_3px_rgba(74,64,54,0.07)] text-left active:scale-95 transition-transform"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    {isImage ? (
                      <img
                        src={file.url}
                        alt={file.name}
                        className="h-9 w-9 rounded-xl object-cover"
                      />
                    ) : (
                      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${cfg.bg}`}>
                        <Icon size={16} className={cfg.color} />
                      </div>
                    )}
                    <div>
                      <p className="text-[13px] font-semibold leading-snug text-[#4a4036] line-clamp-2">
                        {file.name}
                      </p>
                      <p className="mt-1 text-[11px] text-[#b0a396]">
                        {timeAgo(file.createdAt)}
                      </p>
                    </div>
                  </button>
                );
              })
          }
        </div>
      </section>

      <div className="h-6" />

      {/* ── FILE DETAIL SHEET ── */}
      {selectedFile && (
        <FileDetailSheet
          file={selectedFile}
          folders={folders}
          currentFolderId={null}
          onClose={() => setSelectedFile(null)}
          onOpenLightbox={() => setLightboxFile(selectedFile)}
          onDeleted={() => { setSelectedFile(null); onRefresh(); }}
          onMoved={() => { setSelectedFile(null); onRefresh(); }}
        />
      )}

      {/* ── IMAGE LIGHTBOX ── */}
      {lightboxFile && (
        <ImageLightbox
          src={lightboxFile.url}
          name={lightboxFile.name}
          onClose={() => setLightboxFile(null)}
        />
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RecentSkeleton() {
  return (
    <div className="flex-shrink-0 w-[120px] h-[140px] rounded-2xl bg-white border border-[#e0d8cc] p-3 animate-pulse">
      <div className="h-9 w-9 rounded-xl bg-[#e0d8cc]/60" />
      <div className="mt-auto pt-8 space-y-1.5">
        <div className="h-3 w-4/5 rounded bg-[#e0d8cc]/60" />
        <div className="h-3 w-3/5 rounded bg-[#e0d8cc]/60" />
        <div className="h-2.5 w-2/5 rounded bg-[#e0d8cc]/60" />
      </div>
    </div>
  );
}

function FolderSkeleton() {
  return (
    <div className="rounded-2xl border border-[#e0d8cc] bg-white p-4 animate-pulse">
      <div className="mb-3 h-10 w-10 rounded-xl bg-[#e0d8cc]/60" />
      <div className="h-3.5 w-3/4 rounded bg-[#e0d8cc]/60" />
      <div className="mt-2 h-2.5 w-1/2 rounded bg-[#e0d8cc]/60" />
    </div>
  );
}

function EmptyRecent() {
  return (
    <div className="flex h-[140px] w-full items-center justify-center">
      <p className="text-[13px] text-[#b0a396]">No files yet — upload one!</p>
    </div>
  );
}
