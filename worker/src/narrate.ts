import type { Env, NarrativeResult, Timeline } from './types';

// The LLM only ever sees this structured context — never raw log text.
// Anything it produces is checked against the same context; summaries that
// reference services or numbers not present here are discarded in favor of
// a deterministic template, so hallucinations cannot reach the user.
export interface NarrativeContext {
  correlationId: string;
  services: Array<{
    name: string;
    eventCount: number;
    hasFailure: boolean;
    firstEventMs: number;
    lastEventMs: number;
  }>;
  totalDurationMs: number;
  failurePoint: {
    service: string;
    message: string;
    relativeMs: number;
    statusCode: number;
  } | null;
  lastSuccess: {
    service: string;
    message: string;
    relativeMs: number;
  } | null;
  suspectedSkew: Array<{ service: string; offsetMs: number }> | null;
}

export async function generateNarrative(timeline: Timeline, env: Env): Promise<NarrativeResult> {
  const context = buildContext(timeline);

  const prompt = `You are an incident analysis assistant. You will receive a structured JSON object describing a request timeline across multiple services. Write a 2-3 sentence incident summary.

RULES (strictly enforced by a validator — violations are discarded):
- Only reference services, timings, and errors present in the JSON below
- Copy service names verbatim; never invent or rename services
- Use only numbers that appear in the JSON, in milliseconds (e.g. "at 450ms"); do not convert units or compute new numbers
- Do not speculate about root causes not evident in the data
- If failurePoint is null, say the request completed successfully; otherwise name the failing service and the failure timing

Timeline JSON:
${JSON.stringify(context, null, 2)}

Respond with only the summary text, no preamble.`;

  try {
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 220,
      temperature: 0.2,
    });

    const summary = extractAiText(response);
    if (!summary) {
      console.warn('narrative AI returned empty text:', JSON.stringify(response).slice(0, 200));
      return { summary: buildFallbackNarrative(context), validated: false, fallback: true };
    }

    const verdict = validateNarrative(summary, context);

    if (!verdict.ok) {
      console.warn('narrative rejected:', verdict.reason, '—', summary.slice(0, 120));
      return { summary: buildFallbackNarrative(context), validated: false, fallback: true };
    }

    return { summary, validated: true, fallback: false };
  } catch (err) {
    console.warn('narrative AI error:', err instanceof Error ? err.message : err);
    return { summary: buildFallbackNarrative(context), validated: false, fallback: true };
  }
}

function extractAiText(response: unknown): string {
  if (typeof response === 'string') return response.trim();
  if (response && typeof response === 'object') {
    const r = response as Record<string, unknown>;
    for (const key of ['response', 'result', 'text', 'output']) {
      if (typeof r[key] === 'string') return r[key].trim();
    }
  }
  return '';
}

export function buildContext(timeline: Timeline): NarrativeContext {
  return {
    correlationId: timeline.correlationId,
    services: timeline.services.map((s) => ({
      name: s.serviceName,
      eventCount: s.events.length,
      hasFailure: s.hasFailure,
      firstEventMs: s.events[0]?.relativeMs ?? 0,
      lastEventMs: s.events[s.events.length - 1]?.relativeMs ?? 0,
    })),
    totalDurationMs: timeline.totalDurationMs,
    failurePoint: timeline.failurePoint
      ? {
          service: timeline.failurePoint.serviceName,
          message: timeline.failurePoint.message,
          relativeMs: timeline.failurePoint.relativeMs,
          statusCode: timeline.failurePoint.statusCode,
        }
      : null,
    lastSuccess: timeline.lastSuccess
      ? {
          service: timeline.lastSuccess.serviceName,
          message: timeline.lastSuccess.message,
          relativeMs: timeline.lastSuccess.relativeMs,
        }
      : null,
    suspectedSkew:
      timeline.suspectedSkew?.map((w) => ({ service: w.serviceName, offsetMs: w.offsetMs })) ?? null,
  };
}

export interface Verdict {
  ok: boolean;
  reason?: string;
}

const failureWords = /\b(fail(?:s|ed|ure|ing)?|error(?:s|ed)?|time[- ]?out|timed out|refused|crash(?:ed)?|exception)\b/i;

