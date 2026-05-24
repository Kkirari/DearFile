"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import type { Capture } from "@/types/capture";

interface UseCapturesResult {
  items: Capture[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** Fetch the user's Timeline captures (notes/links) from /api/captures. */
export function useCaptures(): UseCapturesResult {
  const [items, setItems]     = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // Wide window so the calendar can mark/drill into past days.
      // (Cursor pagination for very long histories is a later improvement.)
      const res = await apiFetch("/api/captures?limit=300");
      if (!res.ok) throw new Error(`Failed to fetch captures (${res.status})`);
      const data = (await res.json()) as { items: Capture[] };
      setItems(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { items, loading, error, refresh };
}
