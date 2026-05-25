"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";

export interface ProfileData {
  interests: string[];
  about: string | null;
  updatedAt: string;
}

/** Fetch (and clear) the user's interest profile — Phase 9 "About you" card. */
export function useProfile() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch("/api/profile");
      const j = res.ok ? await res.json() : null;
      setProfile(j && Array.isArray(j.interests) ? (j as ProfileData) : null);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(async () => {
    try {
      await apiFetch("/api/profile", { method: "DELETE" });
    } catch {
      /* ignore — UI clears optimistically */
    }
    setProfile(null);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { profile, loading, refresh, clear };
}
