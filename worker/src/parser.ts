import type { ParseStats, SchemaMap, ServiceTimeline, SkewWarning, Timeline, TimelineEvent } from './types';

// TypeScript fallback mirroring parser/parser/*.go — keep the two in sync.
// The Go WASM build is the primary parser; this runs if WASM init fails.

interface FieldRule {
  exact: string[];
  joinedSignals?: string[];
  tokenSignals?: string[];
}

const correlationRule: FieldRule = {
  exact: [
    'request_id', 'requestId', 'req_id', 'reqId',
    'trace_id', 'traceId', 'correlation_id', 'correlationId',
    'X-Request-ID', 'x-request-id', 'X-Correlation-ID',
    'transaction_id', 'transactionId', 'span_id', 'spanId',
  ],
  joinedSignals: [
    'requestid', 'reqid', 'traceid', 'correlationid', 'corrid',
    'transactionid', 'txnid', 'spanid', 'operationid',
  ],
};

const timestampRule: FieldRule = {
  exact: [
    'timestamp', 'time', 'ts', '@timestamp', 'created_at',
    'datetime', 'date', 'logged_at', 'event_time',
  ],
  tokenSignals: ['timestamp', 'time', 'ts', 'date', 'datetime', 'stamp'],
};

const serviceRule: FieldRule = {
  exact: [
    'service', 'service_name', 'serviceName', 'app', 'application',
    'component', 'logger', 'source',
  ],
  tokenSignals: ['service', 'svc', 'app', 'application', 'component', 'logger', 'source', 'module'],
};

const messageRule: FieldRule = {
  exact: ['msg', 'message', 'log', 'text'],
  tokenSignals: ['msg', 'message', 'log', 'text'],
};

const levelRule: FieldRule = {
  exact: ['level', 'severity', 'log_level'],
  tokenSignals: ['level', 'severity', 'lvl'],
};

const statusRule: FieldRule = {
  exact: ['status', 'status_code', 'statusCode', 'http_status'],
  joinedSignals: ['statuscode', 'httpstatus'],
  tokenSignals: ['status'],
};

const latencyRule: FieldRule = {
  exact: ['latency_ms', 'latency', 'duration_ms', 'response_time'],
  joinedSignals: ['responsetime', 'latencyms', 'durationms'],
  tokenSignals: ['latency', 'duration', 'elapsed', 'took'],
};

const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const shortIDPattern = /^[a-zA-Z0-9_-]{6,}$/;
const scoreThreshold = 4;
const valueSampleLimit = 25;
const maxAliases = 4;
const skewThresholdMs = 5000;

interface LogEntry {
  correlationId: string;
  timestamp: number; // epoch ms
  serviceName: string;
  message: string;
  level: string;
  statusCode: number;
  latencyMs: number;
}

export function decodeLogs(input: string): { raw: Record<string, unknown>[]; malformed: number; error: string | null } {
  const trimmed = input.trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return { raw: arr.filter((e) => e && typeof e === 'object'), malformed: 0, error: null };
      }
    } catch {
      // fall through to line mode
    }
  }

  let malformed = 0;
  const out: Record<string, unknown>[] = [];
  for (const line of input.split('\n')) {
    let l = line.trim();
    if (l.endsWith(',')) l = l.slice(0, -1);
    if (l === '' || l === '[' || l === ']') continue;
    try {
      const m = JSON.parse(l);
      if (m && typeof m === 'object' && !Array.isArray(m)) {
        out.push(m);
      } else {
        malformed++;
      }
    } catch {
      malformed++;
    }
  }

  if (out.length === 0) {
    return { raw: [], malformed, error: 'no valid JSON log entries found — expected a JSON array or newline-delimited JSON objects' };
  }
  return { raw: out, malformed, error: null };
}

export function parseAndBuild(
  logsJson: string,
  correlationId: string,
): { timeline: Timeline; schema: SchemaMap; stats: ParseStats | null; error: string | null } {
  const { raw, malformed, error } = decodeLogs(logsJson);
  if (error) {
    return { timeline: emptyTimeline(correlationId), schema: emptySchema(), stats: null, error };
  }

  const schema = inferSchema(raw);
  const { entries, stats } = parseEntries(raw, schema);
  stats.malformedLines = malformed;
  const timeline = buildTimeline(entries, correlationId);
  return { timeline, schema, stats, error: null };
}

