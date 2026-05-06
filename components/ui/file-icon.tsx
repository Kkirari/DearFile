import {
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileSpreadsheet,
  File,
} from "lucide-react";
import { getFileIcon } from "@/lib/utils";
import { cn } from "@/lib/utils";

const iconMap = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  doc: FileText,
  sheet: FileSpreadsheet,
  archive: FileArchive,
  file: File,
};

const colorMap: Record<string, string> = {
  image: "text-violet-600 bg-violet-50",
  video: "text-blue-600 bg-blue-50",
  audio: "text-pink-600 bg-pink-50",
  pdf: "text-red-600 bg-red-50",
  doc: "text-blue-700 bg-blue-50",
  sheet: "text-emerald-600 bg-emerald-50",
  archive: "text-amber-600 bg-amber-50",
  file: "text-stone-500 bg-stone-100",
};

interface FileIconProps {
  mimeType: string;
  className?: string;
  size?: number;
}

export function FileIcon({ mimeType, className, size = 19 }: FileIconProps) {
  const type = getFileIcon(mimeType);
  const Icon = iconMap[type as keyof typeof iconMap] ?? File;
  const color = colorMap[type] ?? colorMap.file;

  return (
    <span
      className={cn(
        "inline-flex flex-shrink-0 items-center justify-center rounded-xl p-2.5",
        color,
        className
      )}
    >
      <Icon size={size} />
    </span>
  );
}
