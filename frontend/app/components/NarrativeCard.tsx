'use client';

import type { NarrativeResult } from '@/lib/types';

interface NarrativeCardProps {
  narrative: NarrativeResult | null;
}

export default function NarrativeCard({ narrative }: NarrativeCardProps) {
  if (!narrative) return null;

  return (
    <div className="mt-5 rounded-xl border border-trace-border bg-trace-surface/90 px-4 py-3.5 shadow-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-trace-muted">
          Incident summary
        </h3>
        <span
          className={`rounded-full border px-2 py-px font-mono text-[10px] font-medium ${
            narrative.fallback
              ? 'border-trace-warning/30 bg-trace-warning/10 text-trace-warning'
              : 'border-trace-accent/30 bg-trace-accent/10 text-trace-accent'
          }`}
        >
          {narrative.fallback ? 'template' : 'AI · validated'}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-trace-ink/90">{narrative.summary}</p>
    </div>
  );
}
