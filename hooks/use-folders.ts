"use client";

import { useState, useEffect, useCallback } from "react";
import type { FolderItem } from "@/types/folder";
import { apiFetch } from "@/lib/api-client";

export function useFolders() {
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await apiFetch("/api/folders");
      const data = await res.json() as { folders?: FolderItem[]; error?: string };
      if (data.error) throw new Error(data.error);
      setFolders(data.folders ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load folders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { folders, loading, error, refresh };
}
