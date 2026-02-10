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
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-300">Raw JSON Logs</label>

      <div
        className={`relative rounded-lg border-2 border-dashed transition-colors ${
          dragOver ? 'border-trace-accent bg-trace-accent/5' : 'border-trace-border'
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
          placeholder='Paste structured logs — a JSON array or one JSON object per line (NDJSON), e.g. {"request_id": "abc-123", "ts": 1705316625000, "service": "api", "msg": "..."}'
          className="w-full h-64 resize-y rounded-lg bg-trace-bg/50 p-4 font-mono text-xs text-slate-300 placeholder:text-trace-muted focus:outline-none focus:ring-1 focus:ring-trace-accent"
        />
        <div className="absolute bottom-2 right-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs text-trace-accent hover:text-blue-400 transition-colors"
          >
            Upload file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.log,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      </div>

      <div className="flex justify-between text-xs">
        <span className="text-trace-muted">Accepts .json, .log, .txt — drag & drop supported</span>
        <span className={isLarge ? 'text-trace-warning font-medium' : 'text-trace-muted'}>
          {charCount.toLocaleString()} chars
          {isLarge && ' — large file, parsing may be slow'}
        </span>
      </div>
    </div>
  );
}
