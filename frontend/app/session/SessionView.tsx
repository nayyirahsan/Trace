'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Timeline from '@/app/components/Timeline';
import TimelineSkeleton from '@/app/components/TimelineSkeleton';
import { getSession } from '@/lib/api';
import type { NarrativeResult, ParseStats, Timeline as TimelineType } from '@/lib/types';

export default function SessionView() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') ?? '';

  const [timeline, setTimeline] = useState<TimelineType | null>(null);
  const [narrative, setNarrative] = useState<NarrativeResult | null>(null);
  const [stats, setStats] = useState<ParseStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError('No session ID provided');
      return;
    }

    async function load() {
      try {
        const session = await getSession(id);
        setTimeline(session.timeline);
        setNarrative(session.narrative);
        setStats(session.stats ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  return (
    <main className="min-h-screen">
      <header className="border-b border-trace-border/70 bg-trace-surface/60 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-baseline gap-4 px-6 py-4">
          <a href="/" className="transition-opacity hover:opacity-80">
            <h1 className="font-mono text-lg font-semibold tracking-[0.3em] text-trace-ink">
              TRACE<span className="text-trace-accent">▍</span>
            </h1>
          </a>
          <p className="font-mono text-[11px] text-trace-muted">
            shared session · <span className="text-trace-ink/70">{id}</span>
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {loading && <TimelineSkeleton />}
        {error && (
          <div className="rounded-xl border border-trace-failure/30 bg-trace-failure/[0.08] p-4 font-mono text-xs text-trace-failure">
            {error}
          </div>
        )}
        {!loading && !error && timeline && (
          <Timeline timeline={timeline} narrative={narrative} stats={stats} />
        )}
      </div>
    </main>
  );
}
