// Grounding tests for the narrative validator.
//
// Strategy: the validator is the hallucination firewall — any LLM summary
// referencing a service or number absent from the structured context is
// rejected and replaced by the deterministic template. These tests check
// (a) the template itself always passes (so rejection never degrades into
// nonsense), (b) grounded summaries pass, (c) hallucinated ones are caught.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildContext, buildFallbackNarrative, validateNarrative } from '../src/narrate';
import { decodeLogs, inferSchema, parseAndBuild } from '../src/parser';

const files = [
  'express_sample.json',
  'fastapi_sample.json',
  'rails_sample.json',
  'go_stdlib_sample.json',
  'mixed_services_sample.json',
  'ndjson_mixed_conventions.ndjson',
  'clock_skew_sample.json',
];

function load(name: string): string {
  return readFileSync(join(__dirname, '..', '..', 'test_logs', name), 'utf8');
}

function correlationIdsIn(content: string): string[] {
  const { raw } = decodeLogs(content);
  const schema = inferSchema(raw);
  const fields = [schema.correlationId, ...(schema.aliases?.correlationId ?? [])];
  const ids = new Set<string>();
  for (const entry of raw) {
    for (const f of fields) {
      const v = entry[f];
      if (typeof v === 'string' && v) ids.add(v);
    }
  }
  return [...ids];
}

test('fallback template passes its own validator on every sample timeline', () => {
  let timelines = 0;
  for (const file of files) {
    const content = load(file);
    for (const id of correlationIdsIn(content)) {
      const { timeline } = parseAndBuild(content, id);
      if (timeline.eventCount === 0) continue;
      timelines++;
      const context = buildContext(timeline);
      const fallback = buildFallbackNarrative(context);
      const verdict = validateNarrative(fallback, context);
      assert.ok(verdict.ok, `${file}/${id}: template rejected: ${verdict.reason}\n${fallback}`);
    }
  }
  assert.ok(timelines >= 20, `expected 20+ timelines, got ${timelines}`);
  console.log(`validated fallback template on ${timelines} timelines — 0 rejections`);
});

function contextFor(file: string, id: string) {
  const { timeline } = parseAndBuild(load(file), id);
  assert.ok(timeline.eventCount > 0, `no events for ${id}`);
  return buildContext(timeline);
}

test('grounded summaries are accepted', () => {
  const abc = contextFor('mixed_services_sample.json', 'abc-123');
  const grounded = [
    'Request abc-123 failed in order-service at 450ms (HTTP 503) after succeeding through api-gateway and auth-service.',
    'The request progressed through api-gateway and auth-service before order-service reported "Database connection timeout" at 450ms.',
    'order-service failed at 0.45s with HTTP 503; the last successful operation was in order-service at 350ms.',
  ];
  for (const s of grounded) {
    const verdict = validateNarrative(s, abc);
    assert.ok(verdict.ok, `should accept: "${s}" — ${verdict.reason}`);
  }

  const def = contextFor('mixed_services_sample.json', 'def-456');
  const okSuccess = validateNarrative('Request def-456 completed successfully in api-gateway in 10ms.', def);
  assert.ok(okSuccess.ok, okSuccess.reason);

  // Dotted service names referenced as "the X service" must ground
  // (observed live: llama-3.1-8b-instruct-fast on fast-200).
  const fast = contextFor('fastapi_sample.json', 'fast-200');
  const dotted = validateNarrative(
    'The request failed at 300ms due to a stock reservation failure in the api.inventory service.',
    fast,
  );
  assert.ok(dotted.ok, dotted.reason);
});

test('hallucinated summaries are rejected', () => {
  const abc = contextFor('mixed_services_sample.json', 'abc-123');
  const def = contextFor('mixed_services_sample.json', 'def-456');

  const rejected: Array<[ReturnType<typeof buildContext>, string, string]> = [
    [abc, 'Request abc-123 failed in payment-service at 450ms.', 'unknown service'],
    [abc, 'order-service failed at 9999ms after a database timeout.', 'invented timing'],
    [abc, 'The request took 5 seconds before order-service failed at 450ms.', 'invented duration'],
    [abc, 'Request abc-123 completed successfully across 3 services.', 'omits the failure'],
    [abc, 'auth-service failed at 450ms with HTTP 503.', 'misattributed failure'],
    [abc, 'The cache service timed out at 450ms in order-service.', 'unknown service phrase'],
    [abc, 'order-service failed at 450ms; retrying via backup-cluster resolved it.', 'unknown identifier'],
    [abc, 'order-service returned HTTP 500 at 450ms.', 'wrong status code'],
    [def, 'Request def-456 failed in api-gateway at 10ms.', 'invented failure on clean timeline'],
    [def, 'Request def-456 completed in 250ms.', 'invented duration on clean timeline'],
  ];

  let caught = 0;
  for (const [ctx, summary, label] of rejected) {
    const verdict = validateNarrative(summary, ctx);
    assert.ok(!verdict.ok, `should reject (${label}): "${summary}"`);
    caught++;
  }
  console.log(`rejected ${caught}/${rejected.length} hallucinated summaries`);
});

test('skew note in fallback stays grounded', () => {
  const pay = contextFor('clock_skew_sample.json', 'pay-555');
  assert.ok(pay.suspectedSkew && pay.suspectedSkew.length === 1);
  const fallback = buildFallbackNarrative(pay);
  assert.match(fallback, /clock skew/);
  const verdict = validateNarrative(fallback, pay);
  assert.ok(verdict.ok, verdict.reason);
});
