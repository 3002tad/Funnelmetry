import clsx from 'clsx'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={clsx(
      "relative overflow-hidden rounded-md bg-slate-800/40",
      "before:absolute before:inset-0",
      "before:bg-gradient-to-r before:from-transparent before:via-slate-700/30 before:to-transparent",
      "before:animate-[shimmer_1.5s_infinite]",
      className
    )} />
  )
}

export function KPICardSkeleton() {
  return (
    <div className="glass rounded-2xl p-5 h-[126px]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-2.5 w-16" />
        </div>
        <Skeleton className="w-11 h-11 rounded-xl" />
      </div>
    </div>
  )
}

export function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <div style={{ height }} className="flex flex-col gap-4 p-2">
      <div className="flex items-end gap-2 flex-1 pb-4">
        {[...Array(12)].map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1"
            // Random heights for natural look
          />
        ))}
      </div>
      <div className="flex justify-between">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-2.5 w-8" />
        ))}
      </div>
    </div>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="flex gap-3 items-center py-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}
