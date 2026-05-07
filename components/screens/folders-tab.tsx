"use client";

import { useState } from "react";
import { Plus, Sparkles, FolderOpen, Inbox } from "lucide-react";
import { FolderCard } from "@/components/folder-card";
import { CreateFolderSheet } from "@/components/create-folder-sheet";
import { FolderActionsSheet } from "@/components/folder-actions-sheet";
import { FolderViewer } from "@/components/screens/folder-viewer";
import { useLanguage } from "@/providers/language-provider";
import type { FolderItem } from "@/types/folder";

interface FoldersTabProps {
  folders: FolderItem[];
  loading: boolean;
  unsortedCount: number;
  onRefresh: () => void;
}

export function FoldersTab({ folders, loading, unsortedCount, onRefresh }: FoldersTabProps) {
  const [createOpen, setCreateOpen]   = useState(false);
  const [viewing, setViewing]         = useState<FolderItem | "inbox" | null>(null);
  const [activeFolder, setActiveFolder] = useState<FolderItem | null>(null);
  const { tr } = useLanguage();

  const userFolders = folders.filter((f) => f.owner === "user");
  const aiFolders   = folders.filter((f) => f.owner === "ai");

  if (viewing !== null) {
    return (
      <FolderViewer
        folder={viewing}
        folders={folders}
        onBack={() => setViewing(null)}
        onFolderRefresh={onRefresh}
      />
    );
  }

  return (
    <div className="overflow-y-auto pb-[76px]">

      {/* ── HEADER ── */}
      <div className="px-5 pt-14 pb-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[24px] font-bold leading-none tracking-tight text-[#4a4036] dark:text-[#e8ddd4]">
            {tr.myFolders}
          </h2>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1 rounded-lg border border-[#9b869c] px-3 py-[6px] text-[12px] font-medium text-[#9b869c] transition-colors active:bg-[#9b869c]/5"
          >
            <Plus size={11} strokeWidth={2.5} />
            {tr.createFolder}
          </button>
        </div>
      </div>

      {/* ── INBOX ── */}
      <section className="px-5 mb-6">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">
          Default
        </p>
        <button
          onClick={() => setViewing("inbox")}
          className="w-full flex items-center gap-4 rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#252220] px-4 py-4 shadow-[0_1px_3px_rgba(74,64,54,0.07)] text-left active:scale-[0.98] transition-transform"
        >
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#9b869c]/10">
            <Inbox size={20} className="text-[#9b869c]" />
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.unsortedInbox}</p>
            <p className="text-[12px] text-[#b0a396] dark:text-[#6e6460] mt-0.5">
              {loading ? "Loading…" : `${unsortedCount} ${tr.unsortedFiles}`}
            </p>
          </div>
          <span className="text-[18px] text-[#b0a396] dark:text-[#6e6460] leading-none">›</span>
        </button>
      </section>

      {/* ── USER FOLDERS ── */}
      <section className="px-5">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">
          {tr.yours}
        </p>
        {loading ? (
          <FolderGrid>{Array.from({ length: 2 }).map((_, i) => <FolderSkeleton key={i} />)}</FolderGrid>
        ) : userFolders.length === 0 ? (
          <EmptyFolders onNew={() => setCreateOpen(true)} label={tr.noFoldersYet} createLabel={tr.createFirst} />
        ) : (
          <FolderGrid>
            {userFolders.map((folder, i) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                index={i}
                onClick={() => setViewing(folder)}
                onMore={() => setActiveFolder(folder)}
              />
            ))}
          </FolderGrid>
        )}
      </section>

      {/* ── AI FOLDERS ── */}
      {(loading || aiFolders.length > 0) && (
        <section className="mt-6 px-5">
          <div className="mb-3 flex items-center gap-1.5">
            <Sparkles size={11} className="text-[#9b869c]" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9b869c]">
              {tr.organizedByAi}
            </p>
          </div>
          {loading ? (
            <FolderGrid>{Array.from({ length: 2 }).map((_, i) => <FolderSkeleton key={i} />)}</FolderGrid>
          ) : (
            <FolderGrid>
              {aiFolders.map((folder, i) => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  index={i}
                  onClick={() => setViewing(folder)}
                  onMore={() => setActiveFolder(folder)}
                />
              ))}
            </FolderGrid>
          )}
        </section>
      )}

      <div className="h-6" />

      {createOpen && (
        <CreateFolderSheet
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); onRefresh(); }}
        />
      )}

      {activeFolder && (
        <FolderActionsSheet
          folder={activeFolder}
          onClose={() => setActiveFolder(null)}
          onOpen={() => { setActiveFolder(null); setViewing(activeFolder); }}
          onRenamed={() => { setActiveFolder(null); onRefresh(); }}
          onDeleted={() => { setActiveFolder(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

function FolderGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function FolderSkeleton() {
  return (
    <div className="rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#252220] p-4 animate-pulse">
      <div className="mb-3 h-10 w-10 rounded-xl bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
      <div className="h-3.5 w-3/4 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
      <div className="mt-2 h-2.5 w-1/2 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
    </div>
  );
}

function EmptyFolders({ onNew, label, createLabel }: { onNew: () => void; label: string; createLabel: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#9b869c]/10">
        <FolderOpen size={26} className="text-[#9b869c]" />
      </div>
      <p className="text-[13px] text-[#b0a396] dark:text-[#6e6460]">{label}</p>
      <button
        onClick={onNew}
        className="rounded-xl border border-[#9b869c] px-4 py-2 text-[13px] font-medium text-[#9b869c] active:bg-[#9b869c]/5"
      >
        {createLabel}
      </button>
    </div>
  );
}
