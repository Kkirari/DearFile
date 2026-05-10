"use client";

import { useState } from "react";
import { Home, Search, FolderOpen, User } from "lucide-react";
import { HomeTab } from "@/components/screens/home-tab";
import { FoldersTab } from "@/components/screens/folders-tab";
import { ProfileTab } from "@/components/screens/profile-tab";
import { SearchScreen } from "@/components/screens/search-screen";
import { UploadFab } from "@/components/upload-fab";
import { useFiles } from "@/hooks/use-files";
import { useFolders } from "@/hooks/use-folders";
import { useLanguage } from "@/providers/language-provider";

type NavId = "home" | "search" | "folders" | "profile";

interface HomeScreenProps {
  displayName?: string;
  pictureUrl?: string;
}

export function HomeScreen({ displayName, pictureUrl }: HomeScreenProps) {
  const [activeNav, setActiveNav] = useState<NavId>("home");
  // Remember the tab the user was on before opening Search, so the back arrow
  // returns there instead of always going to home.
  const [searchOrigin, setSearchOrigin] = useState<NavId>("home");

  // All files across inbox + every folder — used for Recent and unsorted count
  const { files, loading: filesLoading, refresh: refreshFiles } = useFiles("all");
  const { folders, loading: foldersLoading, refresh: refreshFolders } = useFolders();

  // Per-user layout: keys are users/{userId}/uploads/... so match the
  // segment, not a startsWith.
  const unsortedCount = files.filter((f) => f.id.includes("/uploads/")).length;

  const { tr } = useLanguage();

  const NAV_ITEMS = [
    { id: "home"    as NavId, label: tr.navHome,    icon: Home      },
    { id: "search"  as NavId, label: tr.navSearch,  icon: Search    },
    { id: "folders" as NavId, label: tr.navFolders, icon: FolderOpen },
    { id: "profile" as NavId, label: tr.navProfile, icon: User      },
  ];

  function navigate(tab: string) {
    const next = tab as NavId;
    if (next === "search" && activeNav !== "search") setSearchOrigin(activeNav);
    setActiveNav(next);
  }

  return (
    <div className="relative min-h-dvh bg-[#f4f3ee] dark:bg-[#1c1a18]">

      {/* ── ACTIVE SCREEN ── */}
      {activeNav === "home" && (
        <HomeTab
          displayName={displayName}
          pictureUrl={pictureUrl}
          onNavigate={navigate}
          files={files}
          filesLoading={filesLoading}
          onRefresh={refreshFiles}
          folders={folders}
          foldersLoading={foldersLoading}
        />
      )}
      {activeNav === "folders" && (
        <FoldersTab
          folders={folders}
          loading={foldersLoading}
          unsortedCount={unsortedCount}
          onRefresh={refreshFolders}
        />
      )}
      {activeNav === "profile" && (
        <ProfileTab
          displayName={displayName}
          pictureUrl={pictureUrl}
          files={files}
          folders={folders}
          onDataReset={() => { refreshFiles(); refreshFolders(); }}
        />
      )}
      {activeNav === "search" && (
        <SearchScreen
          onBack={() => setActiveNav(searchOrigin)}
          folders={folders}
        />
      )}

      {/* ── UPLOAD FAB ── */}
      {(activeNav === "home" || activeNav === "folders") && (
        <UploadFab
          folders={folders}
          onUploadComplete={refreshFiles}
          onFolderRefresh={refreshFolders}
        />
      )}

      {/* ── BOTTOM NAV ── */}
      <nav
        aria-label="Primary"
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around bg-[#fbfaf6]/92 dark:bg-[#252220]/92 backdrop-blur-md border-t border-[#e0d8cc]/60 dark:border-[#3a3430]/70 shadow-[0_-2px_14px_rgba(74,64,54,0.05)] px-2 pt-2.5 pb-[calc(12px+env(safe-area-inset-bottom,0px))]"
      >
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = activeNav === id;
          return (
            <button
              key={id}
              onClick={() => {
                navigate(id);
                try { navigator.vibrate?.(8); } catch { /* ignore */ }
              }}
              aria-current={isActive ? "page" : undefined}
              aria-label={label}
              className="relative flex min-w-[68px] flex-col items-center gap-1 py-0.5"
            >
              <Icon
                size={22}
                className={`transition-colors ${isActive ? "text-[#9b869c]" : "text-[#b0a396]"}`}
                strokeWidth={isActive ? 2.25 : 1.75}
              />
              <span
                className={`t-caption transition-colors ${
                  isActive
                    ? "text-[#9b869c] font-bold"
                    : "text-[#b0a396] dark:text-[#6e6460]"
                }`}
              >
                {label}
              </span>
              {/* Active indicator dot — clearer signal than stroke-width alone */}
              <span
                aria-hidden
                className={`absolute -bottom-1 left-1/2 -translate-x-1/2 h-[3px] w-[3px] rounded-full bg-[#9b869c] transition-opacity ${
                  isActive ? "opacity-100" : "opacity-0"
                }`}
              />
            </button>
          );
        })}
      </nav>
    </div>
  );
}
