'use client';

export default function TimelineSkeleton() {
  return (
    <div className="w-full animate-pulse space-y-4">
      <div className="h-6 w-48 bg-trace-border/30 rounded" />
      <div className="rounded-lg border border-trace-border bg-trace-surface/50 p-4 space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="w-36 h-4 bg-trace-border/30 rounded" />
            <div className="flex-1 h-px bg-trace-border/20 relative">
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-trace-border/40"
                style={{ left: `${20 + i * 25}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="h-20 bg-trace-border/20 rounded-lg" />
    </div>
  );
}
