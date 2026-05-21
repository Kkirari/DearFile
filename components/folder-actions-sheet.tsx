"use client";

import { useState, useRef, useEffect } from "react";
import { X, Pencil, Trash2, FolderOpen, Pin, Sparkles, PinOff, Lock, Check } from "lucide-react";
import { FolderCustomizeSheet } from "@/components/folder-customize-sheet";
import { isPinned as isPinnedPref, togglePin } from "@/lib/folder-prefs";
import { useLanguage } from "@/providers/language-provider";
import { useWorkspace } from "@/providers/workspace-provider";
import type { FolderItem } from "@/types/folder";
import type { FolderMode } from "@/lib/folder-permissions";
import { apiFetch } from "@/lib/api-client";

interface FolderActionsSheetProps {
  folder: FolderItem;
  onClose: () => void;
  onOpen: () => void;
  onRenamed: () => void;
  onDeleted: () => void;
  onPrefsChanged?: () => void;
  /** Bumped after a successful mode change so the parent can refetch. */
  onPermissionsChanged?: () => void;
}

type View = "menu" | "rename" | "permissions";

const MODE_OPTIONS: { id: FolderMode; label: string; hint: string }[] = [
  { id: "read-only", label: "Read-only", hint: "Members can view files only" },
  { id: "upload",    label: "Upload",    hint: "Members can upload and delete their own files" },
  { id: "full",      label: "Full",      hint: "Members can upload and delete any file" },
];

function modeLabel(mode: FolderMode | undefined): string {
  return MODE_OPTIONS.find((o) => o.id === mode)?.label ?? "Upload";
}

