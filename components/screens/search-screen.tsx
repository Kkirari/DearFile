"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
} from "lucide-react";
import { FileDetailSheet } from "@/components/file-detail-sheet";
import { ImageLightbox } from "@/components/image-lightbox";
import { useLanguage } from "@/providers/language-provider";
import { formatBytes, getFileIcon } from "@/lib/utils";
import type { FileItem } from "@/types/file";
import type { FolderItem } from "@/types/folder";
import type { FileType } from "@/lib/mock-data";

// ── Category suggestion chips ──────────────────────────────────────────────────

const SUGGESTIONS_EN = [
  { label: "🖼️ Photos",      query: "photo"      },
  { label: "📄 Documents",   query: "document"   },
  { label: "💳 Finance",     query: "finance"    },
  { label: "📚 Academic",    query: "academic"   },
  { label: "🧾 Receipts",    query: "receipt"    },
  { label: "📑 Invoices",    query: "invoice"    },
  { label: "📸 Screenshots", query: "screenshot" },
];

const SUGGESTIONS_TH = [
  { label: "🖼️ รูปภาพ",      query: "รูป"        },
  { label: "📄 เอกสาร",      query: "document"   },
  { label: "💳 การเงิน",     query: "finance"    },
  { label: "📚 วิชาการ",     query: "academic"   },
  { label: "🧾 ใบเสร็จ",     query: "ใบเสร็จ"    },
  { label: "📑 ใบแจ้งหนี้",  query: "ใบแจ้งหนี้" },
  { label: "📸 สกรีนช็อต",   query: "screenshot" },
];

// ── File type icon map ─────────────────────────────────────────────────────────

const FILE_TYPE_CONFIG: Record<FileType, { icon: React.ElementType; bg: string; color: string }> = {
  pdf:     { icon: FileText,  bg: "bg-red-50 dark:bg-red-950/40",         color: "text-red-500"     },
  image:   { icon: ImageIcon, bg: "bg-blue-50 dark:bg-blue-950/40",       color: "text-blue-500"    },
  doc:     { icon: FileText,  bg: "bg-emerald-50 dark:bg-emerald-950/40", color: "text-emerald-500" },
  video:   { icon: Film,      bg: "bg-violet-50 dark:bg-violet-950/40",   color: "text-violet-500"  },
  audio:   { icon: Music,     bg: "bg-pink-50 dark:bg-pink-950/40",       color: "text-pink-500"    },
  archive: { icon: Archive,   bg: "bg-amber-50 dark:bg-amber-950/40",     color: "text-amber-500"   },
};

// ── View states ────────────────────────────────────────────────────────────────

type ViewState = "idle" | "loading" | "results" | "empty";

// ── Props ──────────────────────────────────────────────────────────────────────

interface SearchScreenProps {
  onBack: () => void;
  folders: FolderItem[];
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SearchScreen({ onBack, folders }: SearchScreenProps) {
  const { lang, tr } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery]               = useState("");
  const [debouncedQuery, setDebounced]  = useState("");
  const [results, setResults]           = useState<FileItem[]>([]);
  const [viewState, setViewState]       = useState<ViewState>("idle");
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [lightboxFile, setLightboxFile] = useState<FileItem | null>(null);

  // Key incremented each time results arrive — forces re-mount of list so
  // card-enter animations retrigger on every new search
  const [listKey, setListKey] = useState(0);

  const suggestions = lang === "th" ? SUGGESTIONS_TH : SUGGESTIONS_EN;

