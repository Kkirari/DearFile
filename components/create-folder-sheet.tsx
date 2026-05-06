"use client";

import { useState, useRef, useEffect } from "react";
import { X, FolderPlus } from "lucide-react";

interface CreateFolderSheetProps {
  onClose: () => void;
  onCreated: () => void;
}

export function CreateFolderSheet({ onClose, onCreated }: CreateFolderSheetProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [name, setName]           = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 320);
  }, []);

  function close() {
    setIsClosing(true);
    setTimeout(() => { setIsClosing(false); onClose(); }, 260);
  }

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const res  = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, owner: "user" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      close();
      setTimeout(onCreated, 300);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create folder");
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") close();
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

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#9b869c]/10">
              <FolderPlus size={18} className="text-[#9b869c]" />
            </div>
            <h3 className="text-[17px] font-bold text-[#4a4036]">New Folder</h3>
          </div>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f4f3ee] text-[#b0a396] transition-colors active:bg-[#e0d8cc]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mb-4">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Folder name…"
            maxLength={64}
            className="w-full rounded-2xl border border-[#e0d8cc] bg-[#f4f3ee] px-4 py-3.5 text-[15px] text-[#4a4036] placeholder:text-[#b0a396] outline-none focus:border-[#9b869c] transition-colors"
          />
          {error && (
            <p className="mt-2 text-[12px] text-red-500">{error}</p>
          )}
        </div>

        <button
          onClick={handleCreate}
          disabled={!name.trim() || saving}
          className="w-full rounded-2xl bg-[#9b869c] py-3.5 text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
        >
          {saving ? "Creating…" : "Create Folder"}
        </button>
      </div>
    </>
  );
}