export function inferSchema(entries: Record<string, unknown>[]): SchemaMap {
  const corr = inferField(entries, correlationRule, validCorrelation);
  const ts = inferField(entries, timestampRule, (v) => parseTimestamp(v) !== null);
  const svc = inferField(entries, serviceRule, validNonEmptyString);
  const msg = inferField(entries, messageRule, validNonEmptyString);
  const lvl = inferField(entries, levelRule, validNonEmptyString);
  const status = inferField(entries, statusRule, validStatus);
  const latency = inferField(entries, latencyRule, validLatency);

  const aliases: Record<string, string[]> = {};
  const roles: Record<string, string[]> = {
    correlationId: corr, timestamp: ts, serviceName: svc,
    message: msg, level: lvl, statusCode: status, latencyMs: latency,
  };
  for (const [role, fields] of Object.entries(roles)) {
    if (fields.length > 1) aliases[role] = fields.slice(1);
  }

  return {
    correlationId: corr[0] ?? '',
    timestamp: ts[0] ?? '',
    serviceName: svc[0] ?? '',
    message: msg[0] ?? '',
    level: lvl[0] ?? '',
    statusCode: status[0] ?? '',
    latencyMs: latency[0] ?? '',
    aliases: Object.keys(aliases).length > 0 ? aliases : undefined,
  };
}

type ValueCheck = (value: unknown) => boolean;

function inferField(entries: Record<string, unknown>[], rule: FieldRule, check: ValueCheck): string[] {
  const fields = new Map<string, { values: unknown[]; counts: Map<string, number> }>();

  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry)) {
      let info = fields.get(key);
      if (!info) {
        info = { values: [], counts: new Map() };
        fields.set(key, info);
      }
      if (info.values.length < valueSampleLimit) info.values.push(value);
      const s = toStr(value);
      info.counts.set(s, (info.counts.get(s) ?? 0) + 1);
    }
  }

  const scored: { name: string; score: number; exactPos: number }[] = [];
  for (const [name, info] of fields) {
    const pos = candidatePosition(name, rule.exact);
    if (pos < 0 && !nameSignal(name, rule)) continue;

    let score = pos >= 0 ? basePositionScore(pos) : 2;
    for (const count of info.counts.values()) {
      if (count > 1) {
        score++;
        break;
      }
    }
    const valid = info.values.filter(check).length;
    if (valid * 2 > info.values.length) score += 2;

    scored.push({ name, score, exactPos: pos });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const aExact = a.exactPos >= 0;
    const bExact = b.exactPos >= 0;
    if (aExact !== bExact) return aExact ? -1 : 1;
    if (aExact && a.exactPos !== b.exactPos) return a.exactPos - b.exactPos;
    return a.name < b.name ? -1 : 1;
  });

  const result: string[] = [];
  for (const sf of scored) {
    if (sf.score < scoreThreshold || result.length === maxAliases) break;
    result.push(sf.name);
  }
  return result;
}

function nameSignal(field: string, rule: FieldRule): boolean {
  const joined = field.toLowerCase().replace(/[-_.@ ]/g, '');
  if (rule.joinedSignals?.some((sig) => joined.includes(sig))) return true;
  if (rule.tokenSignals) {
    const tokens = nameTokens(field);
    return rule.tokenSignals.some((sig) => tokens.includes(sig));
  }
  return false;
}

function nameTokens(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_.@\s]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

function candidatePosition(field: string, candidates: string[]): number {
  return candidates.findIndex((c) => c.toLowerCase() === field.toLowerCase());
}

function basePositionScore(position: number): number {
  if (position === 0) return 3;
  if (position <= 4) return 2;
  return 1;
}

function validCorrelation(value: unknown): boolean {
  const s = toStr(value);
  return uuidPattern.test(s) || shortIDPattern.test(s);
}

function validNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value !== '';
}

function validStatus(value: unknown): boolean {
  const n = toInt(value);
  return n >= 100 && n < 600;
}