  // Auto-focus on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  // Debounce: 350 ms
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Fetch on debounced change
  useEffect(() => {
    if (!debouncedQuery) {
      setResults([]);
      setViewState("idle");
      return;
    }
    let cancelled = false;
    setViewState("loading");
    fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then((r) => r.json())
      .then((data: { files?: FileItem[] }) => {
        if (cancelled) return;
        const files = data.files ?? [];
        setResults(files);
        setListKey((k) => k + 1);
        setViewState(files.length > 0 ? "results" : "empty");
      })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  const handleClear = useCallback(() => {
    setQuery("");
    setResults([]);
    setViewState("idle");
    inputRef.current?.focus();
  }, []);

  const handleSuggestion = useCallback((q: string) => {
    setQuery(q);
    // Don't blur — keep keyboard open
  }, []);

  const countLabel = results.length === 1
    ? `1 ${tr.searchResultCount}`
    : `${results.length} ${tr.searchResultCountPlural}`;

  return (
    <>
    <div className="screen-enter flex flex-col min-h-dvh bg-[#f4f3ee] dark:bg-[#1c1a18]">

      {/* ── SEARCH HEADER ── */}
      <div className="bg-[#f4f3ee] dark:bg-[#1c1a18] px-4 pt-14 pb-3 border-b border-[#e0d8cc] dark:border-[#3a3430]">
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
          <div className="flex flex-1 items-center gap-2.5 rounded-full bg-white dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] px-4 py-[10px] shadow-[0_1px_3px_rgba(74,64,54,0.06)] transition-shadow focus-within:shadow-[0_0_0_2px_rgba(155,134,156,0.3)]">
            <Search
              size={15}
              className={`flex-shrink-0 transition-colors duration-200 ${query ? "text-[#9b869c]" : "text-[#c0b4a8]"}`}
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr.searchPlaceholder}
              className="flex-1 bg-transparent text-sm text-[#4a4036] dark:text-[#e8ddd4] placeholder:text-[#b0a396] dark:placeholder:text-[#6e6460] outline-none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {/* Clear button — fades in/out */}
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
        </div>
      </div>

      {/* ── BODY ── */}
      <div className="flex-1 overflow-y-auto pb-[76px]">

        {/* ── Idle: category chips + hint ── */}
        {viewState === "idle" && (
          <div className="px-5 pt-6">
            <div className="fade-up flex items-center gap-1.5 mb-3">
              <Sparkles size={13} className="text-[#9b869c]" />
              <span className="text-[12px] font-semibold uppercase tracking-wider text-[#9b869c]">
                {tr.searchCategories}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s, i) => (
                <button
                  key={s.query}
                  onClick={() => handleSuggestion(s.query)}
                  className="fade-up rounded-full bg-white dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] px-4 py-[8px] text-[13px] font-medium text-[#4a4036] dark:text-[#e8ddd4] shadow-[0_1px_2px_rgba(74,64,54,0.05)] active:scale-95 transition-transform"
                  style={{ animationDelay: `${i * 45}ms` }}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Search hint */}
            <div className="fade-up mt-10 flex flex-col items-center text-center gap-2" style={{ animationDelay: "320ms" }}>
              <div className="h-14 w-14 rounded-2xl bg-[#9b869c]/10 flex items-center justify-center mb-1">
                <Search size={26} className="text-[#9b869c]/50" />
              </div>
              <p className="text-[14px] font-medium text-[#b0a396] dark:text-[#6e6460]">
                {tr.searchEmpty}
              </p>
              {/* Language badge */}
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#9b869c]/10 px-3 py-1 text-[11px] font-medium text-[#9b869c]">
                🇹🇭 Thai &amp; 🇬🇧 English
              </span>
            </div>
          </div>
        )}

        {/* ── Loading: shimmer rows ── */}
        {viewState === "loading" && (
          <div className="px-5 pt-5 space-y-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <SearchRowSkeleton key={i} delay={i * 40} />
            ))}
          </div>
        )}

        {/* ── Results ── */}
        {viewState === "results" && (
          <div key={listKey} className="px-5 pt-4">
            <p className="fade-up mb-3 text-[12px] font-semibold uppercase tracking-wider text-[#9b869c]">
              {countLabel}
            </p>
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
          </div>
        )}

        {/* ── Empty results ── */}
        {viewState === "empty" && (
          <div className="fade-up flex flex-col items-center pt-20 gap-3 text-center px-8">
            <div className="h-14 w-14 rounded-2xl bg-[#e0d8cc]/50 dark:bg-[#3a3430]/50 flex items-center justify-center">
              <Search size={26} className="text-[#b0a396]" />
            </div>
            <p className="text-[14px] font-medium text-[#b0a396] dark:text-[#6e6460]">
              {tr.searchNoResults}{" "}
              <span className="text-[#4a4036] dark:text-[#e8ddd4]">
                &ldquo;{debouncedQuery}&rdquo;
              </span>
            </p>
          </div>
        )}
      </div>
    </div>

    {/* ── FILE DETAIL SHEET ── (rendered OUTSIDE the screen-enter container
         so the slide-in transform doesn't trap it under the bottom nav) */}
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

    {/* ── IMAGE LIGHTBOX ── */}
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
  file: FileItem;
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
  const matchIdx   = lowerName.indexOf(lowerQuery);

  return (
    <button
      onClick={onClick}
      className="card-enter w-full flex items-center gap-3 rounded-2xl bg-white dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] px-4 py-3 shadow-[0_1px_3px_rgba(74,64,54,0.06)] text-left active:scale-[0.98] transition-transform"
      style={{ animationDelay: `${index * 35}ms` }}
    >
      {/* Thumbnail or icon */}
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

      {/* Name + meta */}
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
        <p className="mt-0.5 text-[12px] text-[#b0a396] dark:text-[#6e6460]">
          {formatBytes(file.size)} · {timeAgo(file.createdAt)}
        </p>
      </div>
    </button>
  );
}

// ── Skeleton row ───────────────────────────────────────────────────────────────

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
