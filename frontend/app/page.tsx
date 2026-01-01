'use client';

import { useState } from 'react';
import LogInput from './components/LogInput';
import Timeline from './components/Timeline';
import TimelineSkeleton from './components/TimelineSkeleton';
import { ParseError, parseLogs, shareUrl } from '@/lib/api';
import type { NarrativeResult, SchemaMap, Timeline as TimelineType } from '@/lib/types';

export default function HomePage() {
  const [logs, setLogs] = useState('');
  const [correlationId, setCorrelationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [timeline, setTimeline] = useState<TimelineType | null>(null);
  const [narrative, setNarrative] = useState<NarrativeResult | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] = useState<SchemaMap | null>(null);
  const [copied, setCopied] = useState(false);

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

    try {
      const result = await parseLogs(logs, correlationId.trim());
      setTimeline(result.timeline);
      setNarrative(result.narrative);
      setSessionId(result.sessionId);
      setSchema(result.schema ?? null);
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
      <header className="border-b border-trace-border bg-trace-surface/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-trace-accent">Trace</span>
            </h1>
            <p className="text-xs text-trace-muted">Structured log explorer — no instrumentation required</p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Input panel */}
          <div className="space-y-4">
            <LogInput value={logs} onChange={setLogs} />

            <div>
              <label htmlFor="correlationId" className="text-sm font-medium text-slate-300">
                Correlation / Request ID
              </label>
              <input
                id="correlationId"
                type="text"
                value={correlationId}
                onChange={(e) => setCorrelationId(e.target.value)}
                placeholder="e.g. abc-123"
                className="mt-1 w-full rounded-lg border border-trace-border bg-trace-bg/50 px-4 py-2.5 font-mono text-sm text-slate-200 placeholder:text-trace-muted focus:outline-none focus:ring-1 focus:ring-trace-accent"
              />
            </div>

            <button
              onClick={handleParse}
              disabled={loading}
              className="w-full rounded-lg bg-trace-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Parsing…' : 'Parse & Build Timeline'}
            </button>

            {sessionId && (
              <button
                onClick={handleShare}
                className="w-full rounded-lg border border-trace-border px-4 py-2 text-sm text-slate-300 hover:bg-trace-surface transition-colors"
              >
                {copied ? 'Copied!' : 'Share Timeline'}
              </button>
            )}

            {error && (
              <div className="rounded-lg border border-trace-failure/30 bg-trace-failure/10 p-4">
                <p className="text-sm text-trace-failure font-medium">{error}</p>
                {schema && (
                  <div className="mt-3 text-xs text-trace-muted">
                    <p className="font-medium text-slate-400 mb-1">Inferred schema fields:</p>
                    <pre className="font-mono bg-trace-bg/50 rounded p-2 overflow-x-auto">
                      {JSON.stringify(schema, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Timeline panel */}
          <div>
            {loading && <TimelineSkeleton />}
            {!loading && timeline && timeline.eventCount > 0 && (
              <Timeline timeline={timeline} narrative={narrative} />
            )}
            {!loading && !timeline && !error && (
              <div className="flex items-center justify-center h-64 rounded-lg border border-dashed border-trace-border text-trace-muted text-sm">
                Paste logs and enter a correlation ID to see the timeline
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
