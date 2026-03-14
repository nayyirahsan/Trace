'use client';

import type { NarrativeResult, ParseStats, Timeline as TimelineType } from '@/lib/types';
import { formatMs, niceTicks } from '@/lib/format';
import { LANE_LABEL_MARGIN } from '@/lib/layout';
import NarrativeCard from './NarrativeCard';
import ServiceLane from './ServiceLane';

interface TimelineProps {
  timeline: TimelineType;
  narrative?: NarrativeResult | null;
  stats?: ParseStats | null;
}

export default function Timeline({ timeline, narrative, stats }: TimelineProps) {
  const duration = timeline.totalDurationMs || 1;
  const ticks = niceTicks(duration);
  const fail = timeline.failurePoint;
  const failPct = fail ? Math.min((fail.relativeMs / duration) * 100, 100) : null;
  const skipped = stats ? stats.totalEntries + stats.malformedLines - stats.parsedEntries : 0;

  return (
    <section className="w-full">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-trace-muted">
            Request timeline
          </p>
          <h2 className="mt-1.5 min-w-0">
            <span className="inline-block max-w-full truncate rounded-md border border-trace-accent/30 bg-trace-accent/10 px-2 py-0.5 align-bottom font-mono text-base font-semibold text-trace-accent">
              {timeline.correlationId}
            </span>
          </h2>
        </div>
        <p className="whitespace-nowrap font-mono text-[11px] tabular-nums text-trace-muted">
          {timeline.eventCount} events · {timeline.services.length}{' '}
          {timeline.services.length === 1 ? 'service' : 'services'} · {formatMs(timeline.totalDurationMs)}
        </p>
      </div>

      {skipped > 0 && stats && (
        <p className="mb-2 font-mono text-[11px] text-trace-muted">
          parsed {stats.parsedEntries}/{stats.totalEntries + stats.malformedLines} lines
          {stats.malformedLines > 0 && <> · <span className="text-trace-warning/80">{stats.malformedLines} malformed</span></>}
          {stats.missingTimestamp > 0 && <> · {stats.missingTimestamp} no timestamp</>}
          {stats.missingCorrelationId > 0 && <> · {stats.missingCorrelationId} no correlation id</>}
        </p>
      )}

      {timeline.suspectedSkew && timeline.suspectedSkew.length > 0 && (
        <div className="mb-3 rounded-lg border border-trace-warning/30 bg-trace-warning/[0.08] px-3 py-2 font-mono text-[11px] leading-relaxed text-trace-warning">
          ⚠ suspected clock skew — {timeline.suspectedSkew
            .map((w) => `${w.serviceName} ~${formatMs(Math.abs(w.offsetMs))} ${w.offsetMs < 0 ? 'behind' : 'ahead'}`)
            .join(' · ')}
          <span className="text-trace-warning/60"> · timestamps shown as logged</span>
        </div>
      )}

      {/* Panel */}
      <div className="rounded-xl border border-trace-border bg-trace-surface/90 shadow-panel">
        <div className="px-4 pb-3 pt-2.5">
          {/* Failure flag strip — reserved space so the flag never overlaps content */}
          <div className={`relative h-7 ${LANE_LABEL_MARGIN}`}>
            {failPct !== null && fail && (
              <span
                className="absolute bottom-1 whitespace-nowrap rounded border border-trace-failure/40 bg-[#2a1216] px-1.5 py-px font-mono text-[10px] font-medium tracking-wide text-trace-failure"
                style={{
                  left: `${failPct}%`,
                  transform:
                    failPct > 80 ? 'translateX(-100%)' : failPct < 8 ? 'none' : 'translateX(-50%)',
                }}
              >
                ✗ failure {formatMs(fail.relativeMs)}
              </span>
            )}
          </div>

          {/* Axis + lanes share one coordinate system */}
          <div className="relative">
            {/* Grid + failure cursor, spanning axis and all lanes */}
            <div className={`pointer-events-none absolute inset-y-0 right-0 ${LANE_LABEL_MARGIN} left-0`}>
              <div className="relative h-full">
                {ticks.map((t) => (
                  <div
                    key={t}
                    className="absolute inset-y-0 w-px bg-white/[0.05]"
                    style={{ left: `${(t / duration) * 100}%` }}
                  />
                ))}
                {failPct !== null && (
                  <div
                    className="absolute inset-y-0 w-px bg-trace-failure/70 shadow-glow-red"
                    style={{ left: `${failPct}%` }}
                  />
                )}
              </div>
            </div>

            {/* Tick labels */}
            <div className={`relative h-5 ${LANE_LABEL_MARGIN}`}>
              {ticks.map((t) => {
                const pct = (t / duration) * 100;
                return (
                  <span
                    key={t}
                    className="absolute top-0 font-mono text-[10px] tabular-nums text-trace-faint"
                    style={{
                      left: `${pct}%`,
                      transform: pct === 0 ? 'none' : pct > 90 ? 'translateX(-100%)' : 'translateX(-50%)',
                    }}
                  >
                    {formatMs(t)}
                  </span>
                );
              })}
            </div>

            {/* Lanes */}
            <div>
              {timeline.services.map((service) => (
                <ServiceLane key={service.serviceName} service={service} totalDurationMs={duration} />
              ))}
            </div>
          </div>
        </div>

        {/* Failure detail — its own strip, never floating over the chart */}
        {fail && (
          <div className="flex items-start gap-2.5 rounded-b-xl border-t border-trace-failure/25 bg-trace-failure/[0.07] px-4 py-2.5">
            <span className="font-mono text-sm leading-5 text-trace-failure">✗</span>
            <div className="min-w-0">
              <p className="font-mono text-xs font-medium tabular-nums text-trace-failure">
                {fail.serviceName} · {formatMs(fail.relativeMs)}
                {fail.statusCode > 0 && ` · HTTP ${fail.statusCode}`}
              </p>
              <p className="mt-0.5 break-words text-xs leading-relaxed text-trace-ink/85">
                {fail.message || '(no message)'}
              </p>
            </div>
            {timeline.lastSuccess && (
              <p className="ml-auto shrink-0 pt-0.5 font-mono text-[10px] tabular-nums text-trace-muted">
                last ok · {timeline.lastSuccess.serviceName} @ {formatMs(timeline.lastSuccess.relativeMs)}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-2 flex items-center justify-end gap-4 font-mono text-[10px] text-trace-muted">
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-trace-success" /> ok
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-trace-failure" /> failure
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-trace-warning ring-2 ring-trace-warning/30" /> last success
        </span>
      </div>

      <NarrativeCard narrative={narrative ?? null} />
    </section>
  );
}
