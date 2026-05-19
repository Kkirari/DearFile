"use client";

import { useState, useEffect, useCallback } from "react";
import type { FolderItem } from "@/types/folder";
import { apiFetch } from "@/lib/api-client";
import { useWorkspace, withWorkspace } from "@/providers/workspace-provider";

export function useFolders() {
  const { currentWorkspaceId } = useWorkspace();
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const url = withWorkspace("/api/folders", currentWorkspaceId);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await apiFetch(url);
      const data = await res.json() as { folders?: FolderItem[]; error?: string };
      if (data.error) throw new Error(data.error);
      setFolders(data.folders ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load folders");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { refresh(); }, [refresh]);

  return { folders, loading, error, refresh };
}
