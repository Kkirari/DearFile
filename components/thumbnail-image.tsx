"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Image as ImageIcon } from "lucide-react";

interface ThumbnailImageProps {
  src: string;
  alt: string;
  /** Class names applied to the wrapper (sizing + rounding). */
  className?: string;
  /** Class names applied to the inner img (object-fit etc.). */
  imgClassName?: string;
  /** Fallback icon shown when the image errors out. */
  fallbackIcon?: LucideIcon;
  /** Tailwind size for the fallback icon (default 18). */
  fallbackSize?: number;
}

/**
 * <img> wrapper that shows a shimmering placeholder until the image decodes,
 * then fades it in. Falls back to an icon on error. The placeholder reads
 * exactly like the existing animate-pulse skeleton language used elsewhere
 * (e.g. `RecentSkeleton`, `FolderSkeleton`) so it blends in.
 */
export function ThumbnailImage({
  src,
  alt,
  className   = "",
  imgClassName = "",
  fallbackIcon,
  fallbackSize = 18,
}: ThumbnailImageProps) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const FallbackIcon = fallbackIcon ?? ImageIcon;

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {state !== "loaded" && (
        <div
          className={`absolute inset-0 ${
            state === "error"
              ? "flex items-center justify-center bg-[#e0d8cc]/40 dark:bg-[#3a3430]/40"
              : "animate-pulse bg-[#e0d8cc]/60 dark:bg-[#3a3430]/60"
          }`}
        >
          {state === "error" && (
            <FallbackIcon size={fallbackSize} className="text-[#b0a396] dark:text-[#6e6460]" />
          )}
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
          state === "loaded" ? "opacity-100" : "opacity-0"
        } ${imgClassName}`}
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
      />
    </div>
  );
}
