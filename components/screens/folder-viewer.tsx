"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronLeft, FolderOpen, Inbox, X, Check,
  FileText, Film, Music, Archive, Image as ImageIcon, File,
  List, LayoutGrid, CheckSquare, Trash2, Download, FolderInput,
  AlertTriangle, Share2,
} from "lucide-react";
import { useFiles } from "@/hooks/use-files";
import { FileDetailSheet } from "@/components/file-detail-sheet";
import { ImageLightbox } from "@/components/image-lightbox";
import { FolderPickerSheet } from "@/components/folder-picker-sheet";
import { ShareSheet } from "@/components/share-sheet";
import { formatBytes, getFileIcon } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";
import type { FolderItem } from "@/types/folder";
import type { FileItem } from "@/types/file";
import { apiFetch } from "@/lib/api-client";

type ViewMode  = "list" | "grid";
type BatchOp   = "delete" | "move" | "download" | null;
const LONG_PRESS_MS = 450;

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
  const { tr } = useLanguage();
  const isInbox    = folder === "inbox";
  const folderId   = isInbox ? null : folder.id;
  const folderName = isInbox ? "Inbox" : folder.name;

  const { files, loading, refresh } = useFiles(folderId);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [lightboxFile, setLightboxFile] = useState<FileItem | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // ── Multi-select state ────────────────────────────────────────────────
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [shareOpen, setShareOpen]         = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [batchOp, setBatchOp]             = useState<BatchOp>(null);
  const [batchError, setBatchError]       = useState<string | null>(null);

  // Long-press tracking
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  // Load saved view preference from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("folderViewMode") as ViewMode | null;
    if (saved === "list" || saved === "grid") setViewMode(saved);
  }, []);

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem("folderViewMode", mode);
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

  // ── Selection helpers ─────────────────────────────────────────────────

  const enterSelection = useCallback((firstId?: string) => {
    setSelectionMode(true);
    setSelectedIds(firstId ? new Set([firstId]) : new Set());
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setBatchOp(null);
    setBatchError(null);
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = files.length > 0 && selectedIds.size === files.length;
  const handleSelectAll = useCallback(() => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(files.map((f) => f.id)));
  }, [allSelected, files]);

  // ── Long-press handlers ───────────────────────────────────────────────

  function handlePressStart(fileId: string) {
    if (selectionMode) return;
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      enterSelection(fileId);
      // haptic feedback if available
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { navigator.vibrate?.(35); } catch { /* ignore */ }
      }
    }, LONG_PRESS_MS);
  }

  function handlePressEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handleCardClick(file: FileItem) {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (selectionMode) {
      toggleSelected(file.id);
    } else {
      setSelectedFile(file);
    }
  }

  // ── Batch actions ─────────────────────────────────────────────────────

  async function handleBatchDelete() {
    setConfirmDeleteOpen(false);
    setBatchOp("delete");
    setBatchError(null);
    try {
      const keys = Array.from(selectedIds);
      const res  = await apiFetch("/api/files/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", keys }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Delete failed");
      exitSelection();
      refresh();
      onFolderRefresh();
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : "Delete failed");
      setBatchOp(null);
    }
  }

  async function handleBatchMove(targetFolderId: string | null) {
    setMovePickerOpen(false);
    setBatchOp("move");
    setBatchError(null);
    try {
      const keys = Array.from(selectedIds);
      const res  = await apiFetch("/api/files/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", keys, targetFolderId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Move failed");
      exitSelection();
      refresh();
      onFolderRefresh();
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : "Move failed");
      setBatchOp(null);
    }
  }

  async function handleBatchDownload() {
    setBatchOp("download");
    try {
      const selectedFiles = files.filter((f) => selectedIds.has(f.id));
      // Trigger downloads sequentially with a slight delay to avoid browser blocking
      for (const file of selectedFiles) {
        const a = document.createElement("a");
        a.href     = file.url;
        a.download = file.name;
        a.target   = "_blank";
        a.rel      = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        await new Promise((r) => setTimeout(r, 220));
      }
      exitSelection();
    } catch {
      setBatchError("Download failed");
      setBatchOp(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-dvh bg-[#f4f3ee] dark:bg-[#1c1a18]">

      {/* ── HEADER ── */}
      {selectionMode ? (
        // ── Selection header ──
        <div className="flex items-center gap-3 px-4 pt-12 pb-4 bg-[#9b869c] text-white">
          <button
            onClick={exitSelection}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 active:bg-white/30 transition-colors"
            aria-label={tr.cancel}
          >
            <X size={18} strokeWidth={2.5} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[16px] font-bold leading-tight">
              {selectedIds.size} {tr.selectedCount}
            </p>
          </div>
          <button
            onClick={handleSelectAll}
            className="text-[12px] font-semibold rounded-full bg-white/20 px-3 py-1.5 active:bg-white/30 transition-colors"
          >
            {allSelected ? tr.deselectAll : tr.selectAll}
          </button>
        </div>
      ) : (
        // ── Normal header ──
        <div className="flex items-center gap-3 px-4 pt-12 pb-4 bg-[#f4f3ee] dark:bg-[#1c1a18]">
          <button
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#fbfaf6] dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] shadow-sm active:scale-95 transition-transform"
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

          {/* Select toggle */}
          {files.length > 0 && (
            <button
              onClick={() => enterSelection()}
              aria-label={tr.selectFiles}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#fbfaf6] dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] shadow-sm text-[#9b869c] active:scale-95 transition-transform"
            >
              <CheckSquare size={15} />
            </button>
          )}

          {/* View mode toggle */}
          {files.length > 0 && (
            <div className="flex items-center gap-0.5 rounded-full border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] p-0.5 shadow-sm">
              <button
                onClick={() => changeViewMode("list")}
                aria-label="List view"
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                  viewMode === "list"
                    ? "bg-[#9b869c] text-white shadow-sm"
                    : "text-[#b0a396] dark:text-[#6e6460] active:bg-[#f4f3ee] dark:active:bg-[#2a2724]"
                }`}
              >
                <List size={15} strokeWidth={viewMode === "list" ? 2.5 : 2} />
              </button>
              <button
                onClick={() => changeViewMode("grid")}
                aria-label="Grid view"
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                  viewMode === "grid"
                    ? "bg-[#9b869c] text-white shadow-sm"
                    : "text-[#b0a396] dark:text-[#6e6460] active:bg-[#f4f3ee] dark:active:bg-[#2a2724]"
                }`}
              >
                <LayoutGrid size={14} strokeWidth={viewMode === "grid" ? 2.5 : 2} />
              </button>
            </div>
          )}

          {isInbox && files.length === 0 && (
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#9b869c]/10">
              <Inbox size={18} className="text-[#9b869c]" />
            </div>
          )}
        </div>
      )}

      {/* ── FILE LIST/GRID ── */}
      <div className={`flex-1 overflow-y-auto px-4 ${selectionMode ? "pb-[140px]" : "pb-[76px]"}`}>
        {loading ? (
          viewMode === "list" ? (
            <div className="flex flex-col gap-2.5 pt-2">
              {Array.from({ length: 5 }).map((_, i) => <FileSkeleton key={i} />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 pt-2">
              {Array.from({ length: 4 }).map((_, i) => <FileGridSkeleton key={i} />)}
            </div>
          )
        ) : files.length === 0 ? (
          <EmptyViewer isInbox={isInbox} folderName={folderName} />
        ) : viewMode === "list" ? (
          // ── LIST VIEW ──
          <div className="flex flex-col gap-2 pt-2">
            {files.map((file, i) => {
              const type = getFileIcon(file.mimeType) as keyof typeof TYPE_CONFIG;
              const cfg  = TYPE_CONFIG[type] ?? TYPE_CONFIG.file;
              const Icon = cfg.icon;
              const isImage = type === "image";
              const isSelected = selectedIds.has(file.id);

              return (
                <button
                  key={file.id}
                  onClick={() => handleCardClick(file)}
                  onPointerDown={() => handlePressStart(file.id)}
                  onPointerUp={handlePressEnd}
                  onPointerLeave={handlePressEnd}
                  onPointerCancel={handlePressEnd}
                  onContextMenu={(e) => { e.preventDefault(); if (!selectionMode) enterSelection(file.id); }}
                  className={`card-enter flex items-center gap-3.5 w-full bg-[#fbfaf6] dark:bg-[#252220] rounded-2xl border px-4 py-3.5 text-left shadow-[0_1px_3px_rgba(74,64,54,0.06)] active:scale-[0.98] transition-all ${
                    isSelected
                      ? "border-[#9b869c] bg-[#9b869c]/5 dark:bg-[#9b869c]/10"
                      : "border-[#e0d8cc] dark:border-[#3a3430]"
                  }`}
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  {/* Checkbox or icon */}
                  {selectionMode ? (
                    <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                      isSelected
                        ? "bg-[#9b869c] border-[#9b869c]"
                        : "border-[#b0a396] dark:border-[#6e6460]"
                    }`}>
                      {isSelected && <Check size={13} strokeWidth={3} className="text-white" />}
                    </div>
                  ) : null}

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
                  {!selectionMode && (
                    <ChevronLeft size={14} className="flex-shrink-0 text-[#b0a396] dark:text-[#6e6460] rotate-180" />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          // ── GRID VIEW (uniform 1:1 cards with overlay label) ──
          <div className="grid grid-cols-2 gap-3 pt-2">
            {files.map((file, i) => {
              const type = getFileIcon(file.mimeType) as keyof typeof TYPE_CONFIG;
              const cfg  = TYPE_CONFIG[type] ?? TYPE_CONFIG.file;
              const Icon = cfg.icon;
              const isImage = type === "image";
              const isSelected = selectedIds.has(file.id);

              return (
                <button
                  key={file.id}
                  onClick={() => handleCardClick(file)}
                  onPointerDown={() => handlePressStart(file.id)}
                  onPointerUp={handlePressEnd}
                  onPointerLeave={handlePressEnd}
                  onPointerCancel={handlePressEnd}
                  onContextMenu={(e) => { e.preventDefault(); if (!selectionMode) enterSelection(file.id); }}
                  className={`card-enter relative aspect-square w-full overflow-hidden rounded-2xl border bg-[#fbfaf6] dark:bg-[#252220] shadow-[0_1px_3px_rgba(74,64,54,0.06)] active:scale-[0.97] transition-all ${
                    isSelected
                      ? "border-[#9b869c] ring-2 ring-[#9b869c]/40"
                      : "border-[#e0d8cc] dark:border-[#3a3430]"
                  }`}
                  style={{ animationDelay: `${i * 35}ms` }}
                >
                  {/* Thumbnail */}
                  {isImage ? (
                    <img
                      src={file.url}
                      alt={file.name}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className={`absolute inset-0 flex items-center justify-center ${cfg.bg}`}>
                      <Icon size={56} className={cfg.color} strokeWidth={1.4} />
                    </div>
                  )}

                  {/* Selection checkbox (overlay) */}
                  {selectionMode && (
                    <div className={`absolute top-2 left-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all ${
                      isSelected
                        ? "bg-[#9b869c] border-[#9b869c]"
                        : "bg-white/85 backdrop-blur-sm border-white"
                    }`}>
                      {isSelected && <Check size={14} strokeWidth={3} className="text-white" />}
                    </div>
                  )}

                  {isImage && (
                    <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/75 via-black/35 to-transparent pointer-events-none" />
                  )}

                  <div className="absolute inset-x-0 bottom-0 px-3 py-2.5 text-left">
                    <p className={`text-[12.5px] font-semibold truncate leading-tight ${
                      isImage
                        ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
                        : "text-[#4a4036] dark:text-[#e8ddd4]"
                    }`}>
                      {file.name}
                    </p>
                    <p className={`text-[10.5px] mt-0.5 truncate ${
                      isImage
                        ? "text-white/85 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
                        : "text-[#b0a396] dark:text-[#6e6460]"
                    }`}>
                      {formatBytes(file.size)} · {timeAgo(file.createdAt)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── BATCH ACTION BAR (selection mode only — z-60 to cover bottom nav) ── */}
      {selectionMode && (
        <div className="fixed bottom-0 left-0 right-0 z-[60] bg-[#fbfaf6] dark:bg-[#252220] border-t border-[#e0d8cc] dark:border-[#3a3430] shadow-[0_-4px_16px_rgba(74,64,54,0.12)] sheet-enter">
          {batchError && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-[12px]">
              <AlertTriangle size={12} />
              {batchError}
            </div>
          )}
          <div className="flex items-center justify-around px-2 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
            <BatchButton
              icon={<Share2 size={18} />}
              label={tr.batchShare}
              disabled={selectedIds.size === 0 || batchOp !== null}
              onClick={() => setShareOpen(true)}
              variant="primary"
            />
            <BatchButton
              icon={<Download size={18} />}
              label={batchOp === "download" ? tr.downloading : tr.batchDownload}
              disabled={selectedIds.size === 0 || batchOp !== null}
              onClick={handleBatchDownload}
            />
            <BatchButton
              icon={<FolderInput size={18} />}
              label={batchOp === "move" ? tr.moving : tr.batchMove}
              disabled={selectedIds.size === 0 || batchOp !== null}
              onClick={() => setMovePickerOpen(true)}
            />
            <BatchButton
              icon={<Trash2 size={18} />}
              label={batchOp === "delete" ? tr.deleting : tr.batchDelete}
              disabled={selectedIds.size === 0 || batchOp !== null}
              onClick={() => setConfirmDeleteOpen(true)}
              variant="danger"
            />
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRMATION ── */}
      {confirmDeleteOpen && (
        <>
          <div
            className="fixed inset-0 z-[80] bg-black/35 backdrop-enter"
            onClick={() => setConfirmDeleteOpen(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-[80] rounded-t-[28px] bg-[#fbfaf6] dark:bg-[#252220] px-5 pt-4 pb-[calc(28px+env(safe-area-inset-bottom,0px))] shadow-2xl sheet-enter">
            <div className="mx-auto mb-4 h-[5px] w-10 rounded-full bg-[#e0d8cc] dark:bg-[#3a3430]" />
            <div className="flex flex-col items-center text-center mb-5">
              <div className="h-12 w-12 rounded-2xl bg-red-50 dark:bg-red-950/40 flex items-center justify-center mb-3">
                <Trash2 size={22} className="text-red-500" />
              </div>
              <h3 className="text-[17px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">
                {tr.confirmBatchDelete}
              </h3>
              <p className="mt-1 text-[13px] text-[#b0a396] dark:text-[#6e6460]">
                {selectedIds.size} {tr.selectedCount} · {tr.confirmBatchDeleteDesc}
              </p>
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => setConfirmDeleteOpen(false)}
                className="flex-1 rounded-2xl bg-[#f4f3ee] dark:bg-[#2a2724] py-3.5 text-[14px] font-semibold text-[#4a4036] dark:text-[#e8ddd4] active:scale-[0.98] transition-all"
              >
                {tr.cancel}
              </button>
              <button
                onClick={handleBatchDelete}
                className="flex-1 rounded-2xl bg-red-500 py-3.5 text-[14px] font-bold text-white active:scale-[0.98] active:bg-red-600 transition-all"
              >
                {tr.batchDelete}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── MOVE PICKER ── */}
      {movePickerOpen && (
        <FolderPickerSheet
          folders={folders}
          title={tr.batchMove}
          currentFolderId={folderId}
          onSelect={handleBatchMove}
          onClose={() => setMovePickerOpen(false)}
        />
      )}

      {/* ── BATCH SHARE SHEET ── */}
      {shareOpen && (
        <ShareSheet
          files={files.filter((f) => selectedIds.has(f.id))}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* ── SHEETS ── */}
      {selectedFile && !selectionMode && (
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

// ── Batch action button ────────────────────────────────────────────────────────

function BatchButton({
  icon, label, onClick, disabled, variant = "default",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger" | "primary";
}) {
  const colorClasses =
    variant === "danger"
      ? "text-red-500 active:bg-red-50 dark:active:bg-red-950/30"
      : variant === "primary"
      ? "text-[#06C755] active:bg-[#06C755]/10"
      : "text-[#4a4036] dark:text-[#e8ddd4] active:bg-[#f4f3ee] dark:active:bg-[#2a2724]";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-0.5 rounded-2xl px-4 py-1.5 active:scale-95 disabled:opacity-30 disabled:active:scale-100 transition-all ${colorClasses}`}
    >
      {icon}
      <span className="text-[10px] font-semibold">{label}</span>
    </button>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FileGridSkeleton() {
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#e0d8cc]/40 dark:bg-[#3a3430]/40 animate-pulse">
      <div className="absolute inset-x-0 bottom-0 px-3 py-2.5 space-y-1.5">
        <div className="h-3 w-4/5 rounded bg-[#e0d8cc]/80 dark:bg-[#3a3430]/80" />
        <div className="h-2.5 w-1/2 rounded bg-[#e0d8cc]/80 dark:bg-[#3a3430]/80" />
      </div>
    </div>
  );
}

function FileSkeleton() {
  return (
    <div className="flex items-center gap-3.5 bg-[#fbfaf6] dark:bg-[#252220] rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] px-4 py-3.5 animate-pulse">
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