function validLatency(value: unknown): boolean {
  return typeof value === 'number' && value > 0 && value < 600000;
}

export function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'string') {
    // ISO-ish first (Date.parse covers RFC3339 and common variants,
    // including python logging's comma once normalized)
    const normalized = value.replace(',', '.');
    const d = Date.parse(normalized);
    if (!isNaN(d)) return d;
    const n = parseFloat(value);
    if (!isNaN(n)) return fromUnixNumber(n);
    return null;
  }
  if (typeof value === 'number') return fromUnixNumber(value);
  return null;
}

function fromUnixNumber(n: number): number | null {
  if (n > 1e14) return Math.round(n / 1000); // microseconds
  if (n > 1e12) return Math.round(n); // milliseconds
  if (n > 1e9) return Math.round(n * 1000); // seconds (fractional ok)
  return null;
}

function parseEntries(raw: Record<string, unknown>[], schema: SchemaMap): { entries: LogEntry[]; stats: ParseStats } {
  const entries: LogEntry[] = [];
  const stats: ParseStats = {
    totalEntries: raw.length,
    parsedEntries: 0,
    missingTimestamp: 0,
    missingCorrelationId: 0,
    malformedLines: 0,
  };
  const aliases = schema.aliases ?? {};

  for (const fields of raw) {
    const ts = parseTimestamp(getField(fields, schema.timestamp, aliases['timestamp'], timestampRule.exact));
    if (ts === null) {
      stats.missingTimestamp++;
      continue;
    }

    const entry: LogEntry = {
      correlationId: toStr(getField(fields, schema.correlationId, aliases['correlationId'], correlationRule.exact)),
      timestamp: ts,
      serviceName: toStr(getField(fields, schema.serviceName, aliases['serviceName'], serviceRule.exact)) || 'unknown',
      message: toStr(getField(fields, schema.message, aliases['message'], messageRule.exact)),
      level: toStr(getField(fields, schema.level, aliases['level'], levelRule.exact)).toLowerCase(),
      statusCode: toInt(getField(fields, schema.statusCode, aliases['statusCode'], statusRule.exact)),
      latencyMs: toInt(getField(fields, schema.latencyMs, aliases['latencyMs'], latencyRule.exact)),
    };
    if (entry.correlationId === '') stats.missingCorrelationId++;
    entries.push(entry);
  }

  stats.parsedEntries = entries.length;
  return { entries, stats };
}

function getField(
  fields: Record<string, unknown>,
  inferred: string,
  aliases: string[] | undefined,
  candidates: string[],
): unknown {
  if (inferred && inferred in fields) return fields[inferred];
  for (const alias of aliases ?? []) {
    if (alias in fields) return fields[alias];
  }
  for (const key of candidates) {
    for (const [fieldKey, value] of Object.entries(fields)) {
      if (fieldKey.toLowerCase() === key.toLowerCase()) return value;
    }
  }
  return undefined;
}

