// Synthetic fixtures only. No network or research observations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exportReadings, parseArgs } from './export-readings.mjs';

const config = { baseUrl: 'https://fixture.example.test', key: 'fixture-public-key' };
const options = { table: 'readings', output: 'unused', start: '2026-10-01T00:00:00Z', end: '2026-10-02T00:00:00Z' };

test('exports both time bounds and continues through a server-capped short page', async () => {
  const urls = [];
  const pages = [[{ id: 1 }], [{ id: 2 }], []];
  const result = await exportReadings(options, config, async (input) => {
    urls.push(new URL(input));
    return Response.json(pages.shift());
  });
  assert.deepEqual(urls[0].searchParams.getAll('recorded_at'), [
    'gte.2026-10-01T00:00:00Z', 'lt.2026-10-02T00:00:00Z',
  ]);
  assert.equal(result.manifest.row_count, 2);
  assert.equal(result.content, '{"id":1}\n{"id":2}\n');
  assert.deepEqual(urls.map((url) => url.searchParams.get('offset')), ['0', '1', '2']);
});

test('refuses repeated/out-of-order page IDs instead of silently duplicating an export', async () => {
  const pages = [[{ id: 2 }], [{ id: 2 }], []];
  await assert.rejects(exportReadings(options, config, async () => Response.json(pages.shift())), /order|progress/i);
});

test('export bounds require a real calendar date and explicit timezone', () => {
  for (const bad of ['2026-10-01', '2026-10-01T00:00:00', '2026-02-30T00:00:00Z']) {
    assert.throws(() => parseArgs(['--table', 'readings', '--output', 'unused', '--start', bad]), /timestamp/i);
  }
});
