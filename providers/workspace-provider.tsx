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
import { useLiff } from "./liff-provider";

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: "owner" | "member";
  memberCount: number;
  lineGroupId: string | null;
  orphaned: boolean;
  quiet: boolean;
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

/**
 * Which workspace should the app open in? In priority order:
 *
 *   1. `?ws=` on the URL — an explicit deep link from a bot bubble. Read here in
 *      the lazy initializer so it lands before first paint; otherwise every
 *      workspace-scoped hook fires its first request against the stale value.
 *   2. The LINE group the LIFF was opened from — resolved asynchronously below,
 *      since `liff.getContext()` isn't available until LIFF finishes init.
 *   3. Whatever was used last.
 */
function initialWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const ws = new URLSearchParams(window.location.search).get("ws");
    if (ws) {
      window.localStorage.setItem(STORAGE_KEY, ws);
      return ws;
    }
    return window.localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { ready, groupId } = useLiff();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  // True until the group-context lookup has settled, so the self-heal effect
  // below can't wipe a workspace we're in the middle of resolving.
  const [resolvingGroup, setResolvingGroup] = useState(true);
  const [currentWorkspaceId, _setCurrentWorkspaceId] = useState<string | null>(
    initialWorkspaceId,
  );

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

  // Opened from inside a LINE group → switch to that group's workspace. An
  // explicit `?ws=` deep link outranks it and was already applied synchronously.
  useEffect(() => {
    if (!ready) return;   // groupId is null until LIFF init lands — don't settle early
    let cancelled = false;

    (async () => {
      try {
        const explicit =
          new URLSearchParams(window.location.search).get("ws");
        if (explicit || !groupId) return;

        const res = await apiFetch(
          `/api/workspaces/by-group?groupId=${encodeURIComponent(groupId)}`,
        );
        if (!res.ok) return;
        const data = await res.json() as { workspace?: { id: string } | null };
        if (cancelled || !data.workspace?.id) return;

        setCurrentWorkspace(data.workspace.id);
        // Must await: the lookup may have just auto-joined this user, and the
        // self-heal effect below would otherwise drop the id for not being in
        // the stale list.
        await refresh();
      } catch {
        /* keep whatever we had — worst case the last-used workspace */
      } finally {
        if (!cancelled) setResolvingGroup(false);
      }
    })();

    return () => { cancelled = true; };
  }, [ready, groupId, setCurrentWorkspace, refresh]);

  // Auto-fall-back to personal if the cached workspaceId isn't in the
  // current member list (e.g. was removed).
  useEffect(() => {
    if (!currentWorkspaceId) return;
    if (loading || resolvingGroup) return;
    if (!workspaces.some((w) => w.id === currentWorkspaceId)) {
      _setCurrentWorkspaceId(null);
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }, [currentWorkspaceId, workspaces, loading, resolvingGroup]);

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
