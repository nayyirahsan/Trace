'use client';

import { useCallback, useRef, useState } from 'react';

interface LogInputProps {
  value: string;
  onChange: (value: string) => void;
}

const MAX_WARN_SIZE = 500 * 1024;

export default function LogInput({ value, onChange }: LogInputProps) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        onChange(text);
      };
      reader.readAsText(file);
    },
    [onChange],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const charCount = value.length;
  const isLarge = charCount > MAX_WARN_SIZE;

  return (
    <div className="space-y-1.5">
      <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-trace-muted">
        Raw JSON logs
      </label>

      <div
        className={`relative rounded-xl border transition-colors ${
          dragOver
            ? 'border-dashed border-trace-accent bg-trace-accent/5'
            : 'border-trace-border bg-trace-surface'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          placeholder={'{"request_id": "abc-123", "ts": 1705316625000, "service": "api", "msg": "…"}\none JSON object per line, or a JSON array'}
          className="h-64 w-full resize-y rounded-xl bg-transparent p-3.5 font-mono text-xs leading-relaxed text-trace-ink/90 placeholder:text-trace-faint focus:outline-none focus:ring-1 focus:ring-trace-accent/60"
        />
        <div className="absolute bottom-2 right-2.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded border border-trace-border bg-trace-raised px-2 py-1 font-mono text-[10px] text-trace-muted transition-colors hover:border-trace-accent/60 hover:text-trace-accent"
          >
            upload file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.log,.txt,.ndjson"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      </div>

      <div className="flex justify-between font-mono text-[10px] text-trace-faint">
        <span>.json · .ndjson · .log · drag &amp; drop</span>
        <span className={isLarge ? 'font-medium text-trace-warning' : ''}>
          {charCount.toLocaleString()} chars{isLarge && ' — large paste, parsing may be slow'}
        </span>
      </div>
    </div>
  );
}
