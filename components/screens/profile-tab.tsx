"use client";

import Image from "next/image";
import {
  User,
  FileText,
  Film,
  Music,
  Archive,
  Image as ImageIcon,
  Folder,
  HardDrive,
  Sparkles,
  Info,
  File,
  Globe,
  Moon,
  Sun,
} from "lucide-react";
import { formatBytes, getFileIcon } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";
import { useTheme } from "@/providers/theme-provider";
import type { Lang } from "@/lib/i18n";
import type { FileItem } from "@/types/file";
import type { FolderItem } from "@/types/folder";

interface ProfileTabProps {
  displayName?: string;
  pictureUrl?: string;
  files: FileItem[];
  folders: FolderItem[];
}

export function ProfileTab({ displayName, pictureUrl, files, folders }: ProfileTabProps) {
  const { lang, setLang, tr } = useLanguage();
  const { theme, setTheme }   = useTheme();

  const totalSize   = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
  const userFolders = folders.filter((f) => f.owner === "user");
  const aiFolders   = folders.filter((f) => f.owner === "ai");

  const typeCounts = files.reduce<Record<string, number>>((acc, file) => {
    const key = getFileIcon(file.mimeType);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const maxCount = Math.max(...Object.values(typeCounts), 1);

  const FILE_TYPES = [
    { key: "image",   label: tr.images,    icon: ImageIcon, bg: "bg-blue-50 dark:bg-blue-950/40",      color: "text-blue-500"    },
    { key: "pdf",     label: tr.pdf,        icon: FileText,  bg: "bg-red-50 dark:bg-red-950/40",        color: "text-red-500"     },
    { key: "doc",     label: tr.documents,  icon: FileText,  bg: "bg-emerald-50 dark:bg-emerald-950/40",color: "text-emerald-500" },
    { key: "video",   label: tr.video,      icon: Film,      bg: "bg-violet-50 dark:bg-violet-950/40",  color: "text-violet-500"  },
    { key: "audio",   label: tr.audio,      icon: Music,     bg: "bg-pink-50 dark:bg-pink-950/40",      color: "text-pink-500"    },
    { key: "archive", label: tr.archive,    icon: Archive,   bg: "bg-amber-50 dark:bg-amber-950/40",    color: "text-amber-500"   },
    { key: "file",    label: tr.other,      icon: File,      bg: "bg-[#f4f3ee] dark:bg-[#2a2724]",      color: "text-[#9b869c]"   },
  ];

  return (
    <div className="overflow-y-auto pb-[76px]">

      {/* ── HERO ── */}
      <div className="relative bg-[#f4f3ee] dark:bg-[#1c1a18] px-5 pt-14 pb-8">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#9b869c]/10 to-transparent pointer-events-none" />
        <div className="flex flex-col items-center text-center relative">
          <div className="relative mb-4">
            <div className="h-24 w-24 overflow-hidden rounded-full border-[3px] border-white dark:border-[#3a3430] shadow-[0_6px_24px_rgba(155,134,156,0.3)]">
              {pictureUrl ? (
                <Image
                  src={pictureUrl}
                  alt={displayName ?? "profile"}
                  width={96}
                  height={96}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[#9b869c]/15">
                  <User size={36} className="text-[#9b869c]" />
                </div>
              )}
            </div>
            <div className="absolute -bottom-1 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#06C755] border-2 border-white dark:border-[#1c1a18] shadow-sm">
              <span className="text-[7px] font-extrabold text-white leading-none">LINE</span>
            </div>
          </div>
          <h2 className="text-[22px] font-extrabold tracking-tight text-[#4a4036] dark:text-[#e8ddd4]">
            {displayName ?? "User"}
          </h2>
          <p className="mt-1 text-[12px] text-[#b0a396] dark:text-[#6e6460]">{tr.lineAccount}</p>
        </div>
      </div>

      {/* ── STATS ROW ── */}
      <section className="px-5 -mt-2">
        <div className="grid grid-cols-3 gap-3">
          <StatCard value={files.length} label={tr.files} />
          <StatCard value={folders.length} label={tr.folders} />
          <StatCard value={formatBytes(totalSize)} label={tr.used} raw />
        </div>
      </section>

      {/* ── STORAGE BAR ── */}
      <section className="px-5 mt-5">
        <div className="rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#252220] p-4 shadow-[0_1px_3px_rgba(74,64,54,0.06)]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#9b869c]/10">
                <HardDrive size={14} className="text-[#9b869c]" />
              </div>
              <span className="text-[13px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.storage}</span>
            </div>
            <span className="text-[12px] text-[#b0a396] dark:text-[#6e6460]">{formatBytes(totalSize)} {tr.usedSuffix}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#f4f3ee] dark:bg-[#2a2724]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#9b869c] to-[#c4adc7] transition-all"
              style={{ width: `${Math.min((totalSize / (500 * 1024 * 1024)) * 100, 100)}%` }}
            />
          </div>
          <p className="mt-2 text-right text-[11px] text-[#b0a396] dark:text-[#6e6460]">{tr.storageOf}</p>
        </div>
      </section>

      {/* ── FOLDERS ── */}
      <section className="px-5 mt-5">
        <p className="mb-3 text-[13px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.myFolders}</p>
        <div className="overflow-hidden rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#252220] shadow-[0_1px_3px_rgba(74,64,54,0.06)] divide-y divide-[#e0d8cc]/60 dark:divide-[#3a3430]/60">
          <InfoRow
            icon={<Folder size={15} className="text-[#9b869c]" />}
            label={tr.myFoldersLabel}
            value={`${userFolders.length} ${tr.folders}`}
          />
          <InfoRow
            icon={<Sparkles size={15} className="text-[#9b869c]" />}
            label={tr.aiFolders}
            value={`${aiFolders.length} ${tr.folders}`}
          />
        </div>
      </section>

      {/* ── FILE TYPES ── */}
      <section className="px-5 mt-5">
        <p className="mb-3 text-[13px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.fileTypes}</p>
        <div className="overflow-hidden rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#252220] shadow-[0_1px_3px_rgba(74,64,54,0.06)] divide-y divide-[#e0d8cc]/60 dark:divide-[#3a3430]/60">
          {FILE_TYPES.map(({ key, label, icon: Icon, bg, color }) => {
            const count = typeCounts[key] ?? 0;
            return (
              <div key={key} className="flex items-center gap-3 px-4 py-3">
                <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${bg}`}>
                  <Icon size={14} className={color} />
                </div>
                <span className="flex-1 text-[13px] text-[#4a4036] dark:text-[#e8ddd4]">{label}</span>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#f4f3ee] dark:bg-[#2a2724]">
                    <div
                      className="h-full rounded-full bg-[#9b869c]/50 transition-all"
                      style={{ width: `${(count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-5 text-right text-[12px] font-semibold text-[#9b869c]">{count}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── SETTINGS ── */}
      <section className="px-5 mt-5">
        <p className="mb-3 text-[13px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.settings}</p>
        <div className="overflow-hidden rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#252220] shadow-[0_1px_3px_rgba(74,64,54,0.06)] divide-y divide-[#e0d8cc]/60 dark:divide-[#3a3430]/60">

          {/* Language toggle */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
              <Globe size={15} className="text-[#9b869c]" />
            </div>
            <span className="flex-1 text-[13px] text-[#4a4036] dark:text-[#e8ddd4]">{tr.language}</span>
            <div className="flex items-center gap-1 rounded-full border border-[#e0d8cc] dark:border-[#3a3430] bg-[#f4f3ee] dark:bg-[#2a2724] p-0.5">
              {(["en", "th"] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-all ${
                    lang === l
                      ? "bg-[#9b869c] text-white shadow-sm"
                      : "text-[#b0a396] dark:text-[#6e6460]"
                  }`}
                >
                  {l === "en" ? "EN" : "TH"}
                </button>
              ))}
            </div>
          </div>

          {/* Theme toggle */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
              {theme === "dark"
                ? <Moon size={15} className="text-[#9b869c]" />
                : <Sun size={15} className="text-[#9b869c]" />
              }
            </div>
            <span className="flex-1 text-[13px] text-[#4a4036] dark:text-[#e8ddd4]">{tr.appearance}</span>
            <div className="flex items-center gap-1 rounded-full border border-[#e0d8cc] dark:border-[#3a3430] bg-[#f4f3ee] dark:bg-[#2a2724] p-0.5">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-all ${
                    theme === t
                      ? "bg-[#9b869c] text-white shadow-sm"
                      : "text-[#b0a396] dark:text-[#6e6460]"
                  }`}
                >
                  {t === "light" ? tr.light : tr.dark}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── ABOUT ── */}
      <section className="px-5 mt-5">
        <p className="mb-3 text-[13px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.about}</p>
        <div className="overflow-hidden rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#252220] shadow-[0_1px_3px_rgba(74,64,54,0.06)] divide-y divide-[#e0d8cc]/60 dark:divide-[#3a3430]/60">
          <InfoRow
            icon={<Info size={15} className="text-[#9b869c]" />}
            label="DearFile"
            value={tr.version}
          />
          <InfoRow
            icon={<HardDrive size={15} className="text-[#9b869c]" />}
            label="Storage"
            value={tr.storageBackend}
          />
        </div>
      </section>

      <div className="h-6" />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ value, label, raw }: { value: number | string; label: string; raw?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#252220] px-3 py-4 shadow-[0_1px_3px_rgba(74,64,54,0.06)]">
      <span className={`font-extrabold text-[#4a4036] dark:text-[#e8ddd4] leading-none ${raw ? "text-[15px]" : "text-[22px]"}`}>
        {value}
      </span>
      <span className="mt-1.5 text-[11px] text-[#b0a396] dark:text-[#6e6460]">{label}</span>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center">{icon}</div>
      <span className="flex-1 text-[13px] text-[#4a4036] dark:text-[#e8ddd4]">{label}</span>
      <span className="text-[12px] font-medium text-[#b0a396] dark:text-[#6e6460]">{value}</span>
    </div>
  );
}
