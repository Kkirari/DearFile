"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Profile } from "@liff/get-profile";
import { configureApiAuth, markApiAuthReady } from "@/lib/api-client";

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

function waitForLiffSdk(
  timeoutMs = 5000,
): Promise<NonNullable<typeof window.liff>> {
  return new Promise((resolve, reject) => {
    if (window.liff) {
      resolve(window.liff);
      return;
    }

    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      if (window.liff) {
        window.clearInterval(interval);
        resolve(window.liff);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(interval);
        reject(new Error("LIFF SDK did not load"));
      }
    }, 50);
  });
}

export function LiffProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      const devUserId = process.env.NEXT_PUBLIC_DEV_USER_ID;

      // Local dev shortcut — no LIFF id but a dev user configured: send a
      // literal "dev" Bearer token that the API maps to DEV_USER_ID server-side.
      if (!liffId) {
        if (devUserId) {
          console.log(
            "[LIFF] no NEXT_PUBLIC_LIFF_ID — using dev bypass for",
            devUserId,
          );
          configureApiAuth(() => "dev");
          if (!cancelled) setReady(true);
          return;
        }
        if (!cancelled) {
          setError("NEXT_PUBLIC_LIFF_ID is not set");
          markApiAuthReady(null);
          setReady(true);
        }
        return;
      }

      try {
        const liff = await waitForLiffSdk();
        console.log("[LIFF] init start — liffId:", liffId);

        await liff.init({ liffId });
        const isLoggedIn = liff.isLoggedIn();
        console.log("[LIFF] init success — isLoggedIn:", isLoggedIn);
        console.log("[LIFF] context:", liff.getContext());

        if (!isLoggedIn) {
          console.log("[LIFF] not logged in → redirecting to LINE login...");
          liff.login();
          if (!cancelled) setReady(true);
          return;
        }

        // LIFF refreshes the ID token internally; reading it on every fetch
        // gives apiFetch a fresh-enough token without us tracking expiry.
        configureApiAuth(() => liff.getIDToken());
        if (!cancelled) {
          setLoggedIn(true);
          setReady(true);
        }

        // Profile is display-only. Fetch it after the app shell can render so
        // entering LIFF is not blocked by an extra network/API round trip.
        liff
          .getProfile()
          .then((userProfile) => {
            console.log("[LIFF] profile:", {
              userId: userProfile.userId,
              displayName: userProfile.displayName,
              pictureUrl: userProfile.pictureUrl,
            });
            if (!cancelled) setProfile(userProfile);
          })
          .catch((err: unknown) => {
            console.warn("[LIFF] profile fetch skipped:", err);
          });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "LIFF init failed";
        console.error("[LIFF] error:", err);
        if (!cancelled) {
          setError(msg);
          markApiAuthReady(null);
          setReady(true);
        }
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
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
    <LiffContext.Provider
      value={{ ready, loggedIn, profile, error, login, logout }}
    >
      {children}
    </LiffContext.Provider>
  );
}

export function useLiff() {
  return useContext(LiffContext);
}
