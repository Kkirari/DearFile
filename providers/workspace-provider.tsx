"use client";

/**
 * Workspace context — the currently-selected workspace for the LIFF app.
 *
 *   currentWorkspaceId === null  → personal storage (default)
 *   currentWorkspaceId === "ws_…" → that shared workspace
 *
 * All workspace-aware hooks read this value and append it to /api/* calls
 * as `?workspaceId=…`. Switching is a single setState — every hook
 * watching this context will refetch automatically.
 *
 * The list of available workspaces is fetched once on mount and cached;
 * call `refresh()` after creating/joining a workspace to update it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/api-client";

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: "owner" | "member";
  memberCount: number;
  lineGroupId: string | null;
  orphaned: boolean;
  updatedAt: string;
}

interface WorkspaceContextValue {
  currentWorkspaceId: string | null;
  currentWorkspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  setCurrentWorkspace: (id: string | null) => void;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const STORAGE_KEY = "dearfile.currentWorkspaceId";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentWorkspaceId, _setCurrentWorkspaceId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });

  const setCurrentWorkspace = useCallback((id: string | null) => {
    _setCurrentWorkspaceId(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else    window.localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch("/api/workspaces");
      if (!res.ok) {
        setWorkspaces([]);
        return;
      }
      const data = await res.json() as { workspaces?: WorkspaceSummary[] };
      setWorkspaces(data.workspaces ?? []);
    } catch {
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-fall-back to personal if the cached workspaceId isn't in the
  // current member list (e.g. was removed).
  useEffect(() => {
    if (!currentWorkspaceId) return;
    if (loading) return;
    if (!workspaces.some((w) => w.id === currentWorkspaceId)) {
      _setCurrentWorkspaceId(null);
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }, [currentWorkspaceId, workspaces, loading]);

  const currentWorkspace = useMemo(
    () => workspaces.find((w) => w.id === currentWorkspaceId) ?? null,
    [workspaces, currentWorkspaceId],
  );

  const value = useMemo<WorkspaceContextValue>(() => ({
    currentWorkspaceId,
    currentWorkspace,
    workspaces,
    loading,
    setCurrentWorkspace,
    refresh,
  }), [currentWorkspaceId, currentWorkspace, workspaces, loading, setCurrentWorkspace, refresh]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

/**
 * Append `workspaceId=…` to an API URL when a shared workspace is active.
 * Personal scope returns the URL unchanged.
 */
export function withWorkspace(url: string, workspaceId: string | null): string {
  if (!workspaceId) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}workspaceId=${encodeURIComponent(workspaceId)}`;
}
