"use client";

/**
 * Horizontal chip strip for switching between personal storage and shared
 * workspaces the user belongs to. Plus controls for creating a new
 * workspace and opening settings on the active one.
 *
 * Lives at the top of the LIFF home/folders tabs. Always shows at least
 * the Personal chip + "+" so users can always create a workspace, even
 * if they have none yet.
 */

import { useState } from "react";
import { AlertCircle, MoreHorizontal, Plus, User, Users } from "lucide-react";
import { useWorkspace, type WorkspaceSummary } from "@/providers/workspace-provider";
import { WorkspaceCreateSheet } from "@/components/workspace-create-sheet";
import { WorkspaceSettingsSheet } from "@/components/workspace-settings-sheet";

export function WorkspaceSwitcher() {
  const {
    currentWorkspaceId,
    currentWorkspace,
    workspaces,
    setCurrentWorkspace,
    loading,
  } = useWorkspace();

  const [createOpen, setCreateOpen]     = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (loading) return null;

  return (
    <>
      <div
        role="tablist"
        aria-label="Workspaces"
        className="scrollbar-hide -mx-5 flex items-center gap-2 overflow-x-auto px-5 pb-1"
      >
        <Chip
          active={currentWorkspaceId === null}
          onClick={() => setCurrentWorkspace(null)}
          icon={<User size={14} strokeWidth={2.25} />}
          label="Personal"
        />
        {workspaces.map((ws) => (
          <Chip
            key={ws.id}
            active={currentWorkspaceId === ws.id}
            onClick={() => setCurrentWorkspace(ws.id)}
            icon={
              ws.orphaned
                ? <AlertCircle size={14} strokeWidth={2.25} />
                : <Users size={14} strokeWidth={2.25} />
            }
            label={ws.name}
            meta={ws.role === "owner" ? "Owner" : `${ws.memberCount} members`}
            dimmed={ws.orphaned}
          />
        ))}

        {/* Settings on the active workspace */}
        {currentWorkspace && (
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label={`Settings for ${currentWorkspace.name}`}
            className="flex-shrink-0 inline-flex items-center justify-center h-[34px] w-[34px] rounded-full bg-[#fbfaf6] dark:bg-[#252220] border border-[#e0d8cc] dark:border-[#3a3430] text-[#9b869c] active:scale-[0.97] transition-transform"
          >
            <MoreHorizontal size={14} strokeWidth={2.5} />
          </button>
        )}

        {/* Create new workspace */}
        <button
          onClick={() => setCreateOpen(true)}
          aria-label="Create new workspace"
          className="flex-shrink-0 inline-flex items-center gap-1 rounded-full bg-[#fbfaf6] dark:bg-[#252220] border border-dashed border-[#9b869c]/60 px-3 py-2 text-[12.5px] font-bold text-[#9b869c] active:scale-[0.97] transition-transform"
        >
          <Plus size={13} strokeWidth={2.75} />
          New
        </button>
      </div>

      {createOpen && (
        <WorkspaceCreateSheet onClose={() => setCreateOpen(false)} />
      )}

      {settingsOpen && currentWorkspace && (
        <WorkspaceSettingsSheet
          workspace={currentWorkspace}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}

function Chip({
  active, onClick, icon, label, meta, dimmed,
}: {
  active:  boolean;
  onClick: () => void;
  icon:    React.ReactNode;
  label:   string;
  meta?:   string;
  dimmed?: boolean;
}) {
  return (
    <button
      onClick={() => {
        onClick();
        try { navigator.vibrate?.(6); } catch { /* ignore */ }
      }}
      role="tab"
      aria-selected={active}
      className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-bold transition-all active:scale-[0.97] ${
        active
          ? "bg-[#9b869c] text-white shadow-[0_2px_8px_rgba(155,134,156,0.35)]"
          : "bg-[#fbfaf6] dark:bg-[#252220] text-[#4a4036] dark:text-[#e8ddd4] border border-[#e0d8cc] dark:border-[#3a3430]"
      } ${dimmed ? "opacity-60" : ""}`}
    >
      <span className={active ? "text-white" : "text-[#9b869c]"}>{icon}</span>
      <span className="max-w-[140px] truncate">{label}</span>
      {meta && (
        <span className={`ml-0.5 t-caption font-medium ${active ? "text-white/75" : "text-[#b0a396]"}`}>
          · {meta}
        </span>
      )}
    </button>
  );
}

// Re-export type so consumers can avoid importing from provider directly.
export type { WorkspaceSummary };
