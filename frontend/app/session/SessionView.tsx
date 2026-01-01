'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Timeline from '@/app/components/Timeline';
import TimelineSkeleton from '@/app/components/TimelineSkeleton';
import { getSession } from '@/lib/api';
import type { NarrativeResult, Timeline as TimelineType } from '@/lib/types';

export default function SessionView() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') ?? '';

  const [timeline, setTimeline] = useState<TimelineType | null>(null);
  const [narrative, setNarrative] = useState<NarrativeResult | null>(null);
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
      <header className="border-b border-trace-border bg-trace-surface/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <a href="/" className="text-xl font-bold tracking-tight hover:opacity-80 transition-opacity">
              <span className="text-trace-accent">Trace</span>
            </a>
            <p className="text-xs text-trace-muted">Shared session · {id}</p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {loading && <TimelineSkeleton />}
        {error && (
          <div className="rounded-lg border border-trace-failure/30 bg-trace-failure/10 p-4 text-sm text-trace-failure">
            {error}
          </div>
        )}
        {!loading && !error && timeline && <Timeline timeline={timeline} narrative={narrative} />}
      </div>
    </main>
  );
}
