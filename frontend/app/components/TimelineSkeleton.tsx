'use client';

export default function TimelineSkeleton() {
  return (
    <div className="w-full animate-pulse">
      <div className="mb-3 flex items-end justify-between">
        <div className="space-y-2">
          <div className="h-2.5 w-28 rounded bg-trace-border/40" />
          <div className="h-6 w-40 rounded-md bg-trace-border/40" />
        </div>
        <div className="h-3 w-44 rounded bg-trace-border/30" />
      </div>
      <div className="rounded-xl border border-trace-border bg-trace-surface/90 px-4 pb-3 pt-9 shadow-panel">
        <div className="mb-3 ml-44 h-3 rounded bg-trace-border/20" />
        {[28, 46, 64].map((pos, i) => (
          <div key={i} className="flex h-12 items-center border-t border-trace-hairline first:border-t-0">
            <div className="w-44 shrink-0 space-y-1.5 pr-3">
              <div className="h-3 w-28 rounded bg-trace-border/40" />
              <div className="h-2 w-16 rounded bg-trace-border/25" />
            </div>
            <div className="relative h-[7px] flex-1 rounded-full bg-trace-border/15">
              <div
                className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-trace-border/50"
                style={{ left: `${pos}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 h-20 rounded-xl border border-trace-border bg-trace-surface/60" />
    </div>
  );
}
