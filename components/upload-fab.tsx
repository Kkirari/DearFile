"use client";

import { useState, useRef } from "react";
import { Upload, X, FolderOpen, Camera, Image as ImageIcon, CheckCircle2 } from "lucide-react";
import { FolderPickerSheet } from "@/components/folder-picker-sheet";
import type { FolderItem } from "@/types/folder";

// SVG ring: r=22 → circumference = 2π×22 ≈ 138.23
const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;

type UploadState = "idle" | "uploading" | "done" | "error";

interface UploadFabProps {
  onUploadComplete?: () => void;
  onFolderRefresh?: () => void;
  folders: FolderItem[];
  defaultFolderId?: string | null;
}

// ── Upload helper — XHR so we get progress events ─────────────────────────────

function uploadToS3(
  url: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });

    xhr.addEventListener("load", () => {
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`S3 error ${xhr.status}`));
    });

    xhr.addEventListener("error", () => reject(new Error("Network error")));

    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.send(file);
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function UploadFab({ onUploadComplete, onFolderRefresh, folders, defaultFolderId }: UploadFabProps) {
  const [sheetOpen, setSheetOpen]       = useState(false);
  const [isClosing, setIsClosing]       = useState(false);
  const [uploadState, setUploadState]   = useState<UploadState>("idle");
  const [progress, setProgress]         = useState(0);
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);
  const [pendingFile, setPendingFile]   = useState<File | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  const fileInputRef    = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef  = useRef<HTMLInputElement>(null);

  function openSheet() {
    if (uploadState === "uploading") return;
    setIsClosing(false);
    setSheetOpen(true);
  }

  function closeSheet() {
    setIsClosing(true);
    setTimeout(() => {
      setSheetOpen(false);
      setIsClosing(false);
    }, 260);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    closeSheet();
    setPendingFile(file);
    setTimeout(() => setFolderPickerOpen(true), 300);
  }

  function handleFolderSelected(folderId: string | null) {
    setFolderPickerOpen(false);
    if (pendingFile) {
      startUpload(pendingFile, folderId);
      setPendingFile(null);
    }
  }

  function handleFolderPickerClose() {
    setFolderPickerOpen(false);
    setPendingFile(null);
  }

  async function startUpload(file: File, folderId: string | null) {
    setUploadState("uploading");
    setProgress(0);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
          ...(folderId ? { folderId } : {}),
        }),
      });
      if (!res.ok) throw new Error("Could not get upload URL");
      const { uploadUrl, key } = await res.json() as { uploadUrl: string; key: string };

      await uploadToS3(uploadUrl, file, setProgress);

      setUploadState("done");

      // Auto-analyze: rename + tag + index in S3, non-blocking
      try {
        await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
        // After analyze the search index is updated → refresh folders so
        // AI folder counts reflect the newly categorized file
        onFolderRefresh?.();
      } catch {
        // non-fatal — file stays with original name, no AI folder assigned
      }

      onUploadComplete?.();
      setTimeout(() => setUploadState("idle"), 2000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      setUploadState("error");
      setTimeout(() => { setUploadState("idle"); setErrorMsg(null); }, 3000);
    }
  }

  const fabBg =
    uploadState === "error" ? "bg-red-500 shadow-red-300/50" :
    uploadState === "done"  ? "bg-emerald-500 shadow-emerald-300/50" :
    "bg-[#9b869c] shadow-[#9b869c]/30";

  return (
    <>
      {/* ── FAB ── */}
      <div className="fixed bottom-24 right-4 z-[55]">
        <button
          onClick={openSheet}
          aria-label="Upload file"
          disabled={uploadState === "uploading"}
          className={`relative flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all active:scale-95 disabled:cursor-not-allowed ${fabBg}`}
        >
          {uploadState === "uploading" && (
            <svg width="56" height="56" viewBox="0 0 56 56" className="absolute inset-0 -rotate-90">
              <circle cx="28" cy="28" r={RING_R} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
              <circle
                cx="28" cy="28" r={RING_R}
                fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - progress / 100)}
                style={{ transition: "stroke-dashoffset 0.15s ease-out" }}
              />
            </svg>
          )}
          {uploadState === "uploading" && <span className="relative text-[11px] font-bold text-white">{progress}%</span>}
          {uploadState === "done"      && <CheckCircle2 size={22} className="text-white" />}
          {uploadState === "error"     && <X size={22} className="text-white" />}
          {uploadState === "idle"      && <Upload size={21} className="text-white" strokeWidth={2.25} />}
        </button>
      </div>


      {/* Error tooltip */}
      {uploadState === "error" && errorMsg && (
        <div className="fixed bottom-[154px] right-4 z-[55] max-w-[200px] rounded-xl bg-red-500 px-3 py-2 text-[11px] text-white shadow-lg">
          {errorMsg}
        </div>
      )}

      {/* ── SOURCE SHEET ── */}
      {sheetOpen && (
        <>
          <div
            className={`fixed inset-0 z-[60] bg-black/25 ${isClosing ? "backdrop-exit" : "backdrop-enter"}`}
            onClick={closeSheet}
          />
          <div
            className={`fixed bottom-0 left-0 right-0 z-[60] rounded-t-[28px] bg-white dark:bg-[#252220] px-5 pt-4 pb-[calc(28px+env(safe-area-inset-bottom,0px))] shadow-2xl ${isClosing ? "sheet-exit" : "sheet-enter"}`}
          >
            <div className="mx-auto mb-5 h-[5px] w-10 rounded-full bg-[#e0d8cc] dark:bg-[#3a3430]" />

            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-[17px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">Upload File</h3>
              <button
                onClick={closeSheet}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f4f3ee] dark:bg-[#2a2724] text-[#b0a396] dark:text-[#6e6460] transition-colors active:bg-[#e0d8cc] dark:active:bg-[#3a3430]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-col gap-2.5">
              <SheetOption index={0}
                icon={<FolderOpen size={21} className="text-[#9b869c]" />}
                iconBg="bg-[#9b869c]/10"
                title="Browse Files"
                subtitle="PDF, DOCX, XLSX, ZIP and more"
                onClick={() => fileInputRef.current?.click()}
              />
              <SheetOption index={1}
                icon={<ImageIcon size={21} className="text-blue-500" />}
                iconBg="bg-blue-50 dark:bg-blue-950/40"
                title="Photo Library"
                subtitle="Choose from your gallery"
                onClick={() => galleryInputRef.current?.click()}
              />
              <SheetOption index={2}
                icon={<Camera size={21} className="text-emerald-500" />}
                iconBg="bg-emerald-50 dark:bg-emerald-950/40"
                title="Take Photo"
                subtitle="Use your camera directly"
                onClick={() => cameraInputRef.current?.click()}
              />
            </div>

            <input ref={fileInputRef}    type="file"                                        className="hidden" onChange={handleChange} />
            <input ref={galleryInputRef} type="file" accept="image/*"                       className="hidden" onChange={handleChange} />
            <input ref={cameraInputRef}  type="file" accept="image/*" capture="environment" className="hidden" onChange={handleChange} />
          </div>
        </>
      )}

      {/* ── FOLDER PICKER (after file selected) ── */}
      {folderPickerOpen && pendingFile && (
        <FolderPickerSheet
          folders={folders}
          title="Save to Folder"
          currentFolderId={defaultFolderId ?? null}
          onSelect={handleFolderSelected}
          onClose={handleFolderPickerClose}
          onFolderCreated={onFolderRefresh}
        />
      )}
    </>
  );
}

// ── Sheet option row ──────────────────────────────────────────────────────────

function SheetOption({
  icon, iconBg, title, subtitle, onClick, index,
}: {
  icon: React.ReactNode; iconBg: string;
  title: string; subtitle: string;
  onClick: () => void; index: number;
}) {
  return (
    <button
      onClick={onClick}
      className="card-enter flex items-center gap-3.5 rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#f4f3ee]/50 dark:bg-[#2a2724]/50 p-4 text-left transition-colors active:bg-[#f4f3ee] dark:active:bg-[#2a2724]"
      style={{ animationDelay: `${80 + index * 65}ms` }}
    >
      <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
        {icon}
      </div>
      <div>
        <p className="text-[14px] font-semibold text-[#4a4036] dark:text-[#e8ddd4]">{title}</p>
        <p className="text-[12px] text-[#b0a396] dark:text-[#6e6460]">{subtitle}</p>
      </div>
    </button>
  );
}
