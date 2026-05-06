"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Profile } from "@liff/get-profile";

type LiffState = {
  ready: boolean;
  loggedIn: boolean;
  profile: Profile | null;
  error: string | null;
  login: () => void;
  logout: () => void;
};

const LiffContext = createContext<LiffState>({
  ready: false,
  loggedIn: false,
  profile: null,
  error: null,
  login: () => {},
  logout: () => {},
});

export function LiffProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) {
      setError("NEXT_PUBLIC_LIFF_ID is not set");
      setReady(true);
      return;
    }

    const liff = window.liff;

    console.log("[LIFF] init start — liffId:", liffId);

    liff
      .init({ liffId })
      .then(async () => {
        const isLoggedIn = liff.isLoggedIn();
        console.log("[LIFF] init success — isLoggedIn:", isLoggedIn);
        console.log("[LIFF] context:", liff.getContext());

        if (!isLoggedIn) {
          console.log("[LIFF] not logged in → redirecting to LINE login...");
          liff.login();
          return;
        }

        console.log("[LIFF] session found, fetching profile...");
        const userProfile = await liff.getProfile();
        console.log("[LIFF] profile:", {
          userId: userProfile.userId,
          displayName: userProfile.displayName,
          pictureUrl: userProfile.pictureUrl,
        });

        setProfile(userProfile);
        setLoggedIn(true);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "LIFF init failed";
        console.error("[LIFF] error:", err);
        setError(msg);
      })
      .finally(() => {
        console.log("[LIFF] ready");
        setReady(true);
      });
  }, []);

  function login() {
    window.liff.login();
  }

  function logout() {
    window.liff.logout();
    setLoggedIn(false);
    setProfile(null);
  }

  return (
    <LiffContext.Provider value={{ ready, loggedIn, profile, error, login, logout }}>
      {children}
    </LiffContext.Provider>
  );
}

export function useLiff() {
  return useContext(LiffContext);
}
