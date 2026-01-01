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

      const { timeline, schema, error } = await runWasm(logs, correlationId);
      if (error) {
        return Response.json({ error }, { status: 400, headers: cors });
      }

      if (timeline.eventCount === 0) {
        return Response.json(
          { error: 'No events found for this ID', schema, timeline },
          { status: 404, headers: cors },
        );
      }

      const narrative = await generateNarrative(timeline, env);
      const sessionId = await saveSession(env.DB, { timeline, narrative, correlationId });

      return Response.json({ timeline, narrative, sessionId, schema }, { headers: cors });
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
