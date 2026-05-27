"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

export interface MaskedMcpToken {
  tokenHash:  string;
  label:      string | null;
  masked:     string;
  createdAt:  string;
  lastUsedAt: string | null;
}

export interface MintResult {
  plaintext: string;
  tokenHash: string;
  masked:    string;
  createdAt: string;
}

/** Backs the Profile tab "MCP Access" card. */
export function useMcpTokens() {
  const [tokens, setTokens] = useState<MaskedMcpToken[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch("/api/mcp/tokens");
      if (!res.ok) {
        setTokens([]);
        return;
      }
      const j = (await res.json()) as { tokens?: MaskedMcpToken[] };
      setTokens(Array.isArray(j.tokens) ? j.tokens : []);
    } catch {
      setTokens([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const mint = useCallback(async (label?: string): Promise<{ ok: boolean; result?: MintResult; error?: string }> => {
    try {
      const res = await apiFetch("/api/mcp/tokens", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ label: label ?? null }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; plaintext?: string; tokenHash?: string; masked?: string; createdAt?: string; error?: string };
      if (!res.ok || !j.ok || !j.plaintext) {
        return { ok: false, error: j.error || `Request failed (${res.status})` };
      }
      const result: MintResult = {
        plaintext: j.plaintext,
        tokenHash: j.tokenHash!,
        masked:    j.masked!,
        createdAt: j.createdAt!,
      };
      // Optimistic insert + refresh (covers other clients).
      setTokens((prev) => [{
        tokenHash:  result.tokenHash,
        label:      label?.trim() || null,
        masked:     result.masked,
        createdAt:  result.createdAt,
        lastUsedAt: null,
      }, ...prev]);
      refresh().catch(() => {});
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [refresh]);

  const revoke = useCallback(async (tokenHash: string): Promise<void> => {
    try {
      await apiFetch(`/api/mcp/tokens?hash=${encodeURIComponent(tokenHash)}`, { method: "DELETE" });
    } catch {
      /* swallow — UI updates optimistically */
    }
    setTokens((prev) => prev.filter((t) => t.tokenHash !== tokenHash));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { tokens, loading, refresh, mint, revoke };
}
