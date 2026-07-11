import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-muted", className)} />;
}

export function CardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-md" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-28" />
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="border-b bg-muted/50 p-3">
        <div className="flex gap-4">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b last:border-0 p-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between mb-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-48" />
      </div>
      <Skeleton className="h-56 w-full" />
    </div>
  );
}