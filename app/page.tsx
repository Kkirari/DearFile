"use client";

import { HomeScreen } from "@/components/home-screen";
import { useLiff } from "@/providers/liff-provider";

export default function HomePage() {
  const { ready, profile, error } = useLiff();

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f4f3ee]">
        <div className="flex flex-col items-center gap-5">
          <div className="relative">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#9b869c] shadow-lg">
              <span className="text-2xl font-black tracking-tight text-white">D</span>
            </div>
            <div className="logo-ring absolute inset-0 rounded-2xl border-2 border-[#9b869c]/50" />
          </div>
          <p className="text-sm font-medium text-[#b0a396]">กำลังเชื่อมต่อ LINE...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f4f3ee] px-8">
        <div className="page-fade w-full max-w-sm rounded-2xl border border-[#e0d8cc] bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50">
            <span className="text-xl">⚠️</span>
          </div>
          <p className="text-sm font-semibold text-[#4a4036]">เกิดข้อผิดพลาด</p>
          <p className="mt-1.5 text-xs leading-relaxed text-[#b0a396]">{error}</p>
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
