'use client';

import type { ServiceTimeline } from '@/lib/types';
import { LANE_LABEL_WIDTH } from '@/lib/layout';
import EventMarker from './EventMarker';

interface ServiceLaneProps {
  service: ServiceTimeline;
  totalDurationMs: number;
}

export default function ServiceLane({ service, totalDurationMs }: ServiceLaneProps) {
  const duration = totalDurationMs || 1;

  return (
    <div className="flex items-stretch min-h-[48px]">
      <div className={`${LANE_LABEL_WIDTH} shrink-0 flex items-center pr-3`}>
        <span className="text-sm font-mono text-slate-300 break-all leading-tight" title={service.serviceName}>
          {service.serviceName}
        </span>
      </div>
      <div className="relative flex-1 border-b border-trace-border/50">
        <div className="absolute inset-y-0 left-0 right-0 flex items-center">
          <div className="w-full h-px bg-trace-border/30" />
        </div>
        {service.events.map((event, i) => (
          <EventMarker
            key={`${event.relativeMs}-${i}`}
            event={event}
            leftPercent={(event.relativeMs / duration) * 100}
          />
        ))}
      </div>
    </div>
  );
}
