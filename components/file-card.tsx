"use client";

import { Download, Trash2, MoreVertical } from "lucide-react";
import { FileIcon } from "@/components/ui/file-icon";
import { formatBytes, formatDate, getFileIcon } from "@/lib/utils";
import type { FileItem } from "@/types/file";
import { useState } from "react";

interface FileCardProps {
  file: FileItem;
  index?: number;
  onDelete?: (id: string) => void;
}

const tapeColorMap: Record<string, string> = {
  image: "#7C3AED",
  video: "#2563EB",
  audio: "#DB2777",
  pdf: "#DC2626",
  doc: "#1D4ED8",
  sheet: "#16A34A",
  archive: "#D97706",
  file: "#9b869c",
};

export function FileCard({ file, index = 0, onDelete }: FileCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const fileType = getFileIcon(file.mimeType);
  const tapeColor = tapeColorMap[fileType] ?? tapeColorMap.file;

  return (
    <div
      className="card-enter relative flex items-center overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(74,64,54,0.08),0_1px_2px_rgba(74,64,54,0.05)] transition-shadow hover:shadow-[0_4px_14px_rgba(74,64,54,0.12)]"
      style={{ animationDelay: `${index * 55}ms` }}
    >
      <div
        className="absolute inset-y-0 left-0 w-[3.5px]"
        style={{ backgroundColor: tapeColor }}
      />

      <div className="flex flex-1 items-center gap-3 px-4 py-3.5 pl-5 min-w-0">
        <FileIcon mimeType={file.mimeType} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#4a4036]">{file.name}</p>
          <p className="mt-0.5 text-xs text-[#b0a396]">
            {formatBytes(file.size)} · {formatDate(file.createdAt)}
          </p>
        </div>

        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[#b0a396] transition-colors hover:bg-[#f4f3ee] hover:text-[#4a4036]"
        >
          <MoreVertical size={16} />
        </button>
      </div>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-4 top-12 z-20 min-w-[148px] overflow-hidden rounded-xl border border-[#e0d8cc] bg-white shadow-lg shadow-[#b0a396]/20">
            <a
              href={file.url}
              download={file.name}
              className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-[#4a4036] transition-colors hover:bg-[#f4f3ee]"
              onClick={() => setMenuOpen(false)}
            >
              <Download size={14} className="text-[#b0a396]" />
              ดาวน์โหลด
            </a>
            <div className="mx-3 h-px bg-[#e0d8cc]" />
            <button
              onClick={() => {
                setMenuOpen(false);
                onDelete?.(file.id);
              }}
              className="flex w-full items-center gap-2.5 px-4 py-3 text-sm font-medium text-red-500 transition-colors hover:bg-red-50"
            >
              <Trash2 size={14} />
              ลบไฟล์
            </button>
          </div>
        </>
      )}
    </div>
  );
}
