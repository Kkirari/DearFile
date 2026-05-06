"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

interface ImageLightboxProps {
  src: string;
  name: string;
  onClose: () => void;
}

export function ImageLightbox({ src, name, onClose }: ImageLightboxProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/92"
      style={{ animation: "fade-in 0.2s ease-out both" }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-12 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm active:bg-white/25 transition-colors"
      >
        <X size={18} />
      </button>

      <img
        src={src}
        alt={name}
        className="max-h-[82dvh] max-w-[96vw] rounded-2xl object-contain shadow-2xl"
        style={{ animation: "scale-in 0.22s cubic-bezier(0.32,0.72,0,1) both" }}
        onClick={(e) => e.stopPropagation()}
      />

      <p className="absolute bottom-10 left-0 right-0 px-8 text-center text-[12px] text-white/40 truncate">
        {name}
      </p>
    </div>
  );
}
