"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft, ChevronRight, RefreshCw, Sparkles, Loader2,
  Link2, FileText, Film, Music, Archive, Image as ImageIcon,
  Clock, AlertCircle, ExternalLink,
} from "lucide-react";
import { FileDetailSheet } from "@/components/file-detail-sheet";
import { ImageLightbox } from "@/components/image-lightbox";
import { useCaptures } from "@/hooks/use-captures";
import { apiFetch } from "@/lib/api-client";
import { getFileIcon } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";
import type { Capture } from "@/types/capture";
import type { FileItem } from "@/types/file";
import type { FolderItem } from "@/types/folder";

/**
 * Timeline tab (Phase 7.1) — a month calendar over everything captured. Days
 * with files/notes/links show a dot; tapping a day reveals that day's AI
 * summary (the persisted daily recap, generated on-demand for past days) plus
 * its files and captures. Files live in S3 (passed in from home-screen); notes
 * & links come from Neon via useCaptures.
 */

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000; // match server ictDateLabel (UTC+7)

interface TimelineTabProps {
  files: FileItem[];
  filesLoading: boolean;
  folders: FolderItem[];
  onRefresh: () => void;
}

export function TimelineTab({ files, filesLoading, folders, onRefresh }: TimelineTabProps) {
  const { items, loading: capturesLoading, refresh: refreshCaptures } = useCaptures();
  const { tr, lang } = useLanguage();
  const locale = lang === "th" ? "th-TH" : "en-US";

  const today = ictDateOf(new Date().toISOString());
  const [view, setView] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { year: y, month0: m - 1 };
  });
  const [selected, setSelected] = useState(today);

  // File-detail sheet state (mirrors home-tab.tsx).
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [lightboxFile, setLightboxFile] = useState<FileItem | null>(null);

  // Which ICT days have any activity → render a dot under them.
  const activeDates = useMemo(() => {
    const s = new Set<string>();
    for (const f of files) { const d = ictDateOf(f.createdAt); if (d) s.add(d); }
    for (const c of items) { const d = ictDateOf(c.createdAt); if (d) s.add(d); }
    return s;
  }, [files, items]);

  const dayFiles = useMemo(
    () => files.filter((f) => ictDateOf(f.createdAt) === selected),
    [files, selected],
  );
  const dayItems = useMemo(
    () => items.filter((c) => ictDateOf(c.createdAt) === selected),
    [items, selected],
  );
  const dayLinks = dayItems.filter((c) => c.type === "link").length;
  const dayNotes = dayItems.filter((c) => c.type === "note").length;
  const hasContent = dayFiles.length > 0 || dayItems.length > 0;

  const summary = useDaySummary(selected, hasContent);

  const grid = useMemo(() => buildMonthGrid(view.year, view.month0), [view]);
  const weekdays = tr.timelineWeekdays.split(",");
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" })
    .format(new Date(view.year, view.month0, 1));

  function shiftMonth(delta: number) {
    setView((v) => {
      const m = v.month0 + delta;
      return { year: v.year + Math.floor(m / 12), month0: ((m % 12) + 12) % 12 };
    });
  }

  function refreshAll() {
    onRefresh();
    refreshCaptures();
  }

  return (
    <div className="overflow-y-auto pb-[76px]">
      {/* ── HEADER ── */}
      <div className="bg-[#f4f3ee] dark:bg-[#1c1a18] px-5 pt-14 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[26px] font-bold leading-none tracking-tight text-[#4a4036] dark:text-[#e8ddd4]">
              {tr.navTimeline}
            </h1>
            <p className="mt-1.5 text-[13px] text-[#b0a396] dark:text-[#6e6460]">{tr.timelineSubtitle}</p>
          </div>
          <button
            onClick={refreshAll}
            aria-label="Refresh"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] active:scale-95 transition-transform"
          >
            <RefreshCw size={15} className={`text-[#9b869c] ${capturesLoading || filesLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── CALENDAR ── */}
      <div className="px-5">
        <div className="rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] p-3 shadow-[0_1px_3px_rgba(74,64,54,0.06)]">
          {/* month nav */}
          <div className="mb-2 flex items-center justify-between px-1">
            <button onClick={() => shiftMonth(-1)} aria-label="Previous month"
              className="flex h-8 w-8 items-center justify-center rounded-full active:scale-90 transition-transform">
              <ChevronLeft size={18} className="text-[#9b869c]" />
            </button>
            <span className="text-[15px] font-bold capitalize text-[#4a4036] dark:text-[#e8ddd4]">{monthLabel}</span>
            <button onClick={() => shiftMonth(1)} aria-label="Next month"
              className="flex h-8 w-8 items-center justify-center rounded-full active:scale-90 transition-transform">
              <ChevronRight size={18} className="text-[#9b869c]" />
            </button>
          </div>

          {/* weekday row */}
          <div className="grid grid-cols-7 text-center">
            {weekdays.map((w, i) => (
              <span key={i} className="py-1 text-[11px] font-semibold text-[#b0a396] dark:text-[#6e6460]">{w}</span>
            ))}
          </div>

          {/* days */}
          <div className="grid grid-cols-7 gap-y-1">
            {grid.map((date, i) => {
              if (!date) return <span key={i} />;
              const dayNum = Number(date.slice(8, 10));
              const isSelected = date === selected;
              const isToday = date === today;
              const isFuture = date > today;
              const isActive = activeDates.has(date);
              return (
                <div key={i} className="flex flex-col items-center py-0.5">
                  <button
                    disabled={isFuture}
                    onClick={() => setSelected(date)}
                    className={`relative flex h-9 w-9 items-center justify-center rounded-full text-[13px] transition-colors ${
                      isSelected
                        ? "bg-[#9b869c] font-bold text-white"
                        : isToday
                          ? "font-bold text-[#9b869c] ring-1 ring-[#9b869c]/40"
                          : isFuture
                            ? "text-[#cfc7bb] dark:text-[#4a443f]"
                            : "text-[#4a4036] dark:text-[#e8ddd4] active:bg-[#9b869c]/10"
                    }`}
                  >
                    {dayNum}
                  </button>
                  <span
                    aria-hidden
                    className={`mt-0.5 h-[4px] w-[4px] rounded-full transition-opacity ${
                      isActive && !isSelected ? "bg-[#9b869c] opacity-100" : "opacity-0"
                    }`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── DAY DETAIL ── */}
      <div className="px-5 pt-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[16px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">{formatDayHeading(selected, locale)}</h2>
          {hasContent && (
            <span className="text-[12px] text-[#b0a396] dark:text-[#6e6460]">
              {dayFiles.length > 0 && `📎 ${dayFiles.length}  `}
              {dayLinks > 0 && `🔗 ${dayLinks}  `}
              {dayNotes > 0 && `📝 ${dayNotes}`}
            </span>
          )}
        </div>

        {/* summary */}
        {hasContent && (
          <div className="mb-4 rounded-2xl border border-[#9b869c]/20 bg-gradient-to-br from-[#9b869c]/[0.08] to-[#fbfaf6] dark:from-[#9b869c]/15 dark:to-[#252220] p-4">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Sparkles size={13} className="text-[#9b869c]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9b869c]">{tr.timelineSummaryLabel}</span>
            </div>
            {summary.loading ? (
              <div className="flex items-center gap-1.5 py-1 text-[13px] text-[#b0a396] dark:text-[#6e6460]">
                <Loader2 size={13} className="animate-spin" />
                {tr.timelineSummarizing}
              </div>
            ) : summary.data?.text ? (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#4a4036] dark:text-[#d8cabd]">{summary.data.text}</p>
            ) : (
              <p className="text-[13px] text-[#b0a396] dark:text-[#6e6460]">{tr.timelineNoSummary}</p>
            )}
          </div>
        )}

        {/* loading skeleton while the lists load */}
        {(filesLoading || capturesLoading) && !hasContent ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <RowSkeleton key={i} />)}</div>
        ) : !hasContent ? (
          <TimelineEmpty label={tr.timelineEmptyDay} />
        ) : (
          <div className="space-y-4">
            {/* files */}
            {dayFiles.length > 0 && (
              <section>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">{tr.timelineFilesSection}</p>
                <div className="space-y-2">
                  {dayFiles.map((file) => (
                    <FileRow key={file.id} file={file} onOpen={() => setSelectedFile(file)} />
                  ))}
                </div>
              </section>
            )}

            {/* captures */}
            {dayItems.length > 0 && (
              <section>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">{tr.timelineCapturesSection}</p>
                <div className="space-y-3">
                  {dayItems.map((item) => <CaptureCard key={item.id} item={item} summarizing={tr.timelineSummarizing} />)}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <div className="h-6" />

      {/* file detail + lightbox (reused from home-tab pattern) */}
      {selectedFile && (
        <FileDetailSheet
          file={selectedFile}
          folders={folders}
          currentFolderId={null}
          onClose={() => setSelectedFile(null)}
          onOpenLightbox={() => setLightboxFile(selectedFile)}
          onDeleted={() => { setSelectedFile(null); onRefresh(); }}
          onMoved={() => { setSelectedFile(null); onRefresh(); }}
        />
      )}
      {lightboxFile && (
        <ImageLightbox src={lightboxFile.url} name={lightboxFile.name} onClose={() => setLightboxFile(null)} />
      )}
    </div>
  );
}

// ── Per-day summary fetch ─────────────────────────────────────────────────────

interface DaySummary { text: string; fileCount: number; itemCount: number }

function useDaySummary(date: string, enabled: boolean) {
  const [data, setData] = useState<DaySummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) { setData(null); setLoading(false); return; }
    let cancelled = false;
    setData(null);
    setLoading(true);
    apiFetch(`/api/summary/day?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { text?: string; fileCount?: number; itemCount?: number } | null) => {
        if (!cancelled) setData(j?.text ? { text: j.text, fileCount: j.fileCount ?? 0, itemCount: j.itemCount ?? 0 } : null);
      })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date, enabled]);

  return { data, loading };
}

