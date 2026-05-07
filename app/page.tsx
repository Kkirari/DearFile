"use client";

import Image from "next/image";
import { HomeScreen } from "@/components/home-screen";
import { useLiff } from "@/providers/liff-provider";
import { useLanguage } from "@/providers/language-provider";

export default function HomePage() {
  const { ready, profile, error } = useLiff();
  const { tr } = useLanguage();

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f4f3ee] dark:bg-[#1c1a18]">
        <div className="flex flex-col items-center gap-5">
          <div className="relative">
            <Image
              src="/icon/icon.png"
              alt="DearFile"
              width={64}
              height={64}
              priority
              className="h-16 w-16 rounded-2xl shadow-[0_6px_20px_rgba(155,134,156,0.3)]"
            />
            <div className="logo-ring absolute inset-0 rounded-2xl border-2 border-[#9b869c]/50" />
          </div>
          <p className="text-sm font-medium text-[#b0a396] dark:text-[#6e6460]">{tr.connecting}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f4f3ee] dark:bg-[#1c1a18] px-8">
        <div className="page-fade w-full max-w-sm rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#252220] p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-950/40">
            <span className="text-xl">⚠️</span>
          </div>
          <p className="text-sm font-semibold text-[#4a4036] dark:text-[#e8ddd4]">{tr.error}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-[#b0a396] dark:text-[#6e6460]">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <HomeScreen
      displayName={profile?.displayName}
      pictureUrl={profile?.pictureUrl}
    />
  );
}
