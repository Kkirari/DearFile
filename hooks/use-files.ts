"use client";

import { useState, useEffect, useCallback } from "react";
import type { FileItem } from "@/types/file";
import { apiFetch } from "@/lib/api-client";
import { useWorkspace, withWorkspace } from "@/providers/workspace-provider";

interface UseFilesResult {
  files: FileItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// folderId: undefined/null = inbox (uploads/)
// folderId: "all"          = all files across every prefix
// folderId: string         = specific folder
export function useFiles(folderId?: string | null): UseFilesResult {
  const { currentWorkspaceId } = useWorkspace();
  const [files, setFiles]     = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const baseUrl =
    folderId === "all" ? "/api/files?scope=all" :
    folderId           ? `/api/files?folderId=${folderId}` :
                         "/api/files";
  const url = withWorkspace(baseUrl, currentWorkspaceId);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res  = await apiFetch(url);
      if (!res.ok) throw new Error(`Failed to fetch files (${res.status})`);
      const data = await res.json() as { files: FileItem[] };
      setFiles(data.files);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { refresh(); }, [refresh]);

  return { files, loading, error, refresh };
}
