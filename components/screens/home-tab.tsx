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
  Inbox,
} from "lucide-react";
import { FolderCard } from "@/components/folder-card";
import { FileDetailSheet } from "@/components/file-detail-sheet";
import { ImageLightbox } from "@/components/image-lightbox";
import { FolderViewer } from "@/components/screens/folder-viewer";
import { useFolderPreviews } from "@/hooks/use-folder-previews";
import { trackVisit } from "@/lib/folder-prefs";
import { getFileIcon } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";
import type { FileItem } from "@/types/file";
import type { FolderItem } from "@/types/folder";
import type { FileType } from "@/lib/mock-data";

// ── File type icon/color config ───────────────────────────────────────────────

const FILE_TYPE_CONFIG: Record<FileType, { icon: React.ElementType; bg: string; color: string }> = {
  pdf: { icon: FileText, bg: "bg-red-50 dark:bg-red-950/40", color: "text-red-500" },
  image: { icon: ImageIcon, bg: "bg-blue-50 dark:bg-blue-950/40", color: "text-blue-500" },
  doc: { icon: FileText, bg: "bg-emerald-50 dark:bg-emerald-950/40", color: "text-emerald-500" },
  video: { icon: Film, bg: "bg-violet-50 dark:bg-violet-950/40", color: "text-violet-500" },
  audio: { icon: Music, bg: "bg-pink-50 dark:bg-pink-950/40", color: "text-pink-500" },
  archive: { icon: Archive, bg: "bg-amber-50 dark:bg-amber-950/40", color: "text-amber-500" },
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
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [lightboxFile, setLightboxFile] = useState<FileItem | null>(null);
  const [viewingFolder, setViewingFolder] = useState<FolderItem | "inbox" | null>(null);
  const { tr } = useLanguage();

  const userFolders = folders.filter((f) => f.owner === "user");
  const aiFolders = folders.filter((f) => f.owner === "ai");
  const previewUserFolders = userFolders.slice(0, HOME_FOLDER_LIMIT);
  const previewAiFolders = aiFolders.slice(0, HOME_FOLDER_LIMIT);
  const hasMoreFolders = userFolders.length > HOME_FOLDER_LIMIT || aiFolders.length > HOME_FOLDER_LIMIT;

  const recentFiles  = files.slice(0, RECENT_LIMIT);
  // Per-user layout: keys are users/{userId}/uploads/... so match the
  // segment, not a startsWith.
  const unsortedCount = files.filter((f) => f.id.includes("/uploads/")).length;

  // Folder cover previews (batched fetch)
  const { previews } = useFolderPreviews(folders.length);

  function openFolder(f: FolderItem | "inbox") {
    if (f !== "inbox") trackVisit(f.id);
    setViewingFolder(f);
  }

  // Show folder viewer if user clicked on a folder
  if (viewingFolder) {
    return (
      <FolderViewer
        folder={viewingFolder}
        folders={folders}
        onBack={() => setViewingFolder(null)}
        onFolderRefresh={onRefresh}
      />
    );
  }

  return (
    <div className="overflow-y-auto pb-[76px]">

      {/* ── HEADER ── */}
      <div className="bg-[#f4f3ee] dark:bg-[#1c1a18] px-5 pt-14 pb-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Image
              src="/icon/icon.png"
              alt="DearFile"
              width={30}
              height={30}
              priority
              className="h-9 w-9 rounded-lg shadow-[0_2px_8px_rgba(155,134,156,0.3)]"
            />
            <h1 className="text-[26px] font-bold leading-none tracking-tight text-[#4a4036] dark:text-[#e8ddd4]">
              DearFile.
            </h1>
          </div>
          <div className="h-9 w-9 overflow-hidden rounded-full border border-[#e0d8cc] dark:border-[#3a3430] bg-[#9b869c]/15 flex items-center justify-center">
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

        <button
          onClick={() => onNavigate("search")}
          className="flex w-full items-center gap-2.5 rounded-full bg-[#fbfaf6] dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] px-4 py-[10px] shadow-[0_1px_3px_rgba(74,64,54,0.06)] text-left active:scale-[0.98] transition-transform"
        >
          <Search size={15} className="flex-shrink-0 text-[#9b869c]" />
          <span className="flex-1 text-sm text-[#b0a396] dark:text-[#6e6460] select-none">
            {tr.searchPlaceholder}
          </span>
        </button>
      </div>

      {/* ── MY FOLDERS (preview) ── */}
      <section className="mt-2 px-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[15px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.myFolders}</span>
          {hasMoreFolders && (
            <button
              onClick={() => onNavigate("folders")}
              className="flex items-center gap-0.5 text-[13px] font-medium text-[#9b869c]"
            >
              {tr.showMore}
              <ChevronRight size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>

        {/* Inbox / Unsorted — promoted hero card, always visible */}
        <button
          onClick={() => openFolder("inbox")}
          className="card-enter relative mb-4 w-full flex items-center gap-4 rounded-2xl border border-[#9b869c]/20 dark:border-[#9b869c]/30 bg-gradient-to-br from-[#9b869c]/[0.09] via-[#fbfaf6] to-[#9b869c]/[0.04] dark:from-[#9b869c]/15 dark:via-[#252220] dark:to-[#9b869c]/[0.08] px-4 py-4 text-left active:scale-[0.98] transition-transform"
        >
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#9b869c] shadow-[0_4px_12px_rgba(155,134,156,0.28)]">
            <Inbox size={22} className="text-white" strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-[#4a4036] dark:text-[#e8ddd4] leading-tight">
              {tr.unsortedInbox}
            </p>
            <p className="text-[12px] text-[#b0a396] dark:text-[#6e6460] mt-0.5">
              {filesLoading
                ? "Loading…"
                : unsortedCount === 0
                  ? tr.unsortedFiles
                  : `${unsortedCount} ${tr.unsortedFiles}`}
            </p>
          </div>
          {!filesLoading && unsortedCount > 0 && (
            <span className="rounded-full bg-[#9b869c] text-white text-[12px] font-bold px-2.5 py-1 leading-none min-w-[26px] text-center">
              {unsortedCount > 99 ? "99+" : unsortedCount}
            </span>
          )}
        </button>

        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">
          {tr.yours}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {foldersLoading
            ? Array.from({ length: 2 }).map((_, i) => <FolderSkeleton key={i} />)
            : previewUserFolders.length === 0
              ? <p className="col-span-2 py-3 text-[13px] text-[#b0a396] dark:text-[#6e6460]">{tr.noFolders}</p>
              : previewUserFolders.map((folder, i) => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  index={i}
                  preview={previews[folder.id]}
                  onClick={() => openFolder(folder)}
                />
              ))
          }
        </div>

        {(foldersLoading || previewAiFolders.length > 0) && (
          <>
            <div className="mt-4 mb-2.5 flex items-center gap-1.5">
              <Sparkles size={11} className="text-[#d99c5b]" />
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#d99c5b]">
                {tr.organizedByAi}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {foldersLoading
                ? Array.from({ length: 2 }).map((_, i) => <FolderSkeleton key={i} />)
                : previewAiFolders.map((folder, i) => (
                  <FolderCard
                    key={folder.id}
                    folder={folder}
                    index={i}
                    preview={previews[folder.id]}
                    onClick={() => openFolder(folder)}
                  />
                ))
              }
            </div>
          </>
        )}
      </section>

      {/* ── RECENT ── */}
      <section className="mt-6">
        <div className="px-5 mb-3">
          <span className="text-[15px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.recent}</span>
        </div>

        <div className="flex gap-3 px-5 overflow-x-auto scrollbar-hide pb-1">
          {filesLoading
            ? Array.from({ length: 4 }).map((_, i) => <RecentSkeleton key={i} />)
            : recentFiles.length === 0
              ? <EmptyRecent label={tr.noFiles} />
              : recentFiles.map((file, i) => {
                const type = getFileIcon(file.mimeType) as FileType;
                const cfg = FILE_TYPE_CONFIG[type] ?? FILE_TYPE_CONFIG.archive;
                const Icon = cfg.icon;
                const isImage = type === "image";
                return (
                  <button
                    key={file.id}
                    onClick={() => setSelectedFile(file)}
                    className="card-enter flex-shrink-0 flex flex-col justify-between w-[120px] h-[140px] rounded-2xl bg-[#fbfaf6] dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] p-3 shadow-[0_1px_3px_rgba(74,64,54,0.07)] text-left active:scale-95 transition-transform"
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
                      <p className="text-[13px] font-semibold leading-snug text-[#4a4036] dark:text-[#e8ddd4] line-clamp-2">
                        {file.name}
                      </p>
                      <p className="mt-1 text-[11px] text-[#b0a396] dark:text-[#6e6460]">
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
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RecentSkeleton() {
  return (
    <div className="flex-shrink-0 w-[120px] h-[140px] rounded-2xl bg-[#fbfaf6] dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] p-3 animate-pulse">
      <div className="h-9 w-9 rounded-xl bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
      <div className="mt-auto pt-8 space-y-1.5">
        <div className="h-3 w-4/5 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
        <div className="h-3 w-3/5 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
        <div className="h-2.5 w-2/5 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
      </div>
    </div>
  );
}

function FolderSkeleton() {
  return (
    <div className="rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] overflow-hidden animate-pulse">
      <div className="aspect-[5/3] bg-[#e0d8cc]/40 dark:bg-[#3a3430]/40" />
      <div className="px-3 py-2.5 space-y-1.5">
        <div className="h-3 w-3/4 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
        <div className="h-2.5 w-1/2 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
      </div>
    </div>
  );
}

function EmptyRecent({ label }: { label: string }) {
  return (
    <div className="flex h-[140px] w-full items-center justify-center">
      <p className="text-[13px] text-[#b0a396] dark:text-[#6e6460]">{label}</p>
    </div>
  );
}
