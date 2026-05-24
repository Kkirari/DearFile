"use client";

import { Link2, FileText, Clock, Loader2, AlertCircle, ExternalLink, RefreshCw } from "lucide-react";
import { useCaptures } from "@/hooks/use-captures";
import type { Capture } from "@/types/capture";

/**
 * Timeline tab (Phase 7) — the chronological feed of notes & links captured via
 * the OA. Files live in Home/Folders; this is the notes/links service only.
 * `pending`/`processing` items show a "summarizing…" placeholder until the
 * background task / cron fills in the summary.
 */
export function TimelineTab() {
  const { items, loading, error, refresh } = useCaptures();

  return (
    <div className="overflow-y-auto pb-[76px]">
      {/* ── HEADER ── */}
      <div className="bg-[#f4f3ee] dark:bg-[#1c1a18] px-5 pt-14 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[26px] font-bold leading-none tracking-tight text-[#4a4036] dark:text-[#e8ddd4]">
              Timeline
            </h1>
            <p className="mt-1.5 text-[13px] text-[#b0a396] dark:text-[#6e6460]">
              บันทึกลิงก์และโน้ตที่ส่งมาในแชต / Links & notes you sent in chat
            </p>
          </div>
          <button
            onClick={() => refresh()}
            aria-label="Refresh"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] active:scale-95 transition-transform"
          >
            <RefreshCw size={15} className={`text-[#9b869c] ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── FEED ── */}
      <div className="px-5 pt-2 space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <CaptureSkeleton key={i} />)
        ) : error ? (
          <p className="py-10 text-center text-[13px] text-[#b0a396] dark:text-[#6e6460]">
            โหลดไม่สำเร็จ ลองรีเฟรช / Couldn’t load — try refresh
          </p>
        ) : items.length === 0 ? (
          <TimelineEmpty />
        ) : (
          items.map((item) => <CaptureCard key={item.id} item={item} />)
        )}
      </div>

      <div className="h-6" />
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────

function CaptureCard({ item }: { item: Capture }) {
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
            <p className="text-[14px] font-bold leading-snug text-[#4a4036] dark:text-[#e8ddd4] line-clamp-2">
              {title}
            </p>
            {isLink && item.sourceUrl && (
              <ExternalLink size={13} className="mt-0.5 flex-shrink-0 text-[#b0a396]" />
            )}
          </div>

          {pending ? (
            <div className="mt-2 flex items-center gap-1.5 text-[12px] text-[#b0a396] dark:text-[#6e6460]">
              <Loader2 size={12} className="animate-spin" />
              กำลังสรุป… / summarizing…
            </div>
          ) : failed && !item.summary ? (
            <div className="mt-2 flex items-center gap-1.5 text-[12px] text-[#b0a396] dark:text-[#6e6460]">
              <AlertCircle size={12} />
              ยังสรุปไม่ได้ / couldn’t summarize yet
            </div>
          ) : (
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-[#6b6051] dark:text-[#b8a79a]">
              {item.summary}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {(item.tags ?? []).slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[#9b869c]/10 px-2 py-0.5 text-[10.5px] font-medium text-[#9b869c]"
              >
                #{tag}
              </span>
            ))}
            <span className="ml-auto flex items-center gap-1 text-[11px] text-[#b0a396] dark:text-[#6e6460]">
              <Clock size={10} />
              {timeAgo(item.createdAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers + sub-components ──────────────────────────────────────────────────

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

function CaptureSkeleton() {
  return (
    <div className="rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 flex-shrink-0 rounded-xl bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-3/4 rounded bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60" />
          <div className="h-3 w-full rounded bg-[#e0d8cc]/50 dark:bg-[#3a3430]/50" />
          <div className="h-3 w-2/3 rounded bg-[#e0d8cc]/50 dark:bg-[#3a3430]/50" />
        </div>
      </div>
    </div>
  );
}

function TimelineEmpty() {
  return (
    <div className="page-fade flex flex-col items-center justify-center px-8 py-20 text-center">
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[26px] border border-[#e0d8cc] bg-[#fbfaf6] shadow-sm">
        <span className="text-3xl">🔗</span>
      </div>
      <h2 className="text-base font-bold text-[#4a4036] dark:text-[#e8ddd4]">ยังไม่มีรายการ</h2>
      <p className="mt-2 max-w-[260px] text-sm leading-relaxed text-[#b0a396] dark:text-[#6e6460]">
        ส่งลิงก์หรือพิมพ์ &ldquo;/note ...&rdquo; มาในแชต แล้ว AI จะสรุปให้ที่นี่
        <br />
        Send a link or “/note …” in chat — AI summaries land here.
      </p>
    </div>
  );
}
