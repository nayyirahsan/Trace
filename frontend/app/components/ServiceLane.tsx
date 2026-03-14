'use client';

import type { ServiceTimeline } from '@/lib/types';
import { formatMs } from '@/lib/format';
import { LANE_LABEL_WIDTH } from '@/lib/layout';
import EventMarker from './EventMarker';

interface ServiceLaneProps {
  service: ServiceTimeline;
  totalDurationMs: number;
}

export default function ServiceLane({ service, totalDurationMs }: ServiceLaneProps) {
  const duration = totalDurationMs || 1;
  const first = service.events[0]?.relativeMs ?? 0;
  const last = service.events[service.events.length - 1]?.relativeMs ?? 0;
  const bandLeft = (first / duration) * 100;
  const bandWidth = Math.max(((last - first) / duration) * 100, 0.4);

  // Nudge markers that land nearly on top of each other apart vertically.
  let prevPct = -Infinity;
  let flip = 1;
  const yOffsets = service.events.map((e) => {
    const pct = (e.relativeMs / duration) * 100;
    let y = 0;
    if (pct - prevPct < 2.5) {
      y = flip * 6;
      flip = -flip;
    } else {
      flip = 1;
    }
    prevPct = pct;
    return y;
  });

  return (
    <div className="flex h-12 items-stretch border-t border-trace-hairline first:border-t-0">
      <div className={`${LANE_LABEL_WIDTH} flex min-w-0 shrink-0 flex-col justify-center pr-3`}>
        <span
          className="truncate font-mono text-[13px] font-medium leading-tight text-trace-ink"
          title={service.serviceName}
        >
          {service.serviceName}
        </span>
        <span className="mt-0.5 truncate font-mono text-[10px] tabular-nums text-trace-muted">
          {service.events.length} ev · @{formatMs(first)}
          {service.hasFailure && <span className="text-trace-failure"> · ✗</span>}
        </span>
      </div>

      <div className="relative min-w-0 flex-1">
        {/* Activity band: the service's first→last event window */}
        <div
          className={`absolute top-1/2 h-[7px] -translate-y-1/2 rounded-full ${
            service.hasFailure
              ? 'bg-trace-failure/15 ring-1 ring-inset ring-trace-failure/25'
              : 'bg-white/[0.05] ring-1 ring-inset ring-white/[0.07]'
          }`}
          style={{ left: `${bandLeft}%`, width: `${bandWidth}%`, minWidth: 7 }}
        />
        {service.events.map((event, i) => (
          <EventMarker
            key={`${event.relativeMs}-${i}`}
            event={event}
            leftPercent={(event.relativeMs / duration) * 100}
            yOffset={yOffsets[i]}
          />
        ))}
      </div>
    </div>
  );
}