// ── Cards / rows ──────────────────────────────────────────────────────────────

const FILE_ICON: Record<string, { Icon: React.ElementType; cls: string }> = {
  pdf:     { Icon: FileText,  cls: "text-red-500 bg-red-50 dark:bg-red-950/40" },
  image:   { Icon: ImageIcon, cls: "text-blue-500 bg-blue-50 dark:bg-blue-950/40" },
  doc:     { Icon: FileText,  cls: "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" },
  sheet:   { Icon: FileText,  cls: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" },
  video:   { Icon: Film,      cls: "text-violet-500 bg-violet-50 dark:bg-violet-950/40" },
  audio:   { Icon: Music,     cls: "text-pink-500 bg-pink-50 dark:bg-pink-950/40" },
  archive: { Icon: Archive,   cls: "text-amber-500 bg-amber-50 dark:bg-amber-950/40" },
  file:    { Icon: FileText,  cls: "text-[#9b869c] bg-[#9b869c]/12" },
};

function FileRow({ file, onOpen }: { file: FileItem; onOpen: () => void }) {
  const type = getFileIcon(file.mimeType);
  const cfg = FILE_ICON[type] ?? FILE_ICON.file;
  const isImage = type === "image";
  return (
    <button
      onClick={onOpen}
      className="card-enter flex w-full items-center gap-3 rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] p-3 text-left shadow-[0_1px_3px_rgba(74,64,54,0.06)] active:scale-[0.99] transition-transform"
    >
      {isImage ? (
        <img src={file.url} alt={file.name} className="h-10 w-10 flex-shrink-0 rounded-xl object-cover" />
      ) : (
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${cfg.cls}`}>
          <cfg.Icon size={17} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-[#4a4036] dark:text-[#e8ddd4]">{file.name}</p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[#b0a396] dark:text-[#6e6460]">
          <Clock size={10} /> {timeAgo(file.createdAt)}
        </p>
      </div>
    </button>
  );
}

function CaptureCard({ item, summarizing }: { item: Capture; summarizing: string }) {
  const isLink = item.type === "link";
  const Icon = isLink ? Link2 : FileText;
  const pending = item.status === "pending" || item.status === "processing";
  const failed = item.status === "failed";
  const title = item.title?.trim() || (isLink ? item.sourceUrl ?? "Link" : "Note");

  const open = () => {
    if (isLink && item.sourceUrl) window.open(item.sourceUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      onClick={open}
      className={`card-enter rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] p-4 shadow-[0_1px_3px_rgba(74,64,54,0.06)] ${
        isLink && item.sourceUrl ? "active:scale-[0.99] transition-transform cursor-pointer" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#9b869c]/12 dark:bg-[#9b869c]/20">
          <Icon size={16} className="text-[#9b869c]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[14px] font-bold leading-snug text-[#4a4036] dark:text-[#e8ddd4] line-clamp-2">{title}</p>
            {isLink && item.sourceUrl && <ExternalLink size={13} className="mt-0.5 flex-shrink-0 text-[#b0a396]" />}
          </div>

          {pending ? (
            <div className="mt-2 flex items-center gap-1.5 text-[12px] text-[#b0a396] dark:text-[#6e6460]">
              <Loader2 size={12} className="animate-spin" />
              {summarizing}
            </div>
          ) : failed && !item.summary ? (
            <div className="mt-2 flex items-center gap-1.5 text-[12px] text-[#b0a396] dark:text-[#6e6460]">
              <AlertCircle size={12} />
              couldn&rsquo;t summarize yet
            </div>
          ) : (
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-[#6b6051] dark:text-[#b8a79a]">{item.summary}</p>
          )}

          {(item.tags ?? []).length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {(item.tags ?? []).slice(0, 4).map((tag) => (
                <span key={tag} className="rounded-full bg-[#9b869c]/10 px-2 py-0.5 text-[10.5px] font-medium text-[#9b869c]">#{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── helpers + sub-components ───────────────────────────────────────────────────

/** Map an ISO timestamp to its ICT calendar date (YYYY-MM-DD). */
function ictDateOf(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + ICT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Sunday-first month grid of date labels, with nulls for blank leading/trailing cells. */
function buildMonthGrid(year: number, month0: number): (string | null)[] {
  const startWeekday = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  const mm = String(month0 + 1).padStart(2, "0");
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${mm}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function formatDayHeading(label: string, locale: string): string {
  const [y, m, d] = label.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "long" })
    .format(new Date(y, m - 1, d));
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] p-3 animate-pulse">
      <div className="h-10 w-10 flex-shrink-0 rounded-xl bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-3/4 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
        <div className="h-3 w-1/3 rounded bg-[#e0d8cc]/50 dark:bg-[#3a3430]/50" />
      </div>
    </div>
  );
}

function TimelineEmpty({ label }: { label: string }) {
  return (
    <div className="page-fade flex flex-col items-center justify-center px-8 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] border border-[#e0d8cc] bg-[#fbfaf6] shadow-sm">
        <span className="text-2xl">🗓️</span>
      </div>
      <p className="max-w-[260px] text-sm leading-relaxed text-[#b0a396] dark:text-[#6e6460]">{label}</p>
    </div>
  );
}
