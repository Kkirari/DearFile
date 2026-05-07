"use client";

import { useState } from "react";
import {
  ChevronLeft, FolderOpen, Inbox,
  FileText, Film, Music, Archive, Image as ImageIcon, File,
} from "lucide-react";
import { useFiles } from "@/hooks/use-files";
import { FileDetailSheet } from "@/components/file-detail-sheet";
import { ImageLightbox } from "@/components/image-lightbox";
import { formatBytes, getFileIcon } from "@/lib/utils";
import type { FolderItem } from "@/types/folder";
import type { FileItem } from "@/types/file";

// ── Type config ───────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  image:   { icon: ImageIcon, bg: "bg-blue-50 dark:bg-blue-950/40",      color: "text-blue-500"    },
  video:   { icon: Film,      bg: "bg-violet-50 dark:bg-violet-950/40",  color: "text-violet-500"  },
  audio:   { icon: Music,     bg: "bg-pink-50 dark:bg-pink-950/40",      color: "text-pink-500"    },
  pdf:     { icon: FileText,  bg: "bg-red-50 dark:bg-red-950/40",        color: "text-red-500"     },
  doc:     { icon: FileText,  bg: "bg-emerald-50 dark:bg-emerald-950/40",color: "text-emerald-500" },
  sheet:   { icon: FileText,  bg: "bg-green-50 dark:bg-green-950/40",    color: "text-green-500"   },
  archive: { icon: Archive,   bg: "bg-amber-50 dark:bg-amber-950/40",    color: "text-amber-500"   },
  file:    { icon: File,      bg: "bg-[#f4f3ee] dark:bg-[#2a2724]",      color: "text-[#9b869c]"   },
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface FolderViewerProps {
  folder: FolderItem | "inbox";
  folders: FolderItem[];
  onBack: () => void;
  onFolderRefresh: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FolderViewer({ folder, folders, onBack, onFolderRefresh }: FolderViewerProps) {
  const isInbox    = folder === "inbox";
  const folderId   = isInbox ? null : folder.id;
  const folderName = isInbox ? "Inbox" : folder.name;

  const { files, loading, refresh } = useFiles(folderId);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [lightboxFile, setLightboxFile] = useState<FileItem | null>(null);

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

  return (
    <div className="flex flex-col min-h-dvh bg-[#f4f3ee] dark:bg-[#1c1a18]">

      {/* ── HEADER ── */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-4 bg-[#f4f3ee] dark:bg-[#1c1a18]">
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] shadow-sm active:scale-95 transition-transform"
        >
          <ChevronLeft size={18} className="text-[#4a4036] dark:text-[#e8ddd4]" strokeWidth={2.5} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-[20px] font-bold leading-tight text-[#4a4036] dark:text-[#e8ddd4] truncate">
            {folderName}
          </h2>
          {!loading && (
            <p className="text-[12px] text-[#b0a396] dark:text-[#6e6460]">
              {files.length} {files.length === 1 ? "file" : "files"}
            </p>
          )}
        </div>
        {isInbox && (
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#9b869c]/10">
            <Inbox size={18} className="text-[#9b869c]" />
          </div>
        )}
      </div>

      {/* ── FILE LIST ── */}
      <div className="flex-1 overflow-y-auto pb-[76px] px-4">
        {loading ? (
          <div className="flex flex-col gap-2.5 pt-2">
            {Array.from({ length: 5 }).map((_, i) => <FileSkeleton key={i} />)}
          </div>
        ) : files.length === 0 ? (
          <EmptyViewer isInbox={isInbox} folderName={folderName} />
        ) : (
          <div className="flex flex-col gap-2 pt-2">
            {files.map((file, i) => {
              const type = getFileIcon(file.mimeType) as keyof typeof TYPE_CONFIG;
              const cfg  = TYPE_CONFIG[type] ?? TYPE_CONFIG.file;
              const Icon = cfg.icon;
              const isImage = type === "image";

              return (
                <button
                  key={file.id}
                  onClick={() => setSelectedFile(file)}
                  className="card-enter flex items-center gap-3.5 w-full bg-white dark:bg-[#252220] rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] px-4 py-3.5 text-left shadow-[0_1px_3px_rgba(74,64,54,0.06)] active:scale-[0.98] transition-transform"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  {isImage ? (
                    <img
                      src={file.url}
                      alt={file.name}
                      className="h-10 w-10 flex-shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${cfg.bg}`}>
                      <Icon size={18} className={cfg.color} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-[#4a4036] dark:text-[#e8ddd4] truncate">{file.name}</p>
                    <p className="text-[12px] text-[#b0a396] dark:text-[#6e6460] mt-0.5">
                      {formatBytes(file.size)} · {timeAgo(file.createdAt)}
                    </p>
                  </div>
                  <ChevronLeft size={14} className="flex-shrink-0 text-[#b0a396] dark:text-[#6e6460] rotate-180" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── SHEETS ── */}
      {selectedFile && (
        <FileDetailSheet
          file={selectedFile}
          folders={folders}
          currentFolderId={folderId}
          onClose={() => setSelectedFile(null)}
          onOpenLightbox={() => setLightboxFile(selectedFile)}
          onDeleted={() => { setSelectedFile(null); refresh(); onFolderRefresh(); }}
          onMoved={() => { setSelectedFile(null); refresh(); onFolderRefresh(); }}
        />
      )}
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

// ── Sub-components ────────────────────────────────────────────────────────────

function FileSkeleton() {
  return (
    <div className="flex items-center gap-3.5 bg-white dark:bg-[#252220] rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] px-4 py-3.5 animate-pulse">
      <div className="h-10 w-10 flex-shrink-0 rounded-xl bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-3/4 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
        <div className="h-2.5 w-1/2 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
      </div>
    </div>
  );
}

function EmptyViewer({ isInbox, folderName }: { isInbox: boolean; folderName: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#9b869c]/10">
        {isInbox
          ? <Inbox size={28} className="text-[#9b869c]" />
          : <FolderOpen size={28} className="text-[#9b869c]" />
        }
      </div>
      <div className="text-center">
        <p className="text-[15px] font-semibold text-[#4a4036] dark:text-[#e8ddd4]">
          {isInbox ? "Inbox is empty" : `${folderName} is empty`}
        </p>
        <p className="mt-1 text-[13px] text-[#b0a396] dark:text-[#6e6460]">
          {isInbox ? "Uploaded files land here by default" : "Upload a file and choose this folder"}
        </p>
      </div>
    </div>
  );
}
