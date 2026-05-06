"use client";

import { useState, useRef, useEffect } from "react";
import { X, Pencil, Trash2, FolderOpen } from "lucide-react";
import type { FolderItem } from "@/types/folder";

interface FolderActionsSheetProps {
  folder: FolderItem;
  onClose: () => void;
  onOpen: () => void;
  onRenamed: () => void;
  onDeleted: () => void;
}

type View = "menu" | "rename";

export function FolderActionsSheet({
  folder, onClose, onOpen, onRenamed, onDeleted,
}: FolderActionsSheetProps) {
  const [isClosing, setIsClosing]         = useState(false);
  const [view, setView]                   = useState<View>("menu");
  const [name, setName]                   = useState(folder.name);
  const [saving, setSaving]               = useState(false);
  const [deleting, setDeleting]           = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (view === "rename") setTimeout(() => inputRef.current?.focus(), 80);
  }, [view]);

  function close() {
    setIsClosing(true);
    setTimeout(() => { setIsClosing(false); onClose(); }, 260);
  }

  async function handleRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === folder.name) { close(); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folder.id, name: trimmed }),
      });
      if (!res.ok) throw new Error("Rename failed");
      close();
      setTimeout(onRenamed, 300);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setSaving(false);
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
      await fetch("/api/folders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folder.id }),
      });
      close();
      setTimeout(onDeleted, 300);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
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

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#b0a396]">Folder</p>
            <h3 className="text-[17px] font-bold text-[#4a4036] truncate max-w-[220px]">
              {folder.name}
            </h3>
          </div>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f4f3ee] text-[#b0a396] active:bg-[#e0d8cc]"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── MENU VIEW ── */}
        {view === "menu" && (
          <div className="flex flex-col gap-2.5">
            <ActionRow
              icon={<FolderOpen size={19} />}
              label="Open Folder"
              bg="bg-[#9b869c]"
              textColor="text-white"
              onClick={() => { close(); setTimeout(onOpen, 120); }}
            />
            <ActionRow
              icon={<Pencil size={19} />}
              label="Rename"
              bg="bg-[#f4f3ee]"
              textColor="text-[#4a4036]"
              onClick={() => setView("rename")}
            />
            <ActionRow
              icon={<Trash2 size={19} />}
              label={confirmDelete ? "Tap again to confirm delete" : deleting ? "Deleting…" : "Delete Folder"}
              bg={confirmDelete ? "bg-red-500" : "bg-red-50"}
              textColor={confirmDelete ? "text-white" : "text-red-500"}
              onClick={handleDelete}
              disabled={deleting}
            />
          </div>
        )}

        {/* ── RENAME VIEW ── */}
        {view === "rename" && (
          <div>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setView("menu"); }}
              maxLength={64}
              className="w-full rounded-2xl border border-[#e0d8cc] bg-[#f4f3ee] px-4 py-3.5 text-[15px] text-[#4a4036] placeholder:text-[#b0a396] outline-none focus:border-[#9b869c] transition-colors mb-3"
            />
            {error && <p className="mb-3 text-[12px] text-red-500">{error}</p>}
            <div className="flex gap-2.5">
              <button
                onClick={() => setView("menu")}
                className="flex-1 rounded-2xl bg-[#f4f3ee] py-3.5 text-[14px] font-semibold text-[#4a4036] active:scale-[0.98] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                disabled={!name.trim() || saving}
                className="flex-1 rounded-2xl bg-[#9b869c] py-3.5 text-[14px] font-bold text-white active:scale-[0.98] transition-all disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function ActionRow({
  icon, label, bg, textColor, onClick, disabled,
}: {
  icon: React.ReactNode; label: string;
  bg: string; textColor: string;
  onClick: () => void; disabled?: boolean;
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
