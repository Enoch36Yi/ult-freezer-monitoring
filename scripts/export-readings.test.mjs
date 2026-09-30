import assert from 'node:assert/strict';
import test from 'node:test';
import { exportReadings, parseArgs, summarizeRows } from './export-readings.mjs';

test('export arguments require a supported table and new output path', () => {
  assert.deepEqual(parseArgs([
    '--table', 'readings', '--output', '/tmp/readings.jsonl',
    '--start', '2026-09-01T00:00:00Z', '--end', '2026-09-02T00:00:00Z',
  ]), {
    table: 'readings',
    output: '/tmp/readings.jsonl',
    start: '2026-09-01T00:00:00Z',
    end: '2026-09-02T00:00:00Z',
  });
  assert.throws(() => parseArgs(['--table', 'users', '--output', 'out.jsonl']), /Usage/);
  assert.throws(() => parseArgs(['--table', 'readings', '--output', 'out.jsonl',
    '--start', '2026-09-02', '--end', '2026-09-01']), /End must be after/);
});

test('export records row counts, UTC bounds, and a content hash', async () => {
  const page = [
    { id: 1, recorded_at: '2026-09-01T00:00:00Z', received_at: '2026-09-01T00:00:02Z' },
    { id: 2, recorded_at: '2026-09-01T00:01:00Z', received_at: '2026-09-01T00:01:03Z' },
  ];
  const calls = [];
  const result = await exportReadings(
    { table: 'readings', output: 'unused', start: null, end: null },
    { baseUrl: 'https://db.example.test', key: 'public-test-key' },
    async (url) => {
      calls.push(url);
      return new Response(JSON.stringify(page), { status: 200 });
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(result.manifest.row_count, 2);
  assert.deepEqual(result.manifest.recorded_at, {
    first: '2026-09-01T00:00:00.000Z', last: '2026-09-01T00:01:00.000Z',
  });
  assert.match(result.manifest.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.content.split('\n').filter(Boolean).length, 2);
});

test('summary reports no bounds for an empty snapshot', () => {
  assert.deepEqual(summarizeRows([]), {
    row_count: 0,
    recorded_at: null,
    received_at: null,
  });
});
