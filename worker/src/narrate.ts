import type { Env, NarrativeResult, Timeline } from './types';

interface NarrativeContext {
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
    relativeMs: number;
  } | null;
}

export async function generateNarrative(timeline: Timeline, env: Env): Promise<NarrativeResult> {
  const context = buildContext(timeline);

  const prompt = `You are an incident analysis assistant. You will receive a structured JSON object describing a request timeline across multiple services. Write a 2-3 sentence incident summary.

RULES (strictly enforced):
- Only reference services, timestamps, and errors present in the JSON below
- Do not speculate about root causes not evident in the data
- Do not invent error messages or service names
- Use milliseconds for timing (e.g. "at 450ms")
- If there is no failure, say the request completed successfully

Timeline JSON:
${JSON.stringify(context, null, 2)}

Respond with only the summary text, no preamble.`;

  try {
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
    });

    const summary = (response as { response?: string }).response?.trim() ?? '';

    const serviceNames = timeline.services.map((s) => s.serviceName.toLowerCase());
    const validated = validateNarrative(summary, serviceNames, context);

    if (!validated) {
      return { summary: buildFallbackNarrative(context), validated: false, fallback: true };
    }

    return { summary, validated: true, fallback: false };
  } catch {
    return { summary: buildFallbackNarrative(context), validated: false, fallback: true };
  }
}

function buildContext(timeline: Timeline): NarrativeContext {
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
          relativeMs: timeline.lastSuccess.relativeMs,
        }
      : null,
  };
}

function validateNarrative(summary: string, serviceNames: string[], context: NarrativeContext): boolean {
  const lower = summary.toLowerCase();
  const words = lower.split(/\s+/);

  for (const word of words) {
    const cleaned = word.replace(/[^a-z0-9]/g, '');
    if (
      cleaned.length > 3 &&
      !serviceNames.some((s) => s.includes(cleaned)) &&
      isLikelyServiceName(cleaned)
    ) {
      return false;
    }
  }

  const claimsFailure = /fail|error|timeout|refused/i.test(summary);
  if (claimsFailure && !context.failurePoint) return false;

  return true;
}

function buildFallbackNarrative(context: NarrativeContext): string {
  if (!context.failurePoint) {
    return `Request ${context.correlationId} completed successfully across ${context.services.length} service(s) in ${context.totalDurationMs}ms.`;
  }
  const last = context.lastSuccess;
  const fail = context.failurePoint;
  const prior =
    last && last.service !== fail.service
      ? `through ${last.service} at ${last.relativeMs}ms `
      : last
        ? `with last success in ${last.service} at ${last.relativeMs}ms `
        : '';
  return `Request ${context.correlationId} succeeded ${prior}before failing at ${fail.service} at ${fail.relativeMs}ms${fail.statusCode ? ` (HTTP ${fail.statusCode})` : ''}. Total request duration: ${context.totalDurationMs}ms across ${context.services.length} services.`;
}

function isLikelyServiceName(word: string): boolean {
  const genericWords = [
    'the', 'was', 'request', 'response', 'service', 'error', 'failed',
    'success', 'after', 'before', 'during', 'completed', 'returned',
  ];
  return !genericWords.includes(word) && word.length > 4;
}
