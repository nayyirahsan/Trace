import type { ParseResponse, SessionData } from './types';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'http://localhost:8787';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function parseLogs(logs: string, correlationId: string): Promise<ParseResponse> {
  const res = await fetch(`${WORKER_URL}/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ logs, correlationId }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new ParseError(data.error ?? 'Parse failed', data.schema, data.timeline);
  }

  return data as ParseResponse;
}

export async function getSession(id: string): Promise<SessionData> {
  const res = await fetch(`${WORKER_URL}/session/${id}`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error ?? 'Session not found');
  }

  return data as SessionData;
}

export function shareUrl(sessionId: string): string {
  return `${APP_URL}/session?id=${sessionId}`;
}

export class ParseError extends Error {
  schema?: ParseResponse['schema'];
  timeline?: ParseResponse['timeline'];

  constructor(message: string, schema?: ParseResponse['schema'], timeline?: ParseResponse['timeline']) {
    super(message);
    this.name = 'ParseError';
    this.schema = schema;
    this.timeline = timeline;
  }
}
