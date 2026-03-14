'use client';

import type { TimelineEvent } from '@/lib/types';
import { formatMs } from '@/lib/format';

interface EventMarkerProps {
  event: TimelineEvent;
  leftPercent: number;
  yOffset?: number;
}

export default function EventMarker({ event, leftPercent, yOffset = 0 }: EventMarkerProps) {
  let dotClass = 'bg-trace-success';
  if (event.isFailure) {
    dotClass = 'bg-trace-failure shadow-glow-red';
  } else if (event.isLastSuccess) {
    dotClass = 'bg-trace-warning ring-2 ring-trace-warning/40 shadow-glow-amber';
  }

  // Keep the tooltip inside the panel: anchor it to whichever edge is safe.
  const tooltipAlign =
    leftPercent > 72
      ? 'right-0'
      : leftPercent < 28
        ? 'left-0 -translate-x-2'
        : 'left-1/2 -translate-x-1/2';

  return (
    <div
      className="group absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 hover:z-40"
      style={{ left: `${leftPercent}%`, marginTop: yOffset }}
    >
      <div
        className={`h-2.5 w-2.5 cursor-pointer rounded-full shadow-marker transition-transform duration-100 group-hover:scale-150 ${dotClass}`}
      />
      <div
        className={`pointer-events-none absolute top-full mt-2 hidden w-60 group-hover:block ${tooltipAlign}`}
      >
        <div className="rounded-lg border border-trace-border bg-trace-raised p-2.5 shadow-panel">
          <p className="break-words text-xs font-medium leading-snug text-trace-ink">
            {event.message || '(no message)'}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] tabular-nums text-trace-muted">
            <span className="text-trace-faint">t=+{formatMs(event.relativeMs)}</span>
            {event.level && <span>{event.level}</span>}
            {event.statusCode > 0 && (
              <span className={event.statusCode >= 500 ? 'text-trace-failure' : ''}>
                HTTP {event.statusCode}
              </span>
            )}
            {event.latencyMs > 0 && <span>{formatMs(event.latencyMs)} latency</span>}
            {event.isLastSuccess && <span className="text-trace-warning">last success</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
