"use client";

import { useState } from "react";
import { Home, Search, FolderOpen, User } from "lucide-react";
import { HomeTab } from "@/components/screens/home-tab";
import { FoldersTab } from "@/components/screens/folders-tab";
import { ProfileTab } from "@/components/screens/profile-tab";
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

  // All files across inbox + every folder — used for Recent and unsorted count
  const { files, loading: filesLoading, refresh: refreshFiles } = useFiles("all");
  const { folders, loading: foldersLoading, refresh: refreshFolders } = useFolders();

  const unsortedCount = files.filter((f) => f.id.startsWith("uploads/")).length;

  const { tr } = useLanguage();

  const NAV_ITEMS = [
    { id: "home"    as NavId, label: tr.navHome,    icon: Home      },
    { id: "search"  as NavId, label: tr.navSearch,  icon: Search    },
    { id: "folders" as NavId, label: tr.navFolders, icon: FolderOpen },
    { id: "profile" as NavId, label: tr.navProfile, icon: User      },
  ];

  function navigate(tab: string) { setActiveNav(tab as NavId); }

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
        />
      )}
      {activeNav === "search" && (
        <div className="flex min-h-dvh items-center justify-center text-sm text-[#b0a396]">
          Coming soon
        </div>
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
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#252220] px-2 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = activeNav === id;
          return (
            <button
              key={id}
              onClick={() => setActiveNav(id)}
              className="flex min-w-[64px] flex-col items-center gap-1"
            >
              <Icon
                size={22}
                className={isActive ? "text-[#9b869c]" : "text-[#b0a396]"}
                strokeWidth={isActive ? 2.25 : 1.75}
                fill={isActive && id === "home" ? "currentColor" : "none"}
              />
              <span className={`text-[10px] font-medium ${isActive ? "text-[#9b869c]" : "text-[#b0a396] dark:text-[#6e6460]"}`}>
                {label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
