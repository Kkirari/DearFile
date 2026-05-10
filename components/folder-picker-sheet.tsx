"use client";

import { useState } from "react";
import { X, Inbox, Folder, Sparkles, Plus, Check } from "lucide-react";
import { CreateFolderSheet } from "@/components/create-folder-sheet";
import type { FolderItem } from "@/types/folder";
import { apiFetch } from "@/lib/api-client";

interface FolderPickerSheetProps {
  folders: FolderItem[];
  title?: string;
  currentFolderId?: string | null;
  onSelect: (folderId: string | null) => void;
  onClose: () => void;
  onFolderCreated?: () => void;
}

export function FolderPickerSheet({
  folders,
  title = "Choose Folder",
  currentFolderId,
  onSelect,
  onClose,
  onFolderCreated,
}: FolderPickerSheetProps) {
  const [isClosing, setIsClosing]     = useState(false);
  const [createOpen, setCreateOpen]   = useState(false);
  const [localFolders, setLocalFolders] = useState<FolderItem[]>(folders);

  if (localFolders !== folders && !createOpen) {
    setLocalFolders(folders);
  }

  function close() {
    setIsClosing(true);
    setTimeout(() => { setIsClosing(false); onClose(); }, 260);
  }

  function pick(folderId: string | null) {
    setIsClosing(true);
    setTimeout(() => { setIsClosing(false); onSelect(folderId); }, 180);
  }

  async function handleFolderCreated() {
    setCreateOpen(false);
    try {
      const res  = await apiFetch("/api/folders");
      const data = await res.json() as { folders?: FolderItem[] };
      if (data.folders) setLocalFolders(data.folders);
    } catch { /* ignore */ }
    onFolderCreated?.();
  }

  // AI folders are virtual & auto-organized — users cannot move files INTO them.
  // Only show user folders + Inbox as valid destinations.
  const userFolders = localFolders.filter((f) => f.owner === "user");

  if (createOpen) {
    return (
      <CreateFolderSheet
        onClose={() => setCreateOpen(false)}
        onCreated={handleFolderCreated}
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
        className={`fixed bottom-0 left-0 right-0 z-[70] rounded-t-[28px] bg-[#fbfaf6] dark:bg-[#252220] px-5 pt-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] shadow-2xl ${isClosing ? "sheet-exit" : "sheet-enter"}`}
      >
        <div className="mx-auto mb-4 h-[5px] w-10 rounded-full bg-[#e0d8cc] dark:bg-[#3a3430]" />

        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[17px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">{title}</h3>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f4f3ee] dark:bg-[#2a2724] text-[#b0a396] dark:text-[#6e6460] active:bg-[#e0d8cc] dark:active:bg-[#3a3430]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-1.5 max-h-[55dvh] overflow-y-auto">

          {/* Inbox */}
          <PickerRow
            icon={<Inbox size={18} className="text-[#9b869c]" />}
            iconBg="bg-[#9b869c]/10"
            label="Inbox"
            sublabel="Unsorted files"
            selected={currentFolderId === null}
            onClick={() => pick(null)}
          />

          {userFolders.length > 0 && (
            <>
              <p className="mt-2 mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">
                Yours
              </p>
              {userFolders.map((f) => (
                <PickerRow
                  key={f.id}
                  icon={<Folder size={18} className="text-[#9b869c]" />}
                  iconBg="bg-[#9b869c]/10"
                  label={f.name}
                  sublabel="Your folder"
                  selected={currentFolderId === f.id}
                  onClick={() => pick(f.id)}
                />
              ))}
            </>
          )}

        </div>

        {/* AI folder hint — virtual folders, not selectable as destinations */}
        <p className="mt-3 px-1 text-[11px] text-[#b0a396] dark:text-[#6e6460] flex items-center gap-1.5">
          <Sparkles size={11} className="text-[#9b869c]" />
          AI folders organize automatically — files can&apos;t be moved into them manually.
        </p>

        <button
          onClick={() => setCreateOpen(true)}
          className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-dashed border-[#9b869c]/40 px-4 py-3 text-[14px] font-medium text-[#9b869c] active:bg-[#9b869c]/5 transition-colors"
        >
          <Plus size={16} strokeWidth={2.5} />
          New Folder
        </button>
      </div>
    </>
  );
}

function PickerRow({
  icon, iconBg, label, sublabel, selected, onClick,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  sublabel: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full rounded-2xl px-3 py-3 text-left transition-all active:scale-[0.98] ${
        selected ? "bg-[#9b869c]/10" : "active:bg-[#f4f3ee] dark:active:bg-[#2a2724]"
      }`}
    >
      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-[#4a4036] dark:text-[#e8ddd4] truncate">{label}</p>
        <p className="text-[11px] text-[#b0a396] dark:text-[#6e6460]">{sublabel}</p>
      </div>
      {selected && <Check size={16} strokeWidth={2.5} className="flex-shrink-0 text-[#9b869c]" />}
    </button>
  );
}
