'use client';

import { LANE_LABEL_MARGIN } from '@/lib/layout';

interface FailureCalloutProps {
  relativeMs: number;
  totalDurationMs: number;
  serviceName: string;
  message: string;
}

export default function FailureCallout({
  relativeMs,
  totalDurationMs,
  serviceName,
  message,
}: FailureCalloutProps) {
  const duration = totalDurationMs || 1;
  const leftPercent = (relativeMs / duration) * 100;

  return (
    <div
      className={`absolute top-0 bottom-0 z-20 pointer-events-none ${LANE_LABEL_MARGIN}`}
      style={{ left: `${leftPercent}%`, width: 0 }}
    >
      <div className="relative h-full">
        <div className="absolute top-0 bottom-0 w-px bg-trace-failure/80" />
        <div className="absolute top-0 -translate-x-1/2 whitespace-nowrap">
          <span className="inline-block rounded bg-trace-failure/20 border border-trace-failure/40 px-2 py-0.5 text-[10px] text-trace-failure font-medium">
            Failure @ {relativeMs}ms — {serviceName}
          </span>
        </div>
        <div className="absolute bottom-0 -translate-x-1/2 max-w-[140px] truncate">
          <span className="text-[10px] text-trace-failure/70" title={message}>
            {message}
          </span>
        </div>
      </div>
    </div>
  );
}