export function validateNarrative(summary: string, context: NarrativeContext): Verdict {
  if (!summary || summary.length > 1200) {
    return { ok: false, reason: 'empty or oversized summary' };
  }

  const serviceNames = context.services.map((s) => s.name.toLowerCase());
  const normalizedServices = serviceNames.map(stripSeparators);
  const allowedIdentifiers = new Set([
    ...serviceNames,
    ...normalizedServices,
    context.correlationId.toLowerCase(),
    stripSeparators(context.correlationId.toLowerCase()),
  ]);

  // 1. Identifier-looking tokens (api-gateway, order_service, ord-77f2)
  //    must name a real service or the correlation ID.
  const identifierPattern = /\b[a-z0-9]+(?:[-_][a-z0-9]+)+\b/gi;
  for (const match of summary.matchAll(identifierPattern)) {
    const token = match[0].toLowerCase();
    if (/^\d+(?:[-_]\d+)+$/.test(token)) continue; // number ranges like 100-200
    if (!allowedIdentifiers.has(token) && !allowedIdentifiers.has(stripSeparators(token))) {
      return { ok: false, reason: `unknown identifier "${match[0]}"` };
    }
  }

  // 2. "<word> service" phrases must match a real service. Substring match
  //    (not prefix) so "the api.inventory service" grounds against the
  //    dotted service name "api.inventory".
  const servicePhrase = /\b([a-z0-9.-]+)[ -]services?\b/gi;
  for (const match of summary.matchAll(servicePhrase)) {
    const word = match[1].toLowerCase();
    if (/^\d+$/.test(word)) continue; // counts: "3 services"
    if (['the', 'a', 'each', 'every', 'all', 'other', 'another', 'first', 'last', 'failing', 'upstream', 'downstream'].includes(word)) continue;
    const normalized = stripSeparators(word);
    const found = normalizedServices.some(
      (s) => s === normalized || s === `${normalized}service` || s.includes(normalized),
    );
    if (!found) {
      return { ok: false, reason: `unknown service phrase "${match[0]}"` };
    }
  }

  // 3. Every number in the summary must exist in the context (or be its
  //    seconds equivalent). This catches invented timings and status codes.
  const allowedNumbers = collectAllowedNumbers(context);
  for (const match of summary.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!allowedNumbers.has(match[0])) {
      return { ok: false, reason: `unknown number "${match[0]}"` };
    }
  }

  // Numbers written in seconds must map back to a real millisecond value —
  // "5 seconds" is not grounded just because an event count of 5 exists.
  for (const match of summary.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/gi)) {
    const ms = Math.round(parseFloat(match[1]) * 1000 * 1e6) / 1e6;
    if (!allowedNumbers.has(String(ms))) {
      return { ok: false, reason: `ungrounded seconds value "${match[0]}"` };
    }
  }

  // 4. Failure claims must match the data, in both directions.
  const claimsFailure = failureWords.test(summary);
  if (claimsFailure && !context.failurePoint) {
    return { ok: false, reason: 'claims a failure but timeline has none' };
  }
  if (context.failurePoint) {
    if (!claimsFailure) {
      return { ok: false, reason: 'timeline has a failure the summary omits' };
    }
    if (!summary.toLowerCase().includes(context.failurePoint.service.toLowerCase())) {
      return { ok: false, reason: 'summary does not name the failing service' };
    }
  }

  return { ok: true };
}

// Every number the summary is allowed to use: all numeric values in the
// context, digit runs inside its strings (messages, IDs), and ms→seconds
// conversions of each.
function collectAllowedNumbers(context: NarrativeContext): Set<string> {
  const allowed = new Set<string>();
  const addNumber = (n: number) => {
    if (!isFinite(n)) return;
    const abs = Math.abs(n);
    allowed.add(String(abs));
    allowed.add(String(abs / 1000)); // "450ms" as "0.45" seconds
  };
  const walk = (value: unknown) => {
    if (typeof value === 'number') {
      addNumber(value);
    } else if (typeof value === 'string') {
      for (const m of value.matchAll(/\d+(?:\.\d+)?/g)) {
        allowed.add(m[0]);
        addNumber(parseFloat(m[0]));
      }
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  walk(context);
  allowed.add(String(context.services.length));
  allowed.add(String(context.services.reduce((sum, s) => sum + s.eventCount, 0)));
  return allowed;
}

export function buildFallbackNarrative(context: NarrativeContext): string {
  const skewNote = context.suspectedSkew?.length
    ? ` Note: ${context.suspectedSkew.map((w) => `${w.service} timestamps deviate ~${Math.abs(w.offsetMs) / 1000}s from other services (possible clock skew)`).join('; ')}.`
    : '';

  if (!context.failurePoint) {
    return `Request ${context.correlationId} completed successfully across ${context.services.length} service(s) in ${context.totalDurationMs}ms.${skewNote}`;
  }

  const fail = context.failurePoint;
  const last = context.lastSuccess;
  const prior = last
    ? last.service !== fail.service
      ? `succeeded through ${last.service} at ${last.relativeMs}ms `
      : `last succeeded within ${last.service} at ${last.relativeMs}ms `
    : '';
  const status = fail.statusCode ? ` (HTTP ${fail.statusCode})` : '';
  const failMsg = fail.message ? ` — "${fail.message}"` : '';
  return `Request ${context.correlationId} ${prior}before failing in ${fail.service} at ${fail.relativeMs}ms${status}${failMsg}. Total duration: ${context.totalDurationMs}ms across ${context.services.length} service(s).${skewNote}`;
}

function stripSeparators(s: string): string {
  return s.replace(/[-_.\s]/g, '');
}
