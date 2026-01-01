import type { SchemaMap, Timeline, TimelineEvent, ServiceTimeline } from './types';

const correlationIDCandidates = [
  'request_id', 'requestId', 'req_id', 'reqId',
  'trace_id', 'traceId', 'correlation_id', 'correlationId',
  'X-Request-ID', 'x-request-id', 'X-Correlation-ID',
  'transaction_id', 'transactionId', 'span_id', 'spanId',
];

const timestampCandidates = [
  'timestamp', 'time', 'ts', '@timestamp', 'created_at',
  'datetime', 'date', 'logged_at', 'event_time',
];

const serviceNameCandidates = [
  'service', 'service_name', 'serviceName', 'app', 'application',
  'component', 'logger', 'source',
];

const messageCandidates = ['msg', 'message', 'log', 'text'];
const levelCandidates = ['level', 'severity', 'log_level'];
const statusCodeCandidates = ['status', 'status_code', 'statusCode', 'http_status'];
const latencyCandidates = ['latency_ms', 'latency', 'duration_ms', 'response_time'];

const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const shortIDPattern = /^[a-zA-Z0-9_-]{6,}$/;
const scoreThreshold = 3;

interface LogEntry {
  correlationId: string;
  timestamp: Date;
  serviceName: string;
  message: string;
  level: string;
  statusCode: number;
  latencyMs: number;
}

export function parseAndBuild(logsJson: string, correlationId: string): { timeline: Timeline; schema: SchemaMap; error: string | null } {
  try {
    const raw = JSON.parse(logsJson) as Record<string, unknown>[];
    if (!Array.isArray(raw)) {
      return { timeline: emptyTimeline(correlationId), schema: emptySchema(), error: 'logs must be a JSON array' };
    }

    const schema = inferSchema(raw);
    const entries = parseEntries(raw, schema);
    const timeline = buildTimeline(entries, correlationId);
    return { timeline, schema, error: null };
  } catch (e) {
    return { timeline: emptyTimeline(correlationId), schema: emptySchema(), error: String(e) };
  }
}

function inferSchema(entries: Record<string, unknown>[]): SchemaMap {
  return {
    correlationId: inferField(entries, correlationIDCandidates, scoreCorrelation),
    timestamp: inferField(entries, timestampCandidates, scoreTimestamp),
    serviceName: inferField(entries, serviceNameCandidates, scoreGeneric),
    message: inferField(entries, messageCandidates, scoreGeneric),
    level: inferField(entries, levelCandidates, scoreGeneric),
    statusCode: inferField(entries, statusCodeCandidates, scoreStatusCode),
    latencyMs: inferField(entries, latencyCandidates, scoreLatency),
  };
}

type Scorer = (value: unknown, position: number, reuseBonus: number) => number;

function inferField(entries: Record<string, unknown>[], candidates: string[], scorer: Scorer): string {
  const valueCounts: Record<string, Record<string, number>> = {};
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry)) {
      if (!valueCounts[key]) valueCounts[key] = {};
      const s = toString(value);
      valueCounts[key][s] = (valueCounts[key][s] ?? 0) + 1;
    }
  }

  let bestField = '';
  let bestScore = 0;

  for (const fieldName of Object.keys(valueCounts)) {
    const position = candidatePosition(fieldName, candidates);
    const maxReuse = Math.max(...Object.values(valueCounts[fieldName]));
    const reuseBonus = maxReuse > 1 ? 1 : 0;
    const value = entries.find((e) => fieldName in e)?.[fieldName];
    if (value === undefined) continue;
    const score = scorer(value, position, reuseBonus);
    if (score > bestScore) {
      bestScore = score;
      bestField = fieldName;
    }
  }

  return bestScore >= scoreThreshold ? bestField : '';
}

function candidatePosition(field: string, candidates: string[]): number {
  return candidates.findIndex((c) => c.toLowerCase() === field.toLowerCase());
}

function basePositionScore(position: number): number {
  if (position < 0) return 0;
  if (position === 0) return 3;
  if (position <= 2) return 2;
  return 1;
}

function scoreCorrelation(value: unknown, position: number, reuseBonus: number): number {
  let score = basePositionScore(position) + reuseBonus;
  const s = toString(value);
  if (uuidPattern.test(s) || shortIDPattern.test(s)) score += 2;
  return score;
}

function scoreTimestamp(value: unknown, position: number, reuseBonus: number): number {
  let score = basePositionScore(position) + reuseBonus;
  if (parseTimestamp(value)) score += 2;
  return score;
}

function scoreGeneric(_value: unknown, position: number, reuseBonus: number): number {
  return basePositionScore(position) + reuseBonus;
}

function scoreStatusCode(value: unknown, position: number, reuseBonus: number): number {
  let score = basePositionScore(position) + reuseBonus;
  const n = toInt(value);
  if (n >= 100 && n < 600) score += 2;
  return score;
}

function scoreLatency(value: unknown, position: number, reuseBonus: number): number {
  let score = basePositionScore(position) + reuseBonus;
  const n = toInt(value);
  if (n > 0 && n < 600000) score += 2;
  return score;
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
    const n = parseFloat(value);
    if (!isNaN(n)) return fromUnixNumber(n);
  }
  if (typeof value === 'number') return fromUnixNumber(value);
  return null;
}

function fromUnixNumber(n: number): Date | null {
  if (n > 1e12) return new Date(n);
  if (n > 1e9) return new Date(n * 1000);
  return null;
}

