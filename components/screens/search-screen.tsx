"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  ArrowLeft,
  Search,
  X,
  FileText,
  Film,
  Music,
  Archive,
  Image as ImageIcon,
  Sparkles,
  Clock,
  ArrowDownWideNarrow,
  Check,
  History,
  Trash2,
} from "lucide-react";
import { FileDetailSheet } from "@/components/file-detail-sheet";
import { ImageLightbox } from "@/components/image-lightbox";
import { useLanguage } from "@/providers/language-provider";
import { formatBytes, getFileIcon } from "@/lib/utils";
import type { FileItem } from "@/types/file";
import type { FolderItem } from "@/types/folder";
import type { FileType } from "@/lib/mock-data";

// ── Types ──────────────────────────────────────────────────────────────────────

type FilterMode = "all" | "photos" | "documents" | "finance" | "academic";
type SortMode   = "relevance" | "newest" | "oldest" | "largest";
type ViewState  = "idle" | "loading" | "results" | "empty";

interface SearchFile extends FileItem {
  score?: number;
  matchedIn?: string[];
  category?: string;
}

const RECENT_KEY     = "dearfile.searchRecent";
const RECENT_LIMIT   = 6;
const SEARCH_DEBOUNCE = 350;
const SUGGEST_DEBOUNCE = 180;

// ── File type icon map ─────────────────────────────────────────────────────────

const FILE_TYPE_CONFIG: Record<FileType, { icon: React.ElementType; bg: string; color: string }> = {
  pdf:     { icon: FileText,  bg: "bg-red-50 dark:bg-red-950/40",         color: "text-red-500"     },
  image:   { icon: ImageIcon, bg: "bg-blue-50 dark:bg-blue-950/40",       color: "text-blue-500"    },
  doc:     { icon: FileText,  bg: "bg-emerald-50 dark:bg-emerald-950/40", color: "text-emerald-500" },
  video:   { icon: Film,      bg: "bg-violet-50 dark:bg-violet-950/40",   color: "text-violet-500"  },
  audio:   { icon: Music,     bg: "bg-pink-50 dark:bg-pink-950/40",       color: "text-pink-500"    },
  archive: { icon: Archive,   bg: "bg-amber-50 dark:bg-amber-950/40",     color: "text-amber-500"   },
};

// ── Recent searches localStorage helpers ──────────────────────────────────────

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