export function buildTimeline(entries: LogEntry[], correlationId: string): Timeline {
  const filtered = correlationId === '' ? [] : entries.filter((e) => e.correlationId === correlationId);
  if (filtered.length === 0) return emptyTimeline(correlationId);

  const byService = new Map<string, LogEntry[]>();
  for (const e of filtered) {
    const lane = byService.get(e.serviceName);
    if (lane) lane.push(e);
    else byService.set(e.serviceName, [e]);
  }
  for (const lane of byService.values()) {
    lane.sort((a, b) => a.timestamp - b.timestamp);
  }

  const serviceNames = [...byService.keys()].sort((a, b) => {
    const ta = byService.get(a)![0].timestamp;
    const tb = byService.get(b)![0].timestamp;
    return ta - tb || (a < b ? -1 : 1);
  });

  const suspectedSkew = detectClockSkew(serviceNames, byService);

  let earliest = Infinity;
  for (const lane of byService.values()) {
    if (lane[0].timestamp < earliest) earliest = lane[0].timestamp;
  }

  const services: ServiceTimeline[] = [];
  for (const name of serviceNames) {
    const lane = byService.get(name)!;
    let hasFailure = false;
    const events: TimelineEvent[] = lane.map((e) => {
      const isFailure = isFailureEvent(e);
      if (isFailure) hasFailure = true;
      return {
        serviceName: e.serviceName,
        timestamp: new Date(e.timestamp).toISOString(),
        relativeMs: e.timestamp - earliest,
        message: e.message,
        level: e.level,
        statusCode: e.statusCode,
        latencyMs: e.latencyMs,
        isFailure,
        isLastSuccess: false,
      };
    });
    services.push({
      serviceName: name,
      events,
      firstEvent: new Date(lane[0].timestamp).toISOString(),
      lastEvent: new Date(lane[lane.length - 1].timestamp).toISOString(),
      hasFailure,
    });
  }

  const allEvents = services.flatMap((s) => s.events);
  allEvents.sort((a, b) => a.relativeMs - b.relativeMs || (a.serviceName < b.serviceName ? -1 : a.serviceName > b.serviceName ? 1 : 0));

  let failurePoint: TimelineEvent | null = null;
  let lastSuccess: TimelineEvent | null = null;
  for (const ev of allEvents) {
    if (ev.isFailure) {
      failurePoint = ev;
      break;
    }
    lastSuccess = ev;
  }
  if (!failurePoint) {
    lastSuccess = null;
  } else if (lastSuccess) {
    lastSuccess.isLastSuccess = true;
  }

  return {
    correlationId,
    services,
    totalDurationMs: allEvents[allEvents.length - 1].relativeMs,
    failurePoint,
    lastSuccess,
    eventCount: allEvents.length,
    suspectedSkew: suspectedSkew.length > 0 ? suspectedSkew : undefined,
  };
}

function detectClockSkew(serviceNames: string[], byService: Map<string, LogEntry[]>): SkewWarning[] {
  if (serviceNames.length < 2) return [];

  let warnings: SkewWarning[] = [];
  for (const name of serviceNames) {
    const lane = byService.get(name)!;
    const laneMin = lane[0].timestamp;
    const laneMax = lane[lane.length - 1].timestamp;

    let othersMin = Infinity;
    let othersMax = -Infinity;
    for (const other of serviceNames) {
      if (other === name) continue;
      const o = byService.get(other)!;
      othersMin = Math.min(othersMin, o[0].timestamp);
      othersMax = Math.max(othersMax, o[o.length - 1].timestamp);
    }

    const gapAhead = laneMin - othersMax;
    const gapBehind = othersMin - laneMax;
    if (gapAhead > skewThresholdMs) {
      warnings.push({ serviceName: name, offsetMs: gapAhead });
    } else if (gapBehind > skewThresholdMs) {
      warnings.push({ serviceName: name, offsetMs: -gapBehind });
    }
  }

  // All lanes mutually disjoint: ambiguous which clock is wrong — keep the
  // most suspect lane only (fewest events, then clock-behind, then name).
  if (warnings.length === serviceNames.length) {
    warnings.sort((a, b) => {
      const na = byService.get(a.serviceName)!.length;
      const nb = byService.get(b.serviceName)!.length;
      if (na !== nb) return na - nb;
      const aBehind = a.offsetMs < 0;
      const bBehind = b.offsetMs < 0;
      if (aBehind !== bBehind) return aBehind ? -1 : 1;
      return a.serviceName < b.serviceName ? -1 : 1;
    });
    warnings = warnings.slice(0, 1);
  }
  return warnings;
}

function isFailureEvent(entry: LogEntry): boolean {
  if (entry.level === 'error' || entry.level === 'fatal' || entry.level === 'critical') return true;
  if (entry.statusCode >= 500) return true;
  const msg = entry.message.toLowerCase();
  const keywords = ['error', 'failed', 'exception', 'panic', 'timeout', 'refused'];
  return keywords.some((kw) => msg.includes(kw));
}

function toStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function toInt(value: unknown): number {
  if (typeof value === 'number') return Math.floor(value);
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function emptyTimeline(correlationId: string): Timeline {
  return { correlationId, services: [], totalDurationMs: 0, failurePoint: null, lastSuccess: null, eventCount: 0 };
}

function emptySchema(): SchemaMap {
  return { correlationId: '', timestamp: '', serviceName: '', message: '', level: '', statusCode: '', latencyMs: '' };
}
