"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  Plus, Sparkles, FolderOpen, Folder, Inbox, Search, X,
  ArrowDownWideNarrow, Check, Pin, History,
} from "lucide-react";
import { FolderCard } from "@/components/folder-card";
import { CreateFolderSheet } from "@/components/create-folder-sheet";
import { FolderActionsSheet } from "@/components/folder-actions-sheet";
import { FolderViewer } from "@/components/screens/folder-viewer";
import { useLanguage } from "@/providers/language-provider";
import { useFolderPreviews } from "@/hooks/use-folder-previews";
import {
  getPinned, getRecent, trackVisit,
  getFolderColor, getFolderEmoji, getColorHex,
} from "@/lib/folder-prefs";
import type { FolderItem } from "@/types/folder";

type SortMode = "recent" | "name" | "most" | "oldest";

interface FoldersTabProps {
  folders: FolderItem[];
  loading: boolean;
  unsortedCount: number;
  onRefresh: () => void;
}

export function FoldersTab({ folders, loading, unsortedCount, onRefresh }: FoldersTabProps) {
  const { tr } = useLanguage();

  const [createOpen, setCreateOpen]       = useState(false);
  const [viewing, setViewing]             = useState<FolderItem | "inbox" | null>(null);
  const [activeFolder, setActiveFolder]   = useState<FolderItem | null>(null);

  // New: search, sort, prefs
  const [search, setSearch]   = useState("");
  const [sort, setSort]       = useState<SortMode>("recent");
  const [sortOpen, setSortOpen] = useState(false);
  // Lazy-init from localStorage so the first paint already has the right
  // pin/recent state — avoids a one-frame flash where a pinned folder
  // briefly shows in "Yours" before the effect re-reads localStorage.
  const [pinnedIds, setPinnedIds]   = useState<string[]>(() =>
    typeof window === "undefined" ? [] : getPinned()
  );
  const [recentIds, setRecentIds]   = useState<string[]>(() =>
    typeof window === "undefined" ? [] : getRecent()
  );
  const [prefsTick, setPrefsTick]   = useState(0); // forces re-read of prefs

  // Folder cover previews (batched)
  const { previews } = useFolderPreviews(folders.length);

  // Re-read prefs when the user closes a folder viewer (recent visit) or
  // toggles a pref from the actions sheet (prefsTick bumps).
  useEffect(() => {
    setPinnedIds(getPinned());
    setRecentIds(getRecent());
  }, [viewing, prefsTick]);

  // ── Filter & sort logic ─────────────────────────────────────────────
  const SORT_OPTIONS = useMemo<{ id: SortMode; label: string }[]>(() => [
    { id: "recent", label: tr.foldersSortRecent },
    { id: "name",   label: tr.foldersSortName   },
    { id: "most",   label: tr.foldersSortMost   },
    { id: "oldest", label: tr.foldersSortOldest },
  ], [tr]);

  function applySort(list: FolderItem[]): FolderItem[] {
    const copy = [...list];
    switch (sort) {
      case "name":
        return copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      case "most":
        return copy.sort((a, b) => {
          const ac = previews[a.id]?.total ?? a.count ?? 0;
          const bc = previews[b.id]?.total ?? b.count ?? 0;
          return bc - ac;
        });
      case "oldest":
        return copy.sort((a, b) =>
          new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
      case "recent":
      default:
        return copy.sort((a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
  }

  function applySearch(list: FolderItem[]): FolderItem[] {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((f) => f.name.toLowerCase().includes(q));
  }

  // Pinned folders (across both user + ai)
  const pinnedFolders = useMemo(() => {
    if (search.trim()) return []; // hide pinned section while searching
    return pinnedIds
      .map((id) => folders.find((f) => f.id === id))
      .filter((f): f is FolderItem => !!f);
  }, [folders, pinnedIds, search]);

  // Recent visited (excluding pinned, excluding ones not in folders, max 4)
  const recentVisited = useMemo(() => {
    if (search.trim()) return [];
    const pinSet = new Set(pinnedIds);
    return recentIds
      .filter((id) => !pinSet.has(id))
      .map((id) => folders.find((f) => f.id === id))
      .filter((f): f is FolderItem => !!f)
      .slice(0, 4);
  }, [folders, recentIds, pinnedIds, search]);

  // Main user/ai sections (exclude pinned to avoid duplication)
  const pinSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);

  const userFolders = useMemo(() => {
    const list = folders.filter((f) => f.owner === "user" && !pinSet.has(f.id));
    return applySort(applySearch(list));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, sort, search, previews, pinSet]);

  const aiFolders = useMemo(() => {
    const list = folders.filter((f) => f.owner === "ai" && !pinSet.has(f.id));
    return applySort(applySearch(list));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, sort, search, previews, pinSet]);

  // ── Actions ─────────────────────────────────────────────────────────
  function openFolder(f: FolderItem | "inbox") {
    if (f !== "inbox") trackVisit(f.id);
    setViewing(f);
  }

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

  const hasSearchResults = userFolders.length + aiFolders.length > 0;
  const noMatchesAtAll   = !!search.trim() && !hasSearchResults;

  return (
    <div className="overflow-y-auto pb-[76px]">

      {/* ── HEADER ── */}
      <div className="px-5 pt-14 pb-3">
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

        {/* Search + Sort row */}
        <div className="relative mt-4 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-full bg-[#fbfaf6] dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] px-4 py-[9px] shadow-[0_1px_2px_rgba(74,64,54,0.05)] focus-within:shadow-[0_0_0_2px_rgba(155,134,156,0.25)] transition-shadow">
            <Search size={14} className="flex-shrink-0 text-[#9b869c]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr.foldersSearch}
              className="flex-1 bg-transparent text-[13px] text-[#4a4036] dark:text-[#e8ddd4] placeholder:text-[#b0a396] dark:placeholder:text-[#6e6460] outline-none"
            />
            <button
              onClick={() => setSearch("")}
              className={`flex-shrink-0 transition-all ${
                search ? "opacity-100 scale-100" : "opacity-0 scale-75 pointer-events-none"
              }`}
              aria-label="Clear"
            >
              <X size={13} className="text-[#b0a396]" />
            </button>
          </div>

          <button
            onClick={() => setSortOpen((v) => !v)}
            aria-label={tr.foldersSortBy}
            className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#fbfaf6] dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] text-[#9b869c] active:scale-95 transition-transform shadow-[0_1px_2px_rgba(74,64,54,0.05)]"
          >
            <ArrowDownWideNarrow size={14} />
            {sort !== "recent" && (
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[#9b869c]" />
            )}
          </button>

          {/* Sort dropdown */}
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSortOpen(false)} />
              <div className="absolute right-0 top-full mt-2 z-40 w-44 rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] shadow-lg overflow-hidden fade-up">
                <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">
                  {tr.foldersSortBy}
                </p>
                {SORT_OPTIONS.map((opt) => {
                  const isActive = sort === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => { setSort(opt.id); setSortOpen(false); }}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-left active:bg-[#f4f3ee] dark:active:bg-[#2a2724] transition-colors ${
                        isActive ? "text-[#9b869c]" : "text-[#4a4036] dark:text-[#e8ddd4]"
                      }`}
                    >
                      <span className={`text-[13px] ${isActive ? "font-bold" : "font-medium"}`}>
                        {opt.label}
                      </span>
                      {isActive && <Check size={14} strokeWidth={2.5} />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── INBOX (promoted, only when not searching) ── */}
      {!search.trim() && (
        <section className="px-5 mb-6">
          <button
            onClick={() => openFolder("inbox")}
            className="relative w-full flex items-center gap-4 rounded-2xl border border-[#9b869c]/20 dark:border-[#9b869c]/30 bg-gradient-to-br from-[#9b869c]/[0.09] via-[#fbfaf6] to-[#9b869c]/[0.04] dark:from-[#9b869c]/15 dark:via-[#252220] dark:to-[#9b869c]/[0.08] px-4 py-4 text-left active:scale-[0.98] transition-transform"
          >
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#9b869c] shadow-[0_4px_12px_rgba(155,134,156,0.28)]">
              <Inbox size={22} className="text-white" strokeWidth={2.2} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold text-[#4a4036] dark:text-[#e8ddd4] leading-tight">
                {tr.unsortedInbox}
              </p>
              <p className="text-[12px] text-[#b0a396] dark:text-[#6e6460] mt-0.5">
                {loading
                  ? "Loading…"
                  : unsortedCount === 0
                    ? tr.unsortedFiles
                    : `${unsortedCount} ${tr.unsortedFiles}`}
              </p>
            </div>
            {!loading && unsortedCount > 0 && (
              <span className="rounded-full bg-[#9b869c] text-white text-[12px] font-bold px-2.5 py-1 leading-none min-w-[26px] text-center">
                {unsortedCount > 99 ? "99+" : unsortedCount}
              </span>
            )}
          </button>
        </section>
      )}

      {/* ── PINNED (compact horizontal chip row) ── */}
      {pinnedFolders.length > 0 && (
        <section className="mb-6">
          <div className="px-5 mb-2.5 flex items-center gap-1.5">
            <Pin size={10} className="text-[#9b869c]" strokeWidth={2.5} fill="currentColor" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9b869c]">
              {tr.foldersPinned}
            </p>
          </div>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide px-5 pb-1">
            {pinnedFolders.map((folder, i) => (
              <PinnedChip
                key={folder.id}
                folder={folder}
                index={i}
                prefsVersion={prefsTick}
                onClick={() => openFolder(folder)}
                onLongPress={() => setActiveFolder(folder)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── RECENT VISITED ── */}
      {recentVisited.length > 0 && (
        <section className="px-5 mb-6">
          <div className="mb-3 flex items-center gap-1.5">
            <History size={10} className="text-[#9b869c]" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9b869c]">
              {tr.foldersRecentVisited}
            </p>
          </div>
          <FolderGrid>
            {recentVisited.map((folder, i) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                index={i}
                preview={previews[folder.id]}
                prefsVersion={prefsTick}
                onClick={() => openFolder(folder)}
                onMore={() => setActiveFolder(folder)}
              />
            ))}
          </FolderGrid>
        </section>
      )}

      {/* ── USER FOLDERS ── */}
      {(userFolders.length > 0 || (!search.trim() && !loading)) && (
        <section className="px-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">
            {tr.yours}
          </p>
          {loading ? (
            <FolderGrid>{Array.from({ length: 2 }).map((_, i) => <FolderSkeleton key={i} />)}</FolderGrid>
          ) : userFolders.length === 0 && !search.trim() ? (
            <EmptyFolders onNew={() => setCreateOpen(true)} label={tr.noFoldersYet} createLabel={tr.createFirst} />
          ) : (
            <FolderGrid>
              {userFolders.map((folder, i) => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  index={i}
                  preview={previews[folder.id]}
                  prefsVersion={prefsTick}
                  onClick={() => openFolder(folder)}
                  onMore={() => setActiveFolder(folder)}
                />
              ))}
            </FolderGrid>
          )}
        </section>
      )}

      {/* ── AI FOLDERS ── */}
      {(loading || aiFolders.length > 0) && (
        <section className="mt-6 px-5">
          <div className="mb-3 flex items-center gap-1.5">
            <Sparkles size={11} className="text-[#d99c5b]" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#d99c5b]">
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
                  preview={previews[folder.id]}
                  prefsVersion={prefsTick}
                  onClick={() => openFolder(folder)}
                  onMore={() => setActiveFolder(folder)}
                />
              ))}
            </FolderGrid>
          )}
        </section>
      )}

      {/* ── NO MATCHES (search) ── */}
      {noMatchesAtAll && (
        <div className="flex flex-col items-center pt-12 gap-3 px-8 text-center">
          <div className="h-14 w-14 rounded-2xl bg-[#e0d8cc]/50 dark:bg-[#3a3430]/50 flex items-center justify-center">
            <Search size={26} className="text-[#b0a396]" />
          </div>
          <p className="text-[14px] font-medium text-[#b0a396] dark:text-[#6e6460]">
            {tr.foldersNoMatch} <span className="text-[#4a4036] dark:text-[#e8ddd4]">&ldquo;{search}&rdquo;</span>
          </p>
        </div>
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
          onOpen={() => { setActiveFolder(null); openFolder(activeFolder); }}
          onRenamed={() => { setActiveFolder(null); onRefresh(); }}
          onDeleted={() => { setActiveFolder(null); onRefresh(); }}
          onPrefsChanged={() => setPrefsTick((t) => t + 1)}
        />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function FolderGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

// Compact pinned-folder chip for the horizontal shortcut row.
// Long-press opens the actions sheet (same gesture as in folder-viewer).
const CHIP_LONG_PRESS_MS = 450;

function PinnedChip({
  folder, index, prefsVersion = 0, onClick, onLongPress,
}: {
  folder: FolderItem;
  index: number;
  prefsVersion?: number;
  onClick: () => void;
  onLongPress: () => void;
}) {
  const isAi = folder.owner === "ai";
  const [colorId, setColorId] = useState<string>("default");
  const [emoji,   setEmoji]   = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || isAi) return;
    setColorId(getFolderColor(folder.id));
    setEmoji(getFolderEmoji(folder.id));
  }, [folder.id, isAi, prefsVersion]);

  const accent = isAi ? "#d99c5b" : getColorHex(colorId);

  // Long-press tracking
  const timer = useRef<number | null>(null);
  const fired = useRef(false);

  function handlePressStart() {
    fired.current = false;
    timer.current = window.setTimeout(() => {
      fired.current = true;
      onLongPress();
      try { navigator.vibrate?.(35); } catch { /* ignore */ }
    }, CHIP_LONG_PRESS_MS);
  }
  function handlePressEnd() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }
  function handleClick() {
    if (fired.current) { fired.current = false; return; }
    onClick();
  }

  return (
    <button
      onClick={handleClick}
      onPointerDown={handlePressStart}
      onPointerUp={handlePressEnd}
      onPointerLeave={handlePressEnd}
      onPointerCancel={handlePressEnd}
      onContextMenu={(e) => { e.preventDefault(); onLongPress(); }}
      className="flex-shrink-0 flex items-center gap-2 rounded-full bg-[#fbfaf6] dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] pl-2 pr-3.5 py-1.5 active:scale-95 transition-transform shadow-[0_1px_2px_rgba(74,64,54,0.05)]"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <span
        className="flex h-6 w-6 items-center justify-center rounded-full text-[14px] leading-none"
        style={{ background: `${accent}1f` }}
      >
        {emoji ? (
          <span>{emoji}</span>
        ) : isAi ? (
          <Sparkles size={12} style={{ color: accent }} strokeWidth={2.4} />
        ) : (
          <Folder size={12} style={{ color: accent }} strokeWidth={2.4} />
        )}
      </span>
      <span className="truncate max-w-[120px] text-[13px] font-semibold text-[#4a4036] dark:text-[#e8ddd4]">
        {folder.name}
      </span>
    </button>
  );
}

function FolderSkeleton() {
  return (
    <div className="rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] overflow-hidden animate-pulse">
      <div className="aspect-[5/3] bg-[#e0d8cc]/40 dark:bg-[#3a3430]/40" />
      <div className="px-3 py-2.5 space-y-1.5">
        <div className="h-3 w-3/4 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
        <div className="h-2.5 w-1/2 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
      </div>
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
