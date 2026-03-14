'use client';

import { useState } from 'react';
import LogInput from './components/LogInput';
import Timeline from './components/Timeline';
import TimelineSkeleton from './components/TimelineSkeleton';
import { ParseError, parseLogs, shareUrl } from '@/lib/api';
import type { NarrativeResult, ParseStats, SchemaMap, Timeline as TimelineType } from '@/lib/types';

const SAMPLES = [
  { label: 'mixed microservices', file: 'mixed_services_sample.json', id: 'abc-123' },
  { label: 'ndjson · 3 conventions', file: 'ndjson_mixed_conventions.ndjson', id: 'ord-77f2' },
  { label: 'clock skew', file: 'clock_skew_sample.json', id: 'pay-555' },
];

export default function HomePage() {
  const [logs, setLogs] = useState('');
  const [correlationId, setCorrelationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [timeline, setTimeline] = useState<TimelineType | null>(null);
  const [narrative, setNarrative] = useState<NarrativeResult | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] = useState<SchemaMap | null>(null);
  const [stats, setStats] = useState<ParseStats | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadSample(sample: (typeof SAMPLES)[number]) {
    const res = await fetch(`/samples/${sample.file}`);
    setLogs(await res.text());
    setCorrelationId(sample.id);
    setError(null);
  }

  async function handleParse() {
    if (!logs.trim() || !correlationId.trim()) {
      setError('Please provide both logs and a correlation ID');
      return;
    }

    setLoading(true);
    setError(null);
    setTimeline(null);
    setNarrative(null);
    setSessionId(null);
    setSchema(null);
    setStats(null);

    try {
      const result = await parseLogs(logs, correlationId.trim());
      setTimeline(result.timeline);
      setNarrative(result.narrative);
      setSessionId(result.sessionId);
      setSchema(result.schema ?? null);
      setStats(result.stats ?? null);
    } catch (err) {
      if (err instanceof ParseError) {
        setError(err.message);
        setSchema(err.schema ?? null);
        setTimeline(err.timeline ?? null);
      } else {
        setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleShare() {
    if (!sessionId) return;
    await navigator.clipboard.writeText(shareUrl(sessionId));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-trace-border/70 bg-trace-surface/60 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-baseline gap-4 px-6 py-4">
          <h1 className="font-mono text-lg font-semibold tracking-[0.3em] text-trace-ink">
            TRACE<span className="text-trace-accent">▍</span>
          </h1>
          <p className="hidden font-mono text-[11px] text-trace-muted sm:block">
            structured-log narrative reconstructor · no instrumentation required
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* Input panel */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-trace-muted">
                Try a sample
              </span>
              {SAMPLES.map((sample) => (
                <button
                  key={sample.file}
                  type="button"
                  onClick={() => loadSample(sample)}
                  className="rounded-full border border-trace-border bg-trace-surface px-3 py-1 font-mono text-[11px] text-trace-ink/80 transition-colors hover:border-trace-accent/60 hover:text-trace-accent"
                >
                  {sample.label}
                </button>
              ))}
            </div>

            <LogInput value={logs} onChange={setLogs} />

            <div>
              <label
                htmlFor="correlationId"
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-trace-muted"
              >
                Correlation / request ID
              </label>
              <input
                id="correlationId"
                type="text"
                value={correlationId}
                onChange={(e) => setCorrelationId(e.target.value)}
                placeholder="abc-123"
                className="mt-1.5 w-full rounded-lg border border-trace-border bg-trace-surface px-3.5 py-2.5 font-mono text-sm text-trace-ink placeholder:text-trace-faint focus:border-trace-accent/60 focus:outline-none focus:ring-1 focus:ring-trace-accent/60"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleParse}
                disabled={loading}
                className="flex-1 rounded-lg bg-trace-accent px-4 py-2.5 font-mono text-sm font-semibold text-[#06251F] transition-colors hover:bg-[#5eead4] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? 'parsing…' : 'Parse & build timeline'}
              </button>
              {sessionId && (
                <button
                  onClick={handleShare}
                  className="rounded-lg border border-trace-border px-4 py-2.5 font-mono text-sm text-trace-ink/80 transition-colors hover:border-trace-accent/60 hover:text-trace-accent"
                >
                  {copied ? 'copied ✓' : 'Share'}
                </button>
              )}
            </div>

            {error && (
              <div className="rounded-xl border border-trace-failure/30 bg-trace-failure/[0.08] p-4">
                <p className="font-mono text-xs font-medium text-trace-failure">{error}</p>
                {schema && (
                  <div className="mt-3 text-xs text-trace-muted">
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-trace-muted">
                      Inferred schema fields
                    </p>
                    <pre className="overflow-x-auto rounded-lg bg-trace-bg/70 p-2.5 font-mono text-[11px] leading-relaxed">
                      {JSON.stringify(schema, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Timeline panel */}
          <div className="min-w-0">
            {loading && <TimelineSkeleton />}
            {!loading && timeline && timeline.eventCount > 0 && (
              <Timeline timeline={timeline} narrative={narrative} stats={stats} />
            )}
            {!loading && !timeline && !error && (
              <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-trace-border text-center">
                <p className="font-mono text-xs text-trace-muted">
                  paste logs + correlation ID → swimlane timeline
                </p>
                <p className="font-mono text-[10px] text-trace-faint">
                  JSON array or NDJSON · schema inferred automatically
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
