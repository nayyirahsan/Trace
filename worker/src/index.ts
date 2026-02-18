import { generateNarrative } from './narrate';
import { getSession, saveSession } from './session';
import type { Env } from './types';
import { runWasm } from './wasm';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    if (url.pathname === '/parse' && request.method === 'POST') {
      const body = (await request.json()) as { logs: string; correlationId: string };
      const { logs, correlationId } = body;

      if (typeof logs !== 'string' || typeof correlationId !== 'string' || !correlationId.trim()) {
        return Response.json(
          { error: 'logs and correlationId are required' },
          { status: 400, headers: cors },
        );
      }

      const { timeline, schema, stats, error, engine } = await runWasm(logs, correlationId.trim());
      if (error) {
        return Response.json({ error }, { status: 400, headers: { ...cors, 'x-trace-engine': engine ?? 'ts' } });
      }

      if (timeline.eventCount === 0) {
        return Response.json(
          { error: 'No events found for this ID', schema, timeline, stats },
          { status: 404, headers: { ...cors, 'x-trace-engine': engine ?? 'ts' } },
        );
      }

      const narrative = await generateNarrative(timeline, env);
      const sessionId = await saveSession(env.DB, { timeline, narrative, correlationId, stats });

      return Response.json(
        { timeline, narrative, sessionId, schema, stats, engine },
        { headers: { ...cors, 'x-trace-engine': engine ?? 'ts' } },
      );
    }

    if (url.pathname.startsWith('/session/') && request.method === 'GET') {
      const id = url.pathname.split('/')[2];
      const session = await getSession(env.DB, id);
      if (!session) {
        return Response.json({ error: 'not found' }, { status: 404, headers: cors });
      }
      return Response.json(session, { headers: cors });
    }

    return new Response('not found', { status: 404 });
  },
};
