"use client";

import { useState } from "react";
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
  LogOut,
} from "lucide-react";
import { formatBytes, getFileIcon } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";
import { useTheme } from "@/providers/theme-provider";
import { useLiff } from "@/providers/liff-provider";
import type { Lang } from "@/lib/i18n";
import type { FileItem } from "@/types/file";
import type { FolderItem } from "@/types/folder";

interface ProfileTabProps {
  displayName?: string;
  pictureUrl?: string;
  files: FileItem[];
  folders: FolderItem[];
}

const STORAGE_LIMIT = 500 * 1024 * 1024; // 500 MB. Lift to env / config when real quotas exist.

export function ProfileTab({ displayName, pictureUrl, files, folders }: ProfileTabProps) {
  const { lang, setLang, tr } = useLanguage();
  const { theme, setTheme }   = useTheme();
  const { logout }            = useLiff();

  const [confirmLogout, setConfirmLogout] = useState(false);

  function handleLogout() {
    if (!confirmLogout) {
      // Two-tap pattern — first tap arms, second tap fires.
      setConfirmLogout(true);
      setTimeout(() => setConfirmLogout(false), 4000);
      return;
    }
    logout();
    // Hard reload so the LiffProvider re-runs init from a clean slate;
    // !isLoggedIn will redirect back to the LINE login flow.
    setTimeout(() => window.location.reload(), 50);
  }

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
      <div className="relative bg-[#f4f3ee] dark:bg-[#1c1a18] px-5 pt-14 pb-7 overflow-hidden">
        {/* A committed warm peachy-mauve glow instead of the previous timid 10% gradient */}
        <div
          aria-hidden
          className="absolute inset-x-0 -top-16 h-64 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 30%, rgba(155,134,156,0.22) 0%, rgba(217,156,91,0.10) 45%, transparent 75%)",
          }}
        />
        <div className="flex flex-col items-center text-center relative">
          <div className="relative mb-4">
            <div className="h-28 w-28 overflow-hidden rounded-full border-[3px] border-white dark:border-[#3a3430] shadow-[0_8px_28px_rgba(155,134,156,0.32)]">
              {pictureUrl ? (
                <Image
                  src={pictureUrl}
                  alt={displayName ?? "profile"}
                  width={112}
                  height={112}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[#9b869c]/15">
                  <User size={42} className="text-[#9b869c]" />
                </div>
              )}
            </div>
            <div className="absolute -bottom-1 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#06C755] border-2 border-white dark:border-[#1c1a18] shadow-sm">
              <span className="text-[7px] font-extrabold text-white leading-none">LINE</span>
            </div>
          </div>
          <h2 className="t-title text-[#4a4036] dark:text-[#e8ddd4]">
            {displayName ?? "User"}
          </h2>
          <p className="mt-1 t-caption text-[#b0a396] dark:text-[#6e6460]">{tr.lineAccount}</p>

          {/* Inline summary replaces the 3-card hero-metric template */}
          <p className="mt-4 t-body tnum text-[#4a4036] dark:text-[#e8ddd4]">
            <span className="font-bold">{files.length}</span>
            <span className="text-[#b0a396] dark:text-[#6e6460]"> {tr.files} · </span>
            <span className="font-bold">{folders.length}</span>
            <span className="text-[#b0a396] dark:text-[#6e6460]"> {tr.folders} · </span>
            <span className="font-bold">{formatBytes(totalSize)}</span>
            <span className="text-[#b0a396] dark:text-[#6e6460]"> {tr.used}</span>
          </p>
        </div>
      </div>

      {/* ── STORAGE BAR ── */}
      <section className="px-5 mt-6">
        <div className="rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] p-4 shadow-[0_1px_3px_rgba(74,64,54,0.06)]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#9b869c]/10">
                <HardDrive size={14} className="text-[#9b869c]" />
              </div>
              <span className="t-body font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.storage}</span>
            </div>
            <span className="t-caption tnum text-[#b0a396] dark:text-[#6e6460]">
              {formatBytes(totalSize)} / {formatBytes(STORAGE_LIMIT)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#f4f3ee] dark:bg-[#2a2724]">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min((totalSize / STORAGE_LIMIT) * 100, 100)}%`,
                background:
                  totalSize / STORAGE_LIMIT >= 0.9
                    ? "#d97a8a"  // rose — at limit
                    : totalSize / STORAGE_LIMIT >= 0.7
                    ? "#d99c5b"  // amber — getting close
                    : "#9b869c", // mauve — comfortable
              }}
            />
          </div>
          <p className="mt-2 text-right t-caption tnum text-[#b0a396] dark:text-[#6e6460]">
            {Math.round((totalSize / STORAGE_LIMIT) * 100)}% {tr.usedSuffix}
          </p>
        </div>
      </section>

      {/* ── FOLDERS ── */}
      <section className="px-5 mt-5">
        <p className="mb-3 t-body font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.myFolders}</p>
        <div className="overflow-hidden rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] shadow-[0_1px_3px_rgba(74,64,54,0.06)] divide-y divide-[#e0d8cc]/60 dark:divide-[#3a3430]/60">
          <InfoRow
            icon={<Folder size={15} className="text-[#9b869c]" />}
            label={tr.myFoldersLabel}
            value={`${userFolders.length} ${tr.folders}`}
          />
          <InfoRow
            icon={<Sparkles size={15} className="text-[#d99c5b]" />}
            label={tr.aiFolders}
            value={`${aiFolders.length} ${tr.folders}`}
          />
        </div>
      </section>

      {/* ── FILE TYPES ── (hide types with zero count to remove visual noise) */}
      {Object.values(typeCounts).some((c) => c > 0) && (
        <section className="px-5 mt-5">
          <p className="mb-3 t-body font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.fileTypes}</p>
          <div className="overflow-hidden rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] shadow-[0_1px_3px_rgba(74,64,54,0.06)] divide-y divide-[#e0d8cc]/60 dark:divide-[#3a3430]/60">
            {FILE_TYPES.filter(({ key }) => (typeCounts[key] ?? 0) > 0).map(
              ({ key, label, icon: Icon, bg, color }) => {
                const count = typeCounts[key] ?? 0;
                return (
                  <div key={key} className="flex items-center gap-3 px-4 py-3">
                    <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${bg}`}>
                      <Icon size={14} className={color} />
                    </div>
                    <span className="flex-1 t-body text-[#4a4036] dark:text-[#e8ddd4]">{label}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#f4f3ee] dark:bg-[#2a2724]">
                        <div
                          className="h-full rounded-full bg-[#9b869c]/55 transition-all"
                          style={{ width: `${(count / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="w-6 text-right t-caption tnum font-bold text-[#9b869c]">{count}</span>
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </section>
      )}

      {/* ── SETTINGS ── */}
      <section className="px-5 mt-5">
        <p className="mb-3 t-body font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.settings}</p>
        <div className="overflow-hidden rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] shadow-[0_1px_3px_rgba(74,64,54,0.06)] divide-y divide-[#e0d8cc]/60 dark:divide-[#3a3430]/60">

          {/* Language toggle */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
              <Globe size={15} className="text-[#9b869c]" />
            </div>
            <span className="flex-1 t-body text-[#4a4036] dark:text-[#e8ddd4]">{tr.language}</span>
            <div className="flex items-center gap-1 rounded-full border border-[#e0d8cc] dark:border-[#3a3430] bg-[#f4f3ee] dark:bg-[#2a2724] p-0.5">
              {(["en", "th"] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`rounded-full px-3 py-1 t-caption font-bold transition-all ${
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
            <span className="flex-1 t-body text-[#4a4036] dark:text-[#e8ddd4]">{tr.appearance}</span>
            <div className="flex items-center gap-1 rounded-full border border-[#e0d8cc] dark:border-[#3a3430] bg-[#f4f3ee] dark:bg-[#2a2724] p-0.5">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`rounded-full px-3 py-1 t-caption font-bold transition-all ${
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
        <p className="mb-3 t-body font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.about}</p>
        <div className="overflow-hidden rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] shadow-[0_1px_3px_rgba(74,64,54,0.06)] divide-y divide-[#e0d8cc]/60 dark:divide-[#3a3430]/60">
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

      {/* ── LOGOUT ── */}
      <section className="px-5 mt-5">
        <div className="overflow-hidden rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] shadow-[0_1px_3px_rgba(74,64,54,0.06)]">
          <button
            onClick={handleLogout}
            className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
              confirmLogout
                ? "bg-red-500 active:bg-red-600"
                : "active:bg-red-50 dark:active:bg-red-950/30"
            }`}
          >
            <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors ${
              confirmLogout ? "bg-white/20" : "bg-red-50 dark:bg-red-950/40"
            }`}>
              <LogOut size={14} className={confirmLogout ? "text-white" : "text-red-500"} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`t-body font-bold leading-tight ${
                confirmLogout ? "text-white" : "text-red-500"
              }`}>
                {confirmLogout ? tr.logoutConfirm : tr.logout}
              </p>
              <p className={`mt-0.5 t-caption leading-tight ${
                confirmLogout ? "text-white/85" : "text-[#b0a396] dark:text-[#6e6460]"
              }`}>
                {tr.logoutSubtitle}
              </p>
            </div>
          </button>
        </div>
      </section>

      <div className="h-6" />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center">{icon}</div>
      <span className="flex-1 t-body text-[#4a4036] dark:text-[#e8ddd4]">{label}</span>
      <span className="t-caption tnum font-bold text-[#b0a396] dark:text-[#6e6460]">{value}</span>
    </div>
  );
}
