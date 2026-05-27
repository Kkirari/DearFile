"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

export type ByokProvider = "anthropic" | "voyage";

export interface KeyStatus {
  set: boolean;
  last4?: string;
  updatedAt?: string;
}

export interface ByokStatus {
  anthropic: KeyStatus;
  voyage: KeyStatus;
}

const EMPTY: ByokStatus = { anthropic: { set: false }, voyage: { set: false } };

/**
 * BYOK API keys hook — backs the Profile tab "API Keys" card.
 * `available=false` when the server returns 503 (BYOK_ENCRYPTION_KEY unset);
 * the UI hides the whole card in that case.
 */
export function useByokKeys() {
  const [status, setStatus] = useState<ByokStatus>(EMPTY);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch("/api/keys");
      if (res.status === 503) {
        setAvailable(false);
        setStatus(EMPTY);
        return;
      }
      if (!res.ok) {
        setStatus(EMPTY);
        return;
      }
      const j = (await res.json()) as ByokStatus;
      setStatus({
        anthropic: j.anthropic ?? { set: false },
        voyage:    j.voyage ?? { set: false },
      });
      setAvailable(true);
    } catch {
      setStatus(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (provider: ByokProvider, key: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await apiFetch("/api/keys", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ provider, key }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: ByokStatus; error?: string };
      if (!res.ok || !j.ok) return { ok: false, error: j.error || `Request failed (${res.status})` };
      if (j.status) setStatus(j.status);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  const remove = useCallback(async (provider: ByokProvider): Promise<void> => {
    try {
      const res = await apiFetch(`/api/keys?provider=${provider}`, { method: "DELETE" });
      const j = (await res.json().catch(() => ({}))) as { status?: ByokStatus };
      if (j.status) setStatus(j.status);
      else          setStatus((prev) => ({ ...prev, [provider]: { set: false } }));
    } catch {
      setStatus((prev) => ({ ...prev, [provider]: { set: false } }));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { status, available, loading, refresh, save, remove };
}
