import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-xl bg-[#e0d8cc]/60", className)} />
  );
}

export function FileCardSkeleton() {
  return (
    <div className="relative flex items-center overflow-hidden rounded-2xl bg-[#fbfaf6] px-4 py-3.5 pl-5 shadow-[0_1px_3px_rgba(74,64,54,0.08)]">
      <div className="absolute inset-y-0 left-0 w-[3.5px] rounded-r bg-[#e0d8cc]" />
      <div className="flex flex-1 items-center gap-3">
        <Skeleton className="h-11 w-11 flex-shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
        <Skeleton className="h-8 w-8 flex-shrink-0 rounded-full" />
      </div>
    </div>
  );
}
