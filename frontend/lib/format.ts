/** Adaptive duration formatting: 450ms · 1.24s · 2m00s */
export function formatMs(ms: number): string {
  const abs = Math.abs(ms);
  const sign = ms < 0 ? '-' : '';
  if (abs < 1000) return `${sign}${abs}ms`;
  if (abs < 60000) {
    const s = +(abs / 1000).toFixed(abs < 10000 ? 2 : 1);
    return `${sign}${s}s`;
  }
  const totalSeconds = Math.round(abs / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${sign}${m}m${String(s).padStart(2, '0')}s`;
}

/** At most `target` round-numbered axis ticks (1/2/5 × 10^n steps). */
export function niceTicks(durationMs: number, target = 6): number[] {
  if (durationMs <= 0) return [0];
  const raw = durationMs / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 5, 10].map((m) => m * magnitude).find((s) => durationMs / s <= target) ?? 10 * magnitude;
  const ticks: number[] = [];
  for (let t = 0; t <= durationMs; t += step) ticks.push(t);
  return ticks;
}
