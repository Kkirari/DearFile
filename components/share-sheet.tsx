"use client";

import { useState } from "react";
import { X, Share2, Link as LinkIcon, Check, Loader2, AlertTriangle } from "lucide-react";
import {
  canShareToLine,
  canShareViaWeb,
  shareToLine,
  shareViaWeb,
  copyLinks,
} from "@/lib/share";
import { useLanguage } from "@/providers/language-provider";
import type { FileItem } from "@/types/file";

interface ShareSheetProps {
  files: FileItem[];
  onClose: () => void;
}

type Status = "idle" | "loading" | "success" | "error";

export function ShareSheet({ files, onClose }: ShareSheetProps) {
  const { tr } = useLanguage();
  const [isClosing, setIsClosing]   = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [status, setStatus]         = useState<Status>("idle");
  const [statusText, setStatusText] = useState<string>("");

  function close() {
    setIsClosing(true);
    setTimeout(() => { setIsClosing(false); onClose(); }, 260);
  }

  async function runAction(
    action: string,
    fn: () => Promise<"success" | "cancelled" | "error" | boolean>
  ) {
    setActiveAction(action);
    setStatus("loading");
    setStatusText("");
    const result = await fn();
    if (result === "success" || result === true) {
      setStatus("success");
      setStatusText(tr.shareSuccess);
      setTimeout(close, 800);
    } else if (result === "cancelled") {
      // User cancelled — just reset, don't show error
      setStatus("idle");
      setActiveAction(null);
    } else {
      setStatus("error");
      setStatusText(tr.shareError);
      setTimeout(() => { setStatus("idle"); setActiveAction(null); }, 1800);
    }
  }

  const lineAvailable = canShareToLine();
  const webAvailable  = canShareViaWeb();
  const fileCount     = files.length;

  return (
    <>
      <div
        className={`fixed inset-0 z-[80] bg-black/30 ${isClosing ? "backdrop-exit" : "backdrop-enter"}`}
        onClick={close}
      />
      <div
        className={`fixed bottom-0 left-0 right-0 z-[80] rounded-t-[28px] bg-[#fbfaf6] dark:bg-[#252220] px-5 pt-4 pb-[calc(28px+env(safe-area-inset-bottom,0px))] shadow-2xl ${isClosing ? "sheet-exit" : "sheet-enter"}`}
      >
        <div className="mx-auto mb-4 h-[5px] w-10 rounded-full bg-[#e0d8cc] dark:bg-[#3a3430]" />

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2 min-w-0">
            <Share2 size={15} className="text-[#9b869c] flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="text-[16px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">
                {tr.shareTitle}
              </h3>
              <p className="text-[11px] text-[#b0a396] dark:text-[#6e6460] truncate">
                {fileCount === 1
                  ? files[0].name
                  : `${fileCount} ${fileCount === 1 ? tr.searchResultCount : tr.searchResultCountPlural}`}
              </p>
            </div>
          </div>
          <button
            onClick={close}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#f4f3ee] dark:bg-[#2a2724] text-[#b0a396] dark:text-[#6e6460] active:bg-[#e0d8cc] dark:active:bg-[#3a3430]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Status banner */}
        {status === "success" && (
          <div className="mb-3 flex items-center gap-2 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2.5 text-emerald-600 dark:text-emerald-400">
            <Check size={14} strokeWidth={2.5} />
            <span className="text-[13px] font-semibold">{statusText}</span>
          </div>
        )}
        {status === "error" && (
          <div className="mb-3 flex items-center gap-2 rounded-2xl bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-red-500">
            <AlertTriangle size={14} />
            <span className="text-[13px] font-semibold">{statusText}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2.5">
          {/* LINE share — primary, only if available */}
          {lineAvailable ? (
            <ShareAction
              icon={<LineIcon />}
              label={tr.shareToLine}
              sublabel={tr.shareToLineDesc}
              bg="bg-[#06C755]"
              textColor="text-white"
              loading={activeAction === "line" && status === "loading"}
              disabled={status === "loading"}
              onClick={() => runAction("line", () => shareToLine(files))}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-[#e0d8cc] dark:border-[#3a3430] bg-[#f4f3ee]/50 dark:bg-[#2a2724]/50 px-4 py-3 text-center">
              <p className="text-[12px] text-[#b0a396] dark:text-[#6e6460]">
                {tr.shareLineUnavailable}
              </p>
            </div>
          )}

          {/* Web Share — system share menu */}
          {webAvailable && (
            <ShareAction
              icon={<Share2 size={19} />}
              label={tr.shareVia}
              sublabel={tr.shareViaDesc}
              bg="bg-[#f4f3ee] dark:bg-[#2a2724]"
              textColor="text-[#4a4036] dark:text-[#e8ddd4]"
              loading={activeAction === "web" && status === "loading"}
              disabled={status === "loading"}
              onClick={() => runAction("web", () => shareViaWeb(files))}
            />
          )}

          {/* Copy Link — always available */}
          <ShareAction
            icon={<LinkIcon size={18} />}
            label={tr.shareCopyLink}
            sublabel={fileCount === 1 ? tr.shareCopyLinkOneDesc : tr.shareCopyLinkManyDesc}
            bg="bg-[#f4f3ee] dark:bg-[#2a2724]"
            textColor="text-[#4a4036] dark:text-[#e8ddd4]"
            loading={activeAction === "copy" && status === "loading"}
            disabled={status === "loading"}
            onClick={() => runAction("copy", () => copyLinks(files))}
          />
        </div>

        {/* Note about expiry */}
        <p className="mt-4 px-1 text-[11px] text-[#b0a396] dark:text-[#6e6460] text-center">
          {tr.shareExpiryNote}
        </p>
      </div>
    </>
  );
}

// ── Share action button ───────────────────────────────────────────────────────

function ShareAction({
  icon, label, sublabel, bg, textColor, onClick, disabled, loading,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  bg: string;
  textColor: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-all active:scale-[0.98] disabled:opacity-50 ${bg} ${textColor}`}
    >
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center">
        {loading ? <Loader2 size={18} className="animate-spin" /> : icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold leading-tight">{label}</p>
        {sublabel && <p className="text-[11px] opacity-80 mt-0.5 leading-tight">{sublabel}</p>}
      </div>
    </button>
  );
}

// ── LINE icon (inline SVG, official-ish styling) ──────────────────────────────

function LineIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
    </svg>
  );
}