function saveRecent(list: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_LIMIT))); }
  catch { /* ignore */ }
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface SearchScreenProps {
  onBack: () => void;
  folders: FolderItem[];
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SearchScreen({ onBack, folders }: SearchScreenProps) {
  const { lang, tr } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);

  // Search state
  const [query, setQuery]                 = useState("");
  const [debouncedQuery, setDebounced]    = useState("");
  const [results, setResults]             = useState<SearchFile[]>([]);
  const [counts, setCounts]               = useState<Record<FilterMode, number>>({
    all: 0, photos: 0, documents: 0, finance: 0, academic: 0,
  });
  const [viewState, setViewState]         = useState<ViewState>("idle");

  // Filter / sort
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort,   setSort]   = useState<SortMode>("relevance");
  const [sortOpen, setSortOpen] = useState(false);

  // Suggestions + Recent
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [recents, setRecents]         = useState<string[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);

  // File interaction
  const [selectedFile, setSelectedFile] = useState<SearchFile | null>(null);
  const [lightboxFile, setLightboxFile] = useState<SearchFile | null>(null);

  // Animation re-trigger key
  const [listKey, setListKey] = useState(0);

  // Categories (Thai/EN)
  const FILTER_CHIPS = useMemo<{ id: FilterMode; label: string; emoji: string }[]>(() => [
    { id: "all",       label: tr.searchFilterAll,       emoji: "✨" },
    { id: "photos",    label: tr.searchFilterPhotos,    emoji: "📸" },
    { id: "documents", label: tr.searchFilterDocs,      emoji: "📄" },
    { id: "finance",   label: tr.searchFilterFinance,   emoji: "💳" },
    { id: "academic",  label: tr.searchFilterAcademic,  emoji: "🎓" },
  ], [tr]);

  const SORT_OPTIONS = useMemo<{ id: SortMode; label: string }[]>(() => [
    { id: "relevance", label: tr.searchSortRelevance },
    { id: "newest",    label: tr.searchSortNewest    },
    { id: "oldest",    label: tr.searchSortOldest    },
    { id: "largest",   label: tr.searchSortLargest   },
  ], [tr]);

  // ── Effects ────────────────────────────────────────────────────────────────

  // Auto-focus + load recents
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    setRecents(loadRecent());
    return () => clearTimeout(t);
  }, []);

  // Debounced query for search
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE);
    return () => clearTimeout(t);
  }, [query]);

  // Suggestions (separate, faster debounce)
  useEffect(() => {
    if (!query.trim() || !showSuggest) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`/api/search/suggest?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((data: { suggestions?: string[] }) => {
          if (!cancelled) setSuggestions(data.suggestions ?? []);
        })
        .catch(() => { if (!cancelled) setSuggestions([]); });
    }, SUGGEST_DEBOUNCE);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, showSuggest]);

  // Main search fetch
  useEffect(() => {
    // No query AND no active filter → idle
    if (!debouncedQuery && filter === "all") {
      setResults([]);
      setViewState("idle");
      // Still fetch counts so chips have badges
      fetch("/api/search?q=").then((r) => r.json())
        .then((d: { counts?: Record<FilterMode, number> }) => {
          if (d.counts) setCounts(d.counts);
        }).catch(() => {});
      return;
    }

    let cancelled = false;
    setViewState("loading");
    const params = new URLSearchParams({
      q: debouncedQuery,
      filter,
      sort,
    });
    fetch(`/api/search?${params}`)
      .then((r) => r.json())
      .then((data: { files?: SearchFile[]; counts?: Record<FilterMode, number> }) => {
        if (cancelled) return;
        const files = data.files ?? [];
        setResults(files);
        if (data.counts) setCounts(data.counts);
        setListKey((k) => k + 1);
        setViewState(files.length > 0 ? "results" : "empty");
      })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [debouncedQuery, filter, sort]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    setQuery("");
    setSuggestions([]);
    setShowSuggest(false);
    setFilter("all");
    inputRef.current?.focus();
  }, []);

  const handleSubmitQuery = useCallback((q: string) => {
    setQuery(q);
    setShowSuggest(false);
    if (q.trim().length > 1) {
      const next = [q.trim(), ...recents.filter((r) => r !== q.trim())].slice(0, RECENT_LIMIT);
      setRecents(next);
      saveRecent(next);
    }
  }, [recents]);

  const handleClearRecent = useCallback(() => {
    setRecents([]);
    saveRecent([]);
  }, []);

  const handleRemoveRecent = useCallback((q: string) => {
    const next = recents.filter((r) => r !== q);
    setRecents(next);
    saveRecent(next);
  }, [recents]);

  // Group results by category for results view
  const groupedResults = useMemo(() => {
    if (sort !== "relevance" || filter !== "all") return null;
    const groups: Record<string, SearchFile[]> = {};
    for (const f of results) {
      const cat = f.category ?? "other";
      (groups[cat] ??= []).push(f);
    }
    return Object.entries(groups).sort(([, a], [, b]) => b.length - a.length);
  }, [results, sort, filter]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const showFilterChips = viewState !== "idle" || filter !== "all";

  return (
    <>
      <div className="screen-enter flex flex-col min-h-dvh bg-[#f4f3ee] dark:bg-[#1c1a18]">

        {/* ── HEADER ── */}
        <div className="relative bg-[#f4f3ee] dark:bg-[#1c1a18] px-4 pt-14 pb-3 border-b border-[#e0d8cc] dark:border-[#3a3430]">
          <div className="flex items-center gap-3">
            {/* Back */}
            <button
              onClick={onBack}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[#4a4036] dark:text-[#e8ddd4] active:bg-[#e0d8cc]/60 dark:active:bg-[#3a3430]/60 transition-colors"
              aria-label={tr.searchBack}
            >
              <ArrowLeft size={20} strokeWidth={2} />
            </button>

            {/* Input pill */}
            <div className="relative flex-1">
              <div className="flex items-center gap-2.5 rounded-full bg-white dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] px-4 py-[10px] shadow-[0_1px_3px_rgba(74,64,54,0.06)] transition-shadow focus-within:shadow-[0_0_0_2px_rgba(155,134,156,0.3)]">
                <Search
                  size={15}
                  className={`flex-shrink-0 transition-colors duration-200 ${query ? "text-[#9b869c]" : "text-[#c0b4a8]"}`}
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setShowSuggest(true); }}
                  onFocus={() => setShowSuggest(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmitQuery(query);
                    if (e.key === "Escape") {
                      if (showSuggest) setShowSuggest(false);
                      else handleClear();
                    }
                  }}
                  placeholder={tr.searchPlaceholder}
                  className="flex-1 bg-transparent text-sm text-[#4a4036] dark:text-[#e8ddd4] placeholder:text-[#b0a396] dark:placeholder:text-[#6e6460] outline-none"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  onClick={handleClear}
                  aria-label="Clear"
                  className={`flex-shrink-0 rounded-full p-0.5 text-[#b0a396] hover:text-[#4a4036] dark:hover:text-[#e8ddd4] transition-all duration-200 ${
                    query ? "opacity-100 scale-100" : "opacity-0 scale-75 pointer-events-none"
                  }`}
                >
                  <X size={14} />
                </button>
              </div>

              {/* Autocomplete dropdown */}
              {showSuggest && suggestions.length > 0 && query.trim() && (
                <div className="absolute left-0 right-0 top-full mt-2 z-30 rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#252220] shadow-lg overflow-hidden fade-up">
                  {suggestions.map((s, i) => {
                    const idx = s.toLowerCase().indexOf(query.toLowerCase());
                    return (
                      <button
                        key={`${s}-${i}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSubmitQuery(s)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-[#f4f3ee] dark:active:bg-[#2a2724] transition-colors border-b border-[#e0d8cc]/50 dark:border-[#3a3430]/50 last:border-0"
                      >
                        <Search size={13} className="flex-shrink-0 text-[#9b869c]" />
                        <span className="text-[14px] text-[#4a4036] dark:text-[#e8ddd4] truncate">
                          {idx >= 0 ? (
                            <>
                              {s.slice(0, idx)}
                              <span className="font-bold text-[#9b869c]">
                                {s.slice(idx, idx + query.length)}
                              </span>
                              {s.slice(idx + query.length)}
                            </>
                          ) : s}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sort button — only when results visible */}
            {(viewState === "results" || viewState === "loading") && (
              <button
                onClick={() => setSortOpen((v) => !v)}
                aria-label={tr.searchSortBy}
                className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] text-[#9b869c] active:scale-95 transition-transform"
              >
                <ArrowDownWideNarrow size={15} />
                {sort !== "relevance" && (
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[#9b869c]" />
                )}
              </button>
            )}
          </div>

          {/* Filter chips */}
          {showFilterChips && (
            <div className="mt-3 flex gap-1.5 overflow-x-auto scrollbar-hide -mx-4 px-4">
              {FILTER_CHIPS.map((chip) => {
                const isActive = filter === chip.id;
                const count    = counts[chip.id] ?? 0;
                const hasItems = chip.id === "all" || count > 0;
                if (!hasItems && !isActive) return null;
                return (
                  <button
                    key={chip.id}
                    onClick={() => setFilter(chip.id)}
                    className={`flex-shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-all ${
                      isActive
                        ? "bg-[#9b869c] text-white border-transparent shadow-sm"
                        : "bg-white dark:bg-[#252220] text-[#4a4036] dark:text-[#e8ddd4] border-[#e0d8cc] dark:border-[#3a3430]"
                    }`}
                  >
                    <span>{chip.emoji}</span>
                    <span>{chip.label}</span>
                    {chip.id !== "all" && count > 0 && (
                      <span className={`rounded-full px-1.5 text-[10px] font-bold ${
                        isActive ? "bg-white/25 text-white" : "bg-[#9b869c]/15 text-[#9b869c]"
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Sort dropdown */}
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSortOpen(false)} />
              <div className="absolute right-4 top-[110px] z-40 w-44 rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#252220] shadow-lg overflow-hidden fade-up">
                <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">
                  {tr.searchSortBy}
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

        {/* ── BODY ── */}
        <div
          className="flex-1 overflow-y-auto pb-[76px]"
          onClick={() => showSuggest && setShowSuggest(false)}
        >

          {/* IDLE: recents + categories */}
          {viewState === "idle" && (
            <div className="px-5 pt-5">
              {/* Recent searches */}
              {recents.length > 0 && (
                <section className="fade-up mb-7">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      <History size={13} className="text-[#9b869c]" />
                      <span className="text-[12px] font-semibold uppercase tracking-wider text-[#9b869c]">
                        {tr.searchRecent}
                      </span>
                    </div>
                    <button
                      onClick={handleClearRecent}
                      className="text-[11px] font-medium text-[#b0a396] active:text-[#4a4036]"
                    >
                      {tr.searchClearRecent}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recents.map((r, i) => (
                      <div
                        key={`${r}-${i}`}
                        className="fade-up group flex items-center gap-1.5 rounded-full bg-white dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] pl-3 pr-1 py-1 text-[13px] font-medium text-[#4a4036] dark:text-[#e8ddd4] shadow-[0_1px_2px_rgba(74,64,54,0.05)]"
                        style={{ animationDelay: `${i * 30}ms` }}
                      >
                        <button
                          onClick={() => handleSubmitQuery(r)}
                          className="active:scale-95 transition-transform"
                        >
                          <Clock size={11} className="inline mr-1.5 text-[#9b869c]" />
                          {r}
                        </button>
                        <button
                          onClick={() => handleRemoveRecent(r)}
                          className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[#b0a396] active:bg-[#e0d8cc] dark:active:bg-[#3a3430] transition-colors"
                          aria-label="Remove"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Category suggestions */}
              <section>
                <div className="fade-up flex items-center gap-1.5 mb-3">
                  <Sparkles size={13} className="text-[#9b869c]" />
                  <span className="text-[12px] font-semibold uppercase tracking-wider text-[#9b869c]">
                    {tr.searchCategories}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {FILTER_CHIPS.filter((c) => c.id !== "all").map((chip, i) => {
                    const count = counts[chip.id] ?? 0;
                    return (
                      <button
                        key={chip.id}
                        onClick={() => setFilter(chip.id)}
                        disabled={count === 0}
                        className="fade-up flex items-center gap-2.5 rounded-2xl bg-white dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] px-3 py-2.5 text-left active:scale-95 disabled:opacity-40 disabled:active:scale-100 transition-transform shadow-[0_1px_2px_rgba(74,64,54,0.05)]"
                        style={{ animationDelay: `${60 + i * 40}ms` }}
                      >
                        <span className="text-[20px]">{chip.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-[#4a4036] dark:text-[#e8ddd4] truncate">
                            {chip.label}
                          </p>
                          <p className="text-[10.5px] text-[#b0a396] dark:text-[#6e6460]">
                            {count} {count === 1 ? tr.searchResultCount : tr.searchResultCountPlural}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Hint */}
              <div className="fade-up mt-10 flex flex-col items-center text-center gap-2" style={{ animationDelay: "320ms" }}>
                <div className="h-14 w-14 rounded-2xl bg-[#9b869c]/10 flex items-center justify-center mb-1">
                  <Search size={26} className="text-[#9b869c]/50" />
                </div>
                <p className="text-[14px] font-medium text-[#b0a396] dark:text-[#6e6460]">
                  {tr.searchEmpty}
                </p>
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#9b869c]/10 px-3 py-1 text-[11px] font-medium text-[#9b869c]">
                  🇹🇭 {lang === "th" ? "ไทย" : "Thai"} & 🇬🇧 {lang === "th" ? "อังกฤษ" : "English"}
                </span>
              </div>
            </div>
          )}

          {/* LOADING */}
          {viewState === "loading" && (
            <div className="px-5 pt-5 space-y-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <SearchRowSkeleton key={i} delay={i * 40} />
              ))}
            </div>
          )}

          {/* RESULTS */}
          {viewState === "results" && (
            <div key={listKey} className="px-5 pt-4">
              <p className="fade-up mb-3 text-[12px] font-semibold uppercase tracking-wider text-[#9b869c]">
                {results.length} {results.length === 1 ? tr.searchResultCount : tr.searchResultCountPlural}
              </p>

              {/* Grouped (relevance + all filter) */}
              {groupedResults ? (
                <div className="space-y-5">
                  {groupedResults.map(([cat, files]) => (
                    <section key={cat}>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">
                        {categoryLabel(cat, lang)}
                      </p>
                      <div className="space-y-2">
                        {files.map((file, i) => (
                          <SearchResultRow
                            key={file.id}
                            file={file}
                            index={i}
                            query={debouncedQuery}
                            onClick={() => setSelectedFile(file)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {results.map((file, i) => (
                    <SearchResultRow
                      key={file.id}
                      file={file}
                      index={i}
                      query={debouncedQuery}
                      onClick={() => setSelectedFile(file)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* EMPTY */}
          {viewState === "empty" && (
            <div className="fade-up flex flex-col items-center pt-20 gap-3 text-center px-8">
              <div className="h-14 w-14 rounded-2xl bg-[#e0d8cc]/50 dark:bg-[#3a3430]/50 flex items-center justify-center">
                <Search size={26} className="text-[#b0a396]" />
              </div>
              <p className="text-[14px] font-medium text-[#b0a396] dark:text-[#6e6460]">
                {debouncedQuery ? (
                  <>
                    {tr.searchNoResults}{" "}
                    <span className="text-[#4a4036] dark:text-[#e8ddd4]">
                      &ldquo;{debouncedQuery}&rdquo;
                    </span>
                  </>
                ) : (
                  <>0 {tr.searchResultCountPlural}</>
                )}
              </p>
              <p className="text-[12px] text-[#b0a396] dark:text-[#6e6460]">
                {tr.searchTipTryFilter}
              </p>
              {filter !== "all" && (
                <button
                  onClick={() => setFilter("all")}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#9b869c]/10 px-4 py-2 text-[12px] font-semibold text-[#9b869c] active:scale-95 transition-transform"
                >
                  <Trash2 size={11} />
                  {tr.searchFilterAll}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── FILE DETAIL SHEET — rendered outside transformed container ── */}
      {selectedFile && (
        <FileDetailSheet
          file={selectedFile}
          folders={folders}
          currentFolderId={null}
          onClose={() => setSelectedFile(null)}
          onOpenLightbox={() => setLightboxFile(selectedFile)}
          onDeleted={() => {
            setSelectedFile(null);
            // Re-trigger search to remove deleted file from list
            setDebounced("");
            setTimeout(() => setDebounced(query.trim()), 50);
          }}
          onMoved={() => setSelectedFile(null)}
        />
      )}

      {lightboxFile && (
        <ImageLightbox
          src={lightboxFile.url}
          name={lightboxFile.name}
          onClose={() => setLightboxFile(null)}
        />
      )}
    </>
  );
}

// ── Result row ─────────────────────────────────────────────────────────────────

function SearchResultRow({
  file,
  index,
  query,
  onClick,
}: {
  file: SearchFile;
  index: number;
  query: string;
  onClick: () => void;
}) {
  const type = getFileIcon(file.mimeType) as FileType;
  const cfg  = FILE_TYPE_CONFIG[type] ?? FILE_TYPE_CONFIG.archive;
  const Icon = cfg.icon;
  const isImage = type === "image";

  const name       = file.name;
  const lowerName  = name.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIdx   = query ? lowerName.indexOf(lowerQuery) : -1;

  // Show matched-in chips (e.g. "filename · keyword:coffee")
  const matchTags = file.matchedIn?.slice(0, 2) ?? [];

  return (
    <button
      onClick={onClick}
      className="card-enter w-full flex items-center gap-3 rounded-2xl bg-white dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] px-4 py-3 shadow-[0_1px_3px_rgba(74,64,54,0.06)] text-left active:scale-[0.98] transition-transform"
      style={{ animationDelay: `${index * 35}ms` }}
    >
      {isImage ? (
        <img
          src={file.url}
          alt={file.name}
          className="h-10 w-10 rounded-xl object-cover flex-shrink-0"
        />
      ) : (
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${cfg.bg}`}>
          <Icon size={18} className={cfg.color} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-[#4a4036] dark:text-[#e8ddd4] leading-snug">
          {matchIdx >= 0 ? (
            <>
              {name.slice(0, matchIdx)}
              <mark className="bg-[#9b869c]/20 text-[#4a4036] dark:text-[#e8ddd4] rounded-[3px] px-[2px] not-italic">
                {name.slice(matchIdx, matchIdx + query.length)}
              </mark>
              {name.slice(matchIdx + query.length)}
            </>
          ) : (
            name
          )}
        </p>
        <p className="mt-0.5 text-[12px] text-[#b0a396] dark:text-[#6e6460] flex items-center gap-1.5 flex-wrap">
          <span>{formatBytes(file.size)} · {timeAgo(file.createdAt)}</span>
          {matchTags.map((tag, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-full bg-[#9b869c]/10 px-1.5 py-px text-[10px] font-medium text-[#9b869c]"
            >
              {formatMatchTag(tag)}
            </span>
          ))}
        </p>
      </div>
    </button>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function SearchRowSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div
      className="fade-up flex items-center gap-3 rounded-2xl bg-white dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] px-4 py-3 animate-pulse"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="h-10 w-10 rounded-xl bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60 flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" style={{ width: `${55 + (delay % 3) * 12}%` }} />
        <div className="h-2.5 w-2/5 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatMatchTag(tag: string): string {
  if (tag === "filename") return "📄 name";
  if (tag === "subject")  return "✏️ subject";
  if (tag === "detail")   return "📝 detail";
  if (tag.startsWith("keyword:")) return `🏷️ ${tag.slice(8)}`;
  return tag;
}

function categoryLabel(cat: string, lang: string): string {
  const map: Record<string, { en: string; th: string; emoji: string }> = {
    photo:    { en: "Photos",    th: "รูปภาพ",   emoji: "📸" },
    document: { en: "Documents", th: "เอกสาร",  emoji: "📄" },
    finance:  { en: "Finance",   th: "การเงิน", emoji: "💳" },
    academic: { en: "Academic",  th: "วิชาการ", emoji: "🎓" },
    other:    { en: "Other",     th: "อื่นๆ",    emoji: "📦" },
  };
  const c = map[cat] ?? map.other;
  return `${c.emoji} ${lang === "th" ? c.th : c.en}`;
}
