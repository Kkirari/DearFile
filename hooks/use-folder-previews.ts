"use client";

import { useEffect, useState, useCallback } from "react";

export interface FolderPreviewItem {
  url: string;
  isImage: boolean;
  mimeType: string;
}

export interface FolderPreview {
  total: number;
  thumbnails: FolderPreviewItem[];
}

export type PreviewsMap = Record<string, FolderPreview>;

/**
 * Fetches preview thumbnails for every folder in one batch request.
 * Auto-refreshes when the `key` prop changes (e.g. after upload/delete).
 */
export function useFolderPreviews(refreshKey: number | string = 0) {
  const [previews, setPreviews] = useState<PreviewsMap>({});
  const [loading, setLoading]   = useState(true);

  const fetchPreviews = useCallback(async () => {
    try {
      setLoading(true);
      const res  = await fetch("/api/folders/previews");
      const data = await res.json() as { previews?: PreviewsMap };
      setPreviews(data.previews ?? {});
    } catch (err) {
      console.error("[useFolderPreviews]", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreviews();
  }, [fetchPreviews, refreshKey]);

  return { previews, loading, refresh: fetchPreviews };
}
