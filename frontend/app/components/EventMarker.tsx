'use client';

import type { TimelineEvent } from '@/lib/types';

interface EventMarkerProps {
  event: TimelineEvent;
  leftPercent: number;
}

export default function EventMarker({ event, leftPercent }: EventMarkerProps) {
  let colorClass = 'bg-trace-success border-trace-success';
  if (event.isFailure) {
    colorClass = 'bg-trace-failure border-trace-failure';
  } else if (event.isLastSuccess) {
    colorClass = 'bg-trace-warning border-trace-warning ring-2 ring-trace-warning/50';
  }

  return (
    <div
      className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
      style={{ left: `${leftPercent}%` }}
    >
      <div
        className={`w-3 h-3 rounded-full border-2 cursor-pointer transition-transform hover:scale-150 ${colorClass}`}
      />
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50">
        <div className="w-56 rounded-md bg-trace-surface border border-trace-border p-3 text-xs shadow-xl">
          <p className="font-medium text-slate-200 mb-1">{event.message || '(no message)'}</p>
          <div className="space-y-0.5 text-trace-muted">
            <p>Level: {event.level || '—'}</p>
            {event.statusCode > 0 && <p>Status: {event.statusCode}</p>}
            {event.latencyMs > 0 && <p>Latency: {event.latencyMs}ms</p>}
            <p>At: {event.relativeMs}ms</p>
          </div>
        </div>
      </div>
    </div>
  );
}
