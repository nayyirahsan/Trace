#!/usr/bin/env node
/**
 * Live Workers AI batch: POST /parse for every correlation ID in test_logs
 * and report how many LLM summaries pass validation vs template fallback.
 *
 * Usage: node scripts/live-narrative-batch.mjs [baseUrl]
 * Default baseUrl: http://localhost:8787
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? 'http://localhost:8787';
const TEST_LOGS = join(__dirname, '..', '..', 'test_logs');

const files = readdirSync(TEST_LOGS).filter((f) => f.endsWith('.json') || f.endsWith('.ndjson'));

function correlationIdsIn(content) {
  const ids = new Set();
  let lines;
  try {
    lines = content.trim().startsWith('[') ? JSON.parse(content) : null;
  } catch {
    lines = null;
  }
  if (!lines) {
    lines = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        lines.push(JSON.parse(trimmed));
      } catch {
        // skip malformed NDJSON lines
      }
    }
  }

  const idKeys = [
    'request_id', 'requestId', 'req_id', 'reqId', 'trace_id', 'traceId',
    'correlation_id', 'correlationId', 'transaction_id', 'span_id', 'traceId',
  ];
  for (const entry of lines) {
    for (const key of idKeys) {
      if (typeof entry[key] === 'string' && entry[key]) ids.add(entry[key]);
    }
  }
  return [...ids];
}

async function parse(logs, correlationId) {
  const res = await fetch(`${BASE}/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ logs, correlationId }),
  });
  const data = await res.json();
  return { status: res.status, data, engine: res.headers.get('x-trace-engine') };
}

const results = [];
let skipped = 0;

for (const file of files) {
  const content = readFileSync(join(TEST_LOGS, file), 'utf8');
  for (const id of correlationIdsIn(content)) {
    const { status, data, engine } = await parse(content, id);
    if (status !== 200 || !data.timeline?.eventCount) {
      skipped++;
      continue;
    }
    const n = data.narrative;
    results.push({
      file,
      id,
      engine,
      fallback: n?.fallback ?? true,
      validated: n?.validated ?? false,
      summary: (n?.summary ?? '').slice(0, 120),
    });
    process.stdout.write('.');
  }
}

console.log('\n');
console.log(`Worker: ${BASE}`);
console.log(`Timelines with events: ${results.length} (skipped ${skipped} empty/no-match)`);

const liveAccepted = results.filter((r) => !r.fallback && r.validated);
const liveRejected = results.filter((r) => !r.fallback && !r.validated);
const template = results.filter((r) => r.fallback);

console.log(`Live LLM accepted (validated, not fallback): ${liveAccepted.length}/${results.length}`);
console.log(`Live LLM rejected by validator:              ${liveRejected.length}/${results.length}`);
console.log(`Template fallback (AI error or rejected):    ${template.length}/${results.length}`);

if (liveAccepted.length > 0) {
  console.log('\nSample accepted:');
  console.log(`  ${liveAccepted[0].file}/${liveAccepted[0].id}: ${liveAccepted[0].summary}…`);
}
if (template.length > 0) {
  console.log('\nSample fallback:');
  console.log(`  ${template[0].file}/${template[0].id}: ${template[0].summary}…`);
}
