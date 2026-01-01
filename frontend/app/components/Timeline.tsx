'use client';

import type { NarrativeResult, Timeline as TimelineType } from '@/lib/types';
import { LANE_LABEL_MARGIN } from '@/lib/layout';
import FailureCallout from './FailureCallout';
import NarrativeCard from './NarrativeCard';
import ServiceLane from './ServiceLane';

interface TimelineProps {
  timeline: TimelineType;
  narrative?: NarrativeResult | null;
}

function getTickInterval(totalMs: number): number {
  if (totalMs <= 200) return 10;
  if (totalMs <= 2000) return 100;
  return 1000;
}

export default function Timeline({ timeline, narrative }: TimelineProps) {
  const duration = timeline.totalDurationMs || 1;
  const tickInterval = getTickInterval(duration);
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += tickInterval) {
    ticks.push(t);
  }
  if (ticks[ticks.length - 1] !== duration) {
    ticks.push(duration);
  }

  return (
    <div className="w-full">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-100">
          Timeline — <span className="font-mono text-trace-accent">{timeline.correlationId}</span>
        </h2>
        <span className="text-xs text-trace-muted">
          {timeline.eventCount} events · {timeline.totalDurationMs}ms total · {timeline.services.length} services
        </span>
      </div>

      <div className="relative rounded-lg border border-trace-border bg-trace-surface/50 p-4 overflow-x-auto">
        {/* Time axis */}
        <div className={`flex mb-3 ${LANE_LABEL_MARGIN}`}>
          <div className="relative flex-1 h-6">
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute top-0 flex flex-col items-center"
                style={{ left: `${(t / duration) * 100}%`, transform: 'translateX(-50%)' }}
              >
                <div className="w-px h-2 bg-trace-border" />
                <span className="text-[10px] text-trace-muted mt-0.5">{t}ms</span>
              </div>
            ))}
          </div>
        </div>

        {/* Lanes */}
        <div className="relative">
          {timeline.services.map((service, i) => (
            <div key={service.serviceName}>
              <ServiceLane service={service} totalDurationMs={duration} />
              {/* Cross-lane connectors */}
              {i < timeline.services.length - 1 && (
                <div className={`flex ${LANE_LABEL_MARGIN} h-4 relative`}>
                  <svg className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none">
                    <line
                      x1={`${((service.events[service.events.length - 1]?.relativeMs ?? 0) / duration) * 100}%`}
                      y1="0"
                      x2={`${((timeline.services[i + 1].events[0]?.relativeMs ?? 0) / duration) * 100}%`}
                      y2="100%"
                      stroke="currentColor"
                      strokeWidth="1"
                      strokeDasharray="4 3"
                      className="text-trace-border"
                    />
                  </svg>
                </div>
              )}
            </div>
          ))}

          {timeline.failurePoint && (
            <FailureCallout
              relativeMs={timeline.failurePoint.relativeMs}
              totalDurationMs={duration}
              serviceName={timeline.failurePoint.serviceName}
              message={timeline.failurePoint.message}
            />
          )}
        </div>
      </div>

      <NarrativeCard narrative={narrative ?? null} />
    </div>
  );
}
