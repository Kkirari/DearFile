"use client";

import { useState } from "react";
import {
  X, Download, Trash2, Eye, FolderInput,
  FileText, Film, Music, Archive, Image as ImageIcon, File,
} from "lucide-react";
import { FolderPickerSheet } from "@/components/folder-picker-sheet";
import { formatBytes, formatDate, getFileIcon } from "@/lib/utils";
import type { FileItem } from "@/types/file";
import type { FolderItem } from "@/types/folder";

// ── Type config ───────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  image:   { icon: ImageIcon, bg: "bg-blue-50",    color: "text-blue-500"    },
  video:   { icon: Film,      bg: "bg-violet-50",  color: "text-violet-500"  },
  audio:   { icon: Music,     bg: "bg-pink-50",    color: "text-pink-500"    },
  pdf:     { icon: FileText,  bg: "bg-red-50",     color: "text-red-500"     },
  doc:     { icon: FileText,  bg: "bg-emerald-50", color: "text-emerald-600" },
  sheet:   { icon: FileText,  bg: "bg-green-50",   color: "text-green-600"   },
  archive: { icon: Archive,   bg: "bg-amber-50",   color: "text-amber-500"   },
  file:    { icon: File,      bg: "bg-[#f4f3ee]",  color: "text-[#9b869c]"   },
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface FileDetailSheetProps {
  file: FileItem;
  folders: FolderItem[];
  currentFolderId?: string | null;
  onClose: () => void;
  onOpenLightbox: () => void;
  onDeleted: () => void;
  onMoved?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FileDetailSheet({
  file, folders, currentFolderId = null,
  onClose, onOpenLightbox, onDeleted, onMoved,
}: FileDetailSheetProps) {
  const [isClosing, setIsClosing]         = useState(false);
  const [deleting, setDeleting]           = useState(false);
  const [moving, setMoving]               = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [movePickerOpen, setMovePickerOpen] = useState(false);

  const type = getFileIcon(file.mimeType) as keyof typeof TYPE_CONFIG;
  const cfg  = TYPE_CONFIG[type] ?? TYPE_CONFIG.file;
  const Icon = cfg.icon;

  const canPreview = ["image", "video", "pdf"].includes(type);

  function close() {
    setIsClosing(true);
    setTimeout(() => { setIsClosing(false); onClose(); }, 260);
  }

  function handlePreview() {
    if (type === "image") {
      close();
      setTimeout(onOpenLightbox, 120);
    } else {
      window.open(file.url, "_blank");
    }
  }

  function handleDownload() {
    const a = document.createElement("a");
    a.href     = file.url;
    a.download = file.name;
    a.target   = "_blank";
    a.click();
  }

  async function handleMove(targetFolderId: string | null) {
    setMovePickerOpen(false);
    setMoving(true);
    try {
      const res = await fetch("/api/files/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: file.id, targetFolderId }),
      });
      if (!res.ok) throw new Error("Move failed");
      close();
      setTimeout(() => onMoved?.(), 300);
    } catch {
      setMoving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    setDeleting(true);
    try {
      await fetch("/api/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: file.id }),
      });
      close();
      setTimeout(onDeleted, 300);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (movePickerOpen) {
    return (
      <FolderPickerSheet
        folders={folders}
        title="Move to Folder"
        currentFolderId={currentFolderId}
        onSelect={handleMove}
        onClose={() => setMovePickerOpen(false)}
      />
    );
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-[70] bg-black/25 ${isClosing ? "backdrop-exit" : "backdrop-enter"}`}
        onClick={close}
      />
      <div
        className={`fixed bottom-0 left-0 right-0 z-[70] rounded-t-[28px] bg-white px-5 pt-4 pb-[calc(32px+env(safe-area-inset-bottom,0px))] shadow-2xl ${isClosing ? "sheet-exit" : "sheet-enter"}`}
      >
        <div className="mx-auto mb-5 h-[5px] w-10 rounded-full bg-[#e0d8cc]" />

        {/* File info row */}
        <div className="flex items-center gap-4 mb-6">
          <div className={`flex-shrink-0 h-14 w-14 rounded-2xl overflow-hidden ${type !== "image" ? cfg.bg + " flex items-center justify-center" : ""}`}>
            {type === "image" ? (
              <img src={file.url} alt={file.name} className="h-14 w-14 object-cover" />
            ) : (
              <Icon size={26} className={cfg.color} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold text-[#4a4036] leading-snug break-all line-clamp-2">
              {file.name}
            </p>
            <p className="mt-1 text-[12px] text-[#b0a396]">
              {formatBytes(file.size)} · {formatDate(file.createdAt)}
            </p>
          </div>
          <button
            onClick={close}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#f4f3ee] text-[#b0a396] transition-colors active:bg-[#e0d8cc]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2.5">
          {canPreview && (
            <ActionRow
              icon={<Eye size={19} />}
              label={type === "image" ? "View Image" : type === "video" ? "Play Video" : "Open PDF"}
              bg="bg-[#9b869c]"
              textColor="text-white"
              onClick={handlePreview}
            />
          )}
          <ActionRow
            icon={<FolderInput size={19} />}
            label={moving ? "Moving…" : "Move to Folder"}
            bg="bg-[#f4f3ee]"
            textColor="text-[#4a4036]"
            onClick={() => setMovePickerOpen(true)}
            disabled={moving}
          />
          <ActionRow
            icon={<Download size={19} />}
            label="Download"
            bg="bg-[#f4f3ee]"
            textColor="text-[#4a4036]"
            onClick={handleDownload}
          />
          <ActionRow
            icon={<Trash2 size={19} />}
            label={confirmDelete ? "Tap again to confirm delete" : deleting ? "Deleting…" : "Delete"}
            bg={confirmDelete ? "bg-red-500" : "bg-red-50"}
            textColor={confirmDelete ? "text-white" : "text-red-500"}
            onClick={handleDelete}
            disabled={deleting}
          />
        </div>
      </div>
    </>
  );
}

// ── Action row ────────────────────────────────────────────────────────────────

function ActionRow({
  icon, label, bg, textColor, onClick, disabled,
}: {
  icon: React.ReactNode;
  label: string;
  bg: string;
  textColor: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-[14px] font-semibold transition-all active:scale-[0.98] disabled:opacity-50 ${bg} ${textColor}`}
    >
      {icon}
      {label}
    </button>
  );
}
