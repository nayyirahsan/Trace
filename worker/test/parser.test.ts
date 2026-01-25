// Parity tests for the TypeScript fallback parser — mirrors the assertions
// in parser/parser/parser_test.go so both engines stay in sync.
// Run with: npm test (uses tsx + node:test)
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { decodeLogs, inferSchema, parseAndBuild } from '../src/parser';

function load(name: string): string {
  return readFileSync(join(__dirname, '..', '..', 'test_logs', name), 'utf8');
}

test('inference accuracy across all sample formats', () => {
  const expectations: Record<string, Record<string, string>> = {
    'express_sample.json': { correlationId: 'reqId', timestamp: 'time', serviceName: 'service', message: 'message', level: 'level' },
    'fastapi_sample.json': { correlationId: 'correlation_id', timestamp: 'timestamp', serviceName: 'logger', message: 'message', level: 'level' },
    'rails_sample.json': { correlationId: 'request_id', timestamp: 'created_at', serviceName: 'service_name', message: 'message', level: 'severity' },
    'go_stdlib_sample.json': { correlationId: 'traceId', timestamp: 'ts', serviceName: 'component', message: 'msg', level: 'level' },
    'mixed_services_sample.json': { correlationId: 'request_id', timestamp: 'timestamp', serviceName: 'service', message: 'msg', level: 'level' },
    'ndjson_mixed_conventions.ndjson': { correlationId: 'request_id', timestamp: 'timestamp', serviceName: 'service', message: 'msg', level: 'level' },
  };

  let total = 0;
  let correct = 0;
  for (const [file, expected] of Object.entries(expectations)) {
    const { raw, error } = decodeLogs(load(file));
    assert.equal(error, null, `${file}: ${error}`);
    const schema = inferSchema(raw) as unknown as Record<string, string>;
    for (const [role, field] of Object.entries(expected)) {
      total++;
      if (schema[role] === field) {
        correct++;
      } else {
        assert.fail(`${file} ${role}: expected ${field}, inferred ${schema[role]}`);
      }
    }
  }
  console.log(`TS fallback inference accuracy: ${correct}/${total}`);
});

test('mixed conventions resolve via aliases', () => {
  const { raw } = decodeLogs(load('mixed_services_sample.json'));
  const schema = inferSchema(raw);
  assert.ok(schema.aliases?.correlationId?.includes('req_id'));
  assert.ok(schema.aliases?.timestamp?.includes('ts'));
  assert.ok(schema.aliases?.serviceName?.includes('app'));
});

test('mixed services timeline for abc-123', () => {
  const { timeline, stats } = parseAndBuild(load('mixed_services_sample.json'), 'abc-123');
  assert.equal(stats?.missingTimestamp, 1);
  assert.equal(stats?.missingCorrelationId, 1);
  assert.ok(timeline.services.length >= 3);
  assert.equal(timeline.failurePoint?.serviceName, 'order-service');
  assert.ok(timeline.lastSuccess);
  const auth = timeline.services.find((s) => s.serviceName === 'auth-service');
  assert.equal(auth?.events[0].relativeMs, 120, 'interleaved lane must not be shifted');
  assert.equal(timeline.suspectedSkew, undefined);
});

test('ndjson with malformed lines and mixed conventions', () => {
  const { raw, malformed } = decodeLogs(load('ndjson_mixed_conventions.ndjson'));
  assert.equal(malformed, 2);
  const { timeline, stats } = parseAndBuild(load('ndjson_mixed_conventions.ndjson'), 'ord-77f2');
  assert.equal(stats?.malformedLines, 2);
  assert.equal(stats?.missingTimestamp, 1);
  assert.equal(stats?.missingCorrelationId, 1);
  assert.equal(timeline.eventCount, 8);
  assert.equal(timeline.services.length, 3);
  assert.equal(timeline.failurePoint?.serviceName, 'inventory');
  assert.equal(timeline.lastSuccess?.relativeMs, 150);
  assert.ok(raw.length > 0);
});

test('clock skew detection flags billing-service', () => {
  const { timeline } = parseAndBuild(load('clock_skew_sample.json'), 'pay-555');
  assert.equal(timeline.suspectedSkew?.length, 1);
  assert.equal(timeline.suspectedSkew?.[0].serviceName, 'billing-service');
  assert.equal(timeline.suspectedSkew?.[0].offsetMs, -119800);
});

test('empty and garbage input', () => {
  assert.ok(decodeLogs('').error);
  assert.ok(decodeLogs('hello\nworld').error);
  const { timeline } = parseAndBuild(load('mixed_services_sample.json'), 'nonexistent-id');
  assert.equal(timeline.eventCount, 0);
});
