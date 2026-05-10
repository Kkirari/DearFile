"use client";

import { useState, useEffect } from "react";
import { X, Check, Sparkles } from "lucide-react";
import {
  FOLDER_COLORS,
  FOLDER_EMOJIS,
  getFolderColor,
  setFolderColor,
  getFolderEmoji,
  setFolderEmoji,
} from "@/lib/folder-prefs";
import { useLanguage } from "@/providers/language-provider";

interface FolderCustomizeSheetProps {
  folderId: string;
  folderName: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function FolderCustomizeSheet({
  folderId, folderName, onClose, onSaved,
}: FolderCustomizeSheetProps) {
  const { tr } = useLanguage();
  const [isClosing, setIsClosing]   = useState(false);
  const [colorId, setColorIdState]  = useState<string>("default");
  const [emoji,   setEmojiState]    = useState<string | null>(null);

  // Load current prefs
  useEffect(() => {
    setColorIdState(getFolderColor(folderId));
    setEmojiState(getFolderEmoji(folderId));
  }, [folderId]);

  function close() {
    setIsClosing(true);
    setTimeout(() => { setIsClosing(false); onClose(); }, 260);
  }

  function handlePickColor(id: string) {
    setColorIdState(id);
    setFolderColor(folderId, id);
    onSaved?.();
  }

  function handlePickEmoji(em: string | null) {
    setEmojiState(em);
    setFolderEmoji(folderId, em);
    onSaved?.();
  }

  const accent = FOLDER_COLORS.find((c) => c.id === colorId)?.hex ?? FOLDER_COLORS[0].hex;

  return (
    <>
      <div
        className={`fixed inset-0 z-[80] bg-black/30 ${isClosing ? "backdrop-exit" : "backdrop-enter"}`}
        onClick={close}
      />
      <div
        className={`fixed bottom-0 left-0 right-0 z-[80] rounded-t-[28px] bg-[#fbfaf6] dark:bg-[#252220] px-5 pt-4 pb-[calc(28px+env(safe-area-inset-bottom,0px))] shadow-2xl max-h-[85dvh] overflow-y-auto ${isClosing ? "sheet-exit" : "sheet-enter"}`}
      >
        <div className="mx-auto mb-4 h-[5px] w-10 rounded-full bg-[#e0d8cc] dark:bg-[#3a3430]" />

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={14} className="text-[#9b869c] flex-shrink-0" />
            <h3 className="text-[16px] font-bold text-[#4a4036] dark:text-[#e8ddd4] truncate">
              {tr.foldersCustomize}
            </h3>
          </div>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f4f3ee] dark:bg-[#2a2724] text-[#b0a396] dark:text-[#6e6460] active:bg-[#e0d8cc] dark:active:bg-[#3a3430]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Preview */}
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#f4f3ee]/60 dark:bg-[#1c1a18]/60 px-4 py-3">
          <div
            className="h-12 w-12 rounded-xl flex items-center justify-center text-[24px] flex-shrink-0"
            style={{ background: `${accent}25` }}
          >
            {emoji ?? "📁"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold text-[#4a4036] dark:text-[#e8ddd4] truncate">
              {folderName}
            </p>
            <p className="text-[11px] text-[#b0a396] dark:text-[#6e6460] mt-0.5">
              Preview
            </p>
          </div>
        </div>

        {/* Color picker */}
        <div className="mb-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">
            {tr.foldersChooseColor}
          </p>
          <div className="grid grid-cols-8 gap-2">
            {FOLDER_COLORS.map((c) => {
              const isActive = c.id === colorId;
              return (
                <button
                  key={c.id}
                  onClick={() => handlePickColor(c.id)}
                  aria-label={c.label}
                  className="relative h-9 w-9 rounded-full active:scale-90 transition-transform shadow-sm"
                  style={{ background: c.hex }}
                >
                  {isActive && (
                    <Check size={15} strokeWidth={3} className="absolute inset-0 m-auto text-white drop-shadow-sm" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Emoji picker */}
        <div>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">
            {tr.foldersChooseEmoji}
          </p>
          <div className="grid grid-cols-8 gap-2">
            {/* "None" option = uses dot indicator */}
            <button
              onClick={() => handlePickEmoji(null)}
              className={`flex h-10 w-10 items-center justify-center rounded-xl text-[14px] active:scale-90 transition-transform border ${
                emoji === null
                  ? "border-[#9b869c] bg-[#9b869c]/10"
                  : "border-[#e0d8cc] dark:border-[#3a3430] bg-[#f4f3ee] dark:bg-[#2a2724]"
              }`}
            >
              <X size={14} className="text-[#b0a396]" />
            </button>
            {FOLDER_EMOJIS.map((em) => {
              const isActive = em === emoji;
              return (
                <button
                  key={em}
                  onClick={() => handlePickEmoji(em)}
                  className={`flex h-10 w-10 items-center justify-center rounded-xl text-[20px] active:scale-90 transition-transform border ${
                    isActive
                      ? "border-[#9b869c] bg-[#9b869c]/10"
                      : "border-[#e0d8cc] dark:border-[#3a3430] bg-[#f4f3ee] dark:bg-[#2a2724]"
                  }`}
                >
                  {em}
                </button>
              );
            })}
          </div>
        </div>

        {/* Done button */}
        <button
          onClick={close}
          className="mt-6 w-full rounded-2xl bg-[#9b869c] py-3.5 text-[14px] font-bold text-white active:scale-[0.98] transition-transform shadow-sm"
        >
          {tr.foldersDone}
        </button>
      </div>
    </>
  );
}
