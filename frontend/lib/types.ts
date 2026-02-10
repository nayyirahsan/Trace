export interface TimelineEvent {
  serviceName: string;
  timestamp: string;
  relativeMs: number;
  message: string;
  level: string;
  statusCode: number;
  latencyMs: number;
  isFailure: boolean;
  isLastSuccess: boolean;
}

export interface ServiceTimeline {
  serviceName: string;
  events: TimelineEvent[];
  firstEvent: string;
  lastEvent: string;
  hasFailure: boolean;
}

export interface SkewWarning {
  serviceName: string;
  offsetMs: number;
}

export interface Timeline {
  correlationId: string;
  services: ServiceTimeline[];
  totalDurationMs: number;
  failurePoint: TimelineEvent | null;
  lastSuccess: TimelineEvent | null;
  eventCount: number;
  suspectedSkew?: SkewWarning[];
}

export interface ParseStats {
  totalEntries: number;
  parsedEntries: number;
  missingTimestamp: number;
  missingCorrelationId: number;
  malformedLines: number;
}

export interface NarrativeResult {
  summary: string;
  validated: boolean;
  fallback: boolean;
}

export interface SchemaMap {
  correlationId: string;
  timestamp: string;
  serviceName: string;
  message: string;
  level: string;
  statusCode: string;
  latencyMs: string;
  aliases?: Record<string, string[]>;
}

export interface ParseResponse {
  timeline: Timeline;
  narrative: NarrativeResult | null;
  sessionId: string;
  schema?: SchemaMap;
  stats?: ParseStats | null;
}

export interface SessionData {
  timeline: Timeline;
  narrative: NarrativeResult | null;
  correlationId: string;
  stats?: ParseStats | null;
}
