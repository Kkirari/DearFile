"use client";

/**
 * Horizontal chip strip for switching between personal storage and shared
 * workspaces the user belongs to.
 *
 * Lives at the top of the LIFF home/folders tabs. Hidden entirely when the
 * user has no shared workspaces — we don't want to clutter the UI for solo
 * users.
 */

import { User, Users, AlertCircle } from "lucide-react";
import { useWorkspace } from "@/providers/workspace-provider";

export function WorkspaceSwitcher() {
  const { currentWorkspaceId, workspaces, setCurrentWorkspace, loading } = useWorkspace();

  // Solo users see nothing. Workspaces only appear after the user joins one
  // (via being added to a LINE group, or creating one in-app later).
  if (loading) return null;
  if (workspaces.length === 0) return null;

  return (
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
    </div>
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
