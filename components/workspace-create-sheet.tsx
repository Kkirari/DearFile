"use client";

/**
 * Bottom sheet for creating a new shared workspace from the LIFF app.
 *
 * Flow: user enters a name → POST /api/workspaces → refresh provider →
 * setCurrentWorkspace(new.id) → close. Errors render inline; sheet stays
 * open so user can retry.
 */

import { useEffect, useRef, useState } from "react";
import { Users, X } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useWorkspace } from "@/providers/workspace-provider";

interface WorkspaceCreateSheetProps {
  onClose: () => void;
}

export function WorkspaceCreateSheet({ onClose }: WorkspaceCreateSheetProps) {
  const { refresh, setCurrentWorkspace } = useWorkspace();
  const [isClosing, setIsClosing] = useState(false);
  const [name, setName]           = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 320);
  }, []);

  function close() {
    if (saving) return;
    setIsClosing(true);
    setTimeout(() => { setIsClosing(false); onClose(); }, 260);
  }

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({})) as {
        workspace?: { id: string };
        error?: string;
      };
      if (!res.ok || !data.workspace?.id) {
        throw new Error(data.error ?? `Failed to create workspace (${res.status})`);
      }
      await refresh();
      setCurrentWorkspace(data.workspace.id);
      setIsClosing(true);
      setTimeout(() => { setIsClosing(false); onClose(); }, 220);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create workspace");
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
        className={`fixed bottom-0 left-0 right-0 z-[70] rounded-t-[28px] bg-[#fbfaf6] dark:bg-[#252220] px-5 pt-4 pb-[calc(32px+env(safe-area-inset-bottom,0px))] shadow-2xl ${isClosing ? "sheet-exit" : "sheet-enter"}`}
      >
        <div className="mx-auto mb-5 h-[5px] w-10 rounded-full bg-[#e0d8cc] dark:bg-[#3a3430]" />

        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#9b869c]/10">
              <Users size={18} className="text-[#9b869c]" />
            </div>
            <h3 className="text-[17px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">New Workspace</h3>
          </div>
          <button
            onClick={close}
            disabled={saving}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f4f3ee] dark:bg-[#2a2724] text-[#b0a396] dark:text-[#6e6460] transition-colors active:bg-[#e0d8cc] dark:active:bg-[#3a3430] disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mb-4 text-[12.5px] leading-relaxed text-[#b0a396] dark:text-[#6e6460]">
          Create a shared space and invite specific friends with a link. Files inside are visible to everyone in the workspace.
        </p>

        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={80}
          placeholder="Workspace name"
          className="w-full rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#f4f3ee] dark:bg-[#2a2724] px-4 py-3.5 text-[15px] text-[#4a4036] dark:text-[#e8ddd4] placeholder:text-[#b0a396] dark:placeholder:text-[#6e6460] outline-none focus:border-[#9b869c] transition-colors"
        />

        {error && (
          <p className="mt-3 text-[12px] text-red-500">{error}</p>
        )}

        <button
          onClick={handleCreate}
          disabled={!name.trim() || saving}
          className="mt-5 w-full rounded-2xl bg-[#9b869c] py-3.5 text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40 shadow-[0_4px_12px_rgba(155,134,156,0.3)]"
        >
          {saving ? "Creating…" : "Create Workspace"}
        </button>
      </div>
    </>
  );
}