export function FolderActionsSheet({
  folder, onClose, onOpen, onRenamed, onDeleted, onPrefsChanged, onPermissionsChanged,
}: FolderActionsSheetProps) {
  const { tr } = useLanguage();
  const { currentWorkspaceId, currentWorkspace } = useWorkspace();
  const inWorkspace = currentWorkspaceId !== null && folder.owner !== "ai";
  const isOwner     = inWorkspace && currentWorkspace?.role === "owner";
  const currentMode: FolderMode = folder.mode ?? "upload";

  const [isClosing, setIsClosing]         = useState(false);
  const [view, setView]                   = useState<View>("menu");
  const [name, setName]                   = useState(folder.name);
  const [saving, setSaving]               = useState(false);
  const [deleting, setDeleting]           = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [pinned, setPinned]               = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [savingMode, setSavingMode]       = useState<FolderMode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (view === "rename") setTimeout(() => inputRef.current?.focus(), 80);
  }, [view]);

  useEffect(() => {
    setPinned(isPinnedPref(folder.id));
  }, [folder.id]);

  function handleTogglePin() {
    const next = togglePin(folder.id);
    setPinned(next);
    onPrefsChanged?.();
  }

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
      const res = await apiFetch("/api/folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: folder.id,
          name: trimmed,
          ...(currentWorkspaceId ? { workspaceId: currentWorkspaceId } : {}),
        }),
      });
      if (!res.ok) throw new Error("Rename failed");
      close();
      setTimeout(onRenamed, 300);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setSaving(false);
    }
  }

  async function handleSetMode(next: FolderMode) {
    if (!currentWorkspaceId || next === currentMode || savingMode) return;
    setSavingMode(next);
    setError(null);
    try {
      const res = await apiFetch("/api/folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: folder.id,
          mode: next,
          workspaceId: currentWorkspaceId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to update permissions");
      }
      close();
      setTimeout(() => onPermissionsChanged?.(), 300);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setSavingMode(null);
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
      await apiFetch("/api/folders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: folder.id,
          ...(currentWorkspaceId ? { workspaceId: currentWorkspaceId } : {}),
        }),
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
        className={`fixed bottom-0 left-0 right-0 z-[70] rounded-t-[28px] bg-[#fbfaf6] dark:bg-[#252220] px-5 pt-4 pb-[calc(32px+env(safe-area-inset-bottom,0px))] shadow-2xl ${isClosing ? "sheet-exit" : "sheet-enter"}`}
      >
        <div className="mx-auto mb-5 h-[5px] w-10 rounded-full bg-[#e0d8cc] dark:bg-[#3a3430]" />

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">Folder</p>
            <h3 className="text-[17px] font-bold text-[#4a4036] dark:text-[#e8ddd4] truncate max-w-[220px]">
              {folder.name}
            </h3>
          </div>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f4f3ee] dark:bg-[#2a2724] text-[#b0a396] dark:text-[#6e6460] active:bg-[#e0d8cc] dark:active:bg-[#3a3430]"
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
            {folder.owner !== "ai" && (
              <ActionRow
                icon={pinned ? <PinOff size={19} /> : <Pin size={19} />}
                label={pinned ? tr.foldersUnpin : tr.foldersPin}
                bg="bg-[#9b869c]/10 dark:bg-[#9b869c]/15"
                textColor="text-[#9b869c]"
                onClick={handleTogglePin}
              />
            )}
            {folder.owner !== "ai" && (
              <ActionRow
                icon={<Sparkles size={19} />}
                label={tr.foldersCustomize}
                bg="bg-[#f4f3ee] dark:bg-[#2a2724]"
                textColor="text-[#4a4036] dark:text-[#e8ddd4]"
                onClick={() => setCustomizeOpen(true)}
              />
            )}
            {folder.owner !== "ai" && (
              <ActionRow
                icon={<Pencil size={19} />}
                label="Rename"
                bg="bg-[#f4f3ee] dark:bg-[#2a2724]"
                textColor="text-[#4a4036] dark:text-[#e8ddd4]"
                onClick={() => setView("rename")}
              />
            )}
            {inWorkspace && isOwner && (
              <ActionRow
                icon={<Lock size={19} />}
                label={`Permissions · ${modeLabel(currentMode)}`}
                bg="bg-[#f4f3ee] dark:bg-[#2a2724]"
                textColor="text-[#4a4036] dark:text-[#e8ddd4]"
                onClick={() => setView("permissions")}
              />
            )}
            {inWorkspace && !isOwner && (
              <div className="flex w-full items-center gap-3 rounded-2xl bg-[#f4f3ee] dark:bg-[#2a2724] px-4 py-3.5 text-[14px] font-semibold text-[#b0a396] dark:text-[#6e6460]">
                <Lock size={19} />
                <span>Permissions · {modeLabel(currentMode)}</span>
              </div>
            )}
            {folder.owner !== "ai" && (
              <ActionRow
                icon={<Trash2 size={19} />}
                label={confirmDelete ? "Tap again to confirm delete" : deleting ? "Deleting…" : "Delete Folder"}
                bg={confirmDelete ? "bg-red-500" : "bg-red-50 dark:bg-red-950/40"}
                textColor={confirmDelete ? "text-white" : "text-red-500"}
                onClick={handleDelete}
                disabled={deleting}
              />
            )}
          </div>
        )}

        {/* Customize sheet (color + emoji) */}
        {customizeOpen && (
          <FolderCustomizeSheet
            folderId={folder.id}
            folderName={folder.name}
            onClose={() => setCustomizeOpen(false)}
            onSaved={onPrefsChanged}
          />
        )}

        {/* ── PERMISSIONS VIEW ── */}
        {view === "permissions" && (
          <div className="flex flex-col gap-2.5">
            <p className="px-1 pb-1 text-[12.5px] leading-relaxed text-[#b0a396] dark:text-[#6e6460]">
              Choose how members of this workspace can use the folder. You always have full access.
            </p>
            {MODE_OPTIONS.map((opt) => {
              const selected = currentMode === opt.id;
              const isSavingThis = savingMode === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => handleSetMode(opt.id)}
                  disabled={savingMode !== null}
                  className={`flex w-full items-start gap-3 rounded-2xl px-4 py-3.5 text-left transition-all active:scale-[0.98] disabled:opacity-50 ${
                    selected
                      ? "bg-[#9b869c]/15 dark:bg-[#9b869c]/20"
                      : "bg-[#f4f3ee] dark:bg-[#2a2724]"
                  }`}
                >
                  <div className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                    selected ? "border-[#9b869c] bg-[#9b869c]" : "border-[#b0a396] dark:border-[#6e6460] bg-transparent"
                  }`}>
                    {selected && <Check size={11} className="text-white" strokeWidth={3} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[14px] font-bold ${
                      selected ? "text-[#4a4036] dark:text-[#e8ddd4]" : "text-[#4a4036] dark:text-[#e8ddd4]"
                    }`}>
                      {opt.label}{isSavingThis ? "…" : ""}
                    </p>
                    <p className="mt-0.5 text-[12px] leading-snug text-[#b0a396] dark:text-[#6e6460]">
                      {opt.hint}
                    </p>
                  </div>
                </button>
              );
            })}
            {error && <p className="px-1 text-[12px] text-red-500">{error}</p>}
            <button
              onClick={() => setView("menu")}
              disabled={savingMode !== null}
              className="mt-1 rounded-2xl bg-[#f4f3ee] dark:bg-[#2a2724] py-3 text-[14px] font-semibold text-[#4a4036] dark:text-[#e8ddd4] active:scale-[0.98] transition-all disabled:opacity-50"
            >
              Back
            </button>
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
              className="w-full rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#f4f3ee] dark:bg-[#2a2724] px-4 py-3.5 text-[15px] text-[#4a4036] dark:text-[#e8ddd4] placeholder:text-[#b0a396] dark:placeholder:text-[#6e6460] outline-none focus:border-[#9b869c] transition-colors mb-3"
            />
            {error && <p className="mb-3 text-[12px] text-red-500">{error}</p>}
            <div className="flex gap-2.5">
              <button
                onClick={() => setView("menu")}
                className="flex-1 rounded-2xl bg-[#f4f3ee] dark:bg-[#2a2724] py-3.5 text-[14px] font-semibold text-[#4a4036] dark:text-[#e8ddd4] active:scale-[0.98] transition-all"
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
