"use client";

import Image from "next/image";
import { useLanguage } from "@/providers/language-provider";

interface HeaderProps {
  displayName?: string;
  pictureUrl?: string;
  totalFiles?: number;
}

export function Header({ displayName, pictureUrl, totalFiles }: HeaderProps) {
  const { tr } = useLanguage();

  return (
    <header className="sticky top-0 z-10 border-b border-[#e0d8cc] dark:border-[#3a3430] bg-[#f4f3ee]/90 dark:bg-[#1c1a18]/90 px-5 py-4 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl overflow-hidden shadow-sm">
            <Image
              src="/icon/icon.png"
              alt="DearFile"
              width={40}
              height={40}
              className="h-full w-full object-cover"
              unoptimized
            />
          </div>
          <div>
            <h1 className="text-[15px] font-extrabold leading-tight tracking-tight text-[#4a4036] dark:text-[#e8ddd4]">
              DearFile
            </h1>
            {displayName ? (
              <p className="text-[11px] leading-tight text-[#b0a396] dark:text-[#6e6460]">{tr.greeting}, {displayName}</p>
            ) : (
              <p className="text-[11px] leading-tight text-[#b0a396] dark:text-[#6e6460]">{tr.tagline}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {totalFiles !== undefined && (
            <span className="rounded-full border border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#252220] px-2.5 py-0.5 text-[11px] font-semibold text-[#9b869c]">
              {totalFiles} {tr.files}
            </span>
          )}
          {pictureUrl && (
            <Image
              src={pictureUrl}
              alt={displayName ?? "profile"}
              width={34}
              height={34}
              className="rounded-full object-cover ring-2 ring-[#9b869c]/30"
            />
          )}
        </div>
      </div>
    </header>
  );
}
