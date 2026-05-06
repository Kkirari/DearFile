"use client";

import { useState } from "react";
import { FileCard } from "@/components/file-card";
import { EmptyState } from "@/components/empty-state";
import { FileCardSkeleton } from "@/components/ui/skeleton";
import type { FileItem } from "@/types/file";
import { Search } from "lucide-react";

interface FileListProps {
  files: FileItem[];
  loading?: boolean;
  onDelete?: (id: string) => void;
}

export function FileList({ files, loading, onDelete }: FileListProps) {
  const [query, setQuery] = useState("");

  const filtered = files.filter((f) =>
    f.name.toLowerCase().includes(query.toLowerCase())
  );

  if (loading) {
    return (
      <div className="space-y-2.5 px-4 py-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <FileCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-5">
      {files.length > 0 && (
        <div className="relative">
          <Search
            size={15}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#b0a396]"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาไฟล์..."
            className="w-full rounded-xl border border-[#e0d8cc] bg-white py-2.5 pl-9 pr-4 text-sm text-[#4a4036] shadow-[0_1px_2px_rgba(74,64,54,0.06)] placeholder:text-[#b0a396] focus:border-[#9b869c]/50 focus:outline-none focus:ring-2 focus:ring-[#9b869c]/15 transition-shadow"
          />
        </div>
      )}

      {files.length > 0 && (
        <div className="flex items-center justify-between px-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#b0a396]">
            ไฟล์ทั้งหมด
          </p>
          {query && (
            <p className="text-[11px] text-[#b0a396]">
              พบ {filtered.length} รายการ
            </p>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((file, i) => (
            <FileCard key={file.id} file={file} index={i} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
