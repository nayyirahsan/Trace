'use client';

import type { NarrativeResult } from '@/lib/types';

interface NarrativeCardProps {
  narrative: NarrativeResult | null;
}

export default function NarrativeCard({ narrative }: NarrativeCardProps) {
  if (!narrative) return null;

  return (
    <div className="mt-6 rounded-lg border border-trace-border bg-trace-surface p-4">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-slate-200">Incident Summary</h3>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            narrative.fallback
              ? 'bg-trace-warning/20 text-trace-warning'
              : 'bg-trace-accent/20 text-trace-accent'
          }`}
        >
          {narrative.fallback ? 'Template fallback' : 'AI generated'}
        </span>
        {!narrative.validated && (
          <span className="text-[10px] text-trace-muted">Could not validate all claims</span>
        )}
      </div>
      <p className="text-sm text-slate-300 leading-relaxed">{narrative.summary}</p>
    </div>
  );
}