function parseEntries(raw: Record<string, unknown>[], schema: SchemaMap): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const fields of raw) {
    const ts = parseTimestamp(getField(fields, schema.timestamp, timestampCandidates));
    if (!ts) continue;

    entries.push({
      correlationId: toString(getField(fields, schema.correlationId, correlationIDCandidates)),
      timestamp: ts,
      serviceName: toString(getField(fields, schema.serviceName, serviceNameCandidates)) || 'unknown',
      message: toString(getField(fields, schema.message, messageCandidates)),
      level: toString(getField(fields, schema.level, levelCandidates)).toLowerCase(),
      statusCode: toInt(getField(fields, schema.statusCode, statusCodeCandidates)),
      latencyMs: toInt(getField(fields, schema.latencyMs, latencyCandidates)),
    });
  }
  return entries;
}

function getField(fields: Record<string, unknown>, inferred: string, candidates: string[]): unknown {
  if (inferred && inferred in fields) return fields[inferred];
  for (const key of candidates) {
    for (const [fieldKey, value] of Object.entries(fields)) {
      if (fieldKey.toLowerCase() === key.toLowerCase()) return value;
    }
  }
  return undefined;
}

function buildTimeline(entries: LogEntry[], correlationId: string): Timeline {
  const filtered = entries.filter((e) => e.correlationId === correlationId);
  if (filtered.length === 0) {
    return emptyTimeline(correlationId);
  }

  const byService: Record<string, LogEntry[]> = {};
  for (const e of filtered) {
    if (!byService[e.serviceName]) byService[e.serviceName] = [];
    byService[e.serviceName].push(e);
  }

  const serviceNames = Object.keys(byService).sort((a, b) => {
    byService[a].sort((x, y) => x.timestamp.getTime() - y.timestamp.getTime());
    byService[b].sort((x, y) => x.timestamp.getTime() - y.timestamp.getTime());
    return byService[a][0].timestamp.getTime() - byService[b][0].timestamp.getTime();
  });

  const adjusted: LogEntry[][] = [];
  let prevRawLast = 0;

  for (let i = 0; i < serviceNames.length; i++) {
    const name = serviceNames[i];
    const rawSorted = [...byService[name]].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const svcEntries = rawSorted.map((e) => ({ ...e, timestamp: new Date(e.timestamp.getTime()) }));

    if (i > 0 && prevRawLast > 0) {
      const first = rawSorted[0].timestamp.getTime();
      if (first < prevRawLast && prevRawLast - first > 100) {
        const offset = prevRawLast - first + 1;
        for (const e of svcEntries) {
          e.timestamp = new Date(e.timestamp.getTime() + offset);
        }
      }
    }

    prevRawLast = rawSorted[rawSorted.length - 1].timestamp.getTime();
    adjusted.push(svcEntries);
  }

  let earliest = Infinity;
  for (const svc of adjusted) {
    for (const e of svc) {
      if (e.timestamp.getTime() < earliest) earliest = e.timestamp.getTime();
    }
  }

  const allEvents: TimelineEvent[] = [];
  const services: ServiceTimeline[] = [];

  for (const svcEntries of adjusted) {
    if (svcEntries.length === 0) continue;
    const events: TimelineEvent[] = [];
    let hasFailure = false;

    for (const e of svcEntries) {
      const relativeMs = e.timestamp.getTime() - earliest;
      const isFailure = isFailureEvent(e);
      if (isFailure) hasFailure = true;

      const ev: TimelineEvent = {
        serviceName: e.serviceName,
        timestamp: e.timestamp.toISOString(),
        relativeMs,
        message: e.message,
        level: e.level,
        statusCode: e.statusCode,
        latencyMs: e.latencyMs,
        isFailure,
        isLastSuccess: false,
      };
      events.push(ev);
      allEvents.push(ev);
    }

    services.push({
      serviceName: svcEntries[0].serviceName,
      events,
      firstEvent: svcEntries[0].timestamp.toISOString(),
      lastEvent: svcEntries[svcEntries.length - 1].timestamp.toISOString(),
      hasFailure,
    });
  }

  allEvents.sort((a, b) => a.relativeMs - b.relativeMs || a.serviceName.localeCompare(b.serviceName));

  let failurePoint: TimelineEvent | null = null;
  for (const ev of allEvents) {
    if (ev.isFailure) {
      failurePoint = ev;
      break;
    }
  }

  let lastSuccess: TimelineEvent | null = null;
  if (failurePoint) {
    for (const ev of allEvents) {
      if (ev.relativeMs >= failurePoint.relativeMs) break;
      if (!ev.isFailure && (!lastSuccess || ev.relativeMs > lastSuccess.relativeMs)) {
        lastSuccess = ev;
      }
    }
    if (lastSuccess) {
      for (const svc of services) {
        for (const ev of svc.events) {
          if (ev.relativeMs === lastSuccess!.relativeMs && ev.serviceName === lastSuccess!.serviceName && ev.message === lastSuccess!.message) {
            ev.isLastSuccess = true;
            lastSuccess = ev;
          }
        }
      }
    }
  }

  return {
    correlationId,
    services,
    totalDurationMs: allEvents.length > 0 ? allEvents[allEvents.length - 1].relativeMs : 0,
    failurePoint,
    lastSuccess,
    eventCount: allEvents.length,
  };
}

function isFailureEvent(entry: LogEntry): boolean {
  if (entry.level === 'error' || entry.level === 'fatal') return true;
  if (entry.statusCode >= 500) return true;
  const msg = entry.message.toLowerCase();
  const keywords = ['error', 'failed', 'exception', 'panic', 'timeout', 'refused'];
  return keywords.some((kw) => msg.includes(kw));
}

function toString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return String(value);
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
