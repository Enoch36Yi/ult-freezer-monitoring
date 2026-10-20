// Synthetic fixtures in isolated in-memory PostgreSQL engines; never connects
// to Supabase. The PGlite integration needs FREEZER_PGLITE_MODULE, like the
// replay-index test; byte-level verification below runs without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportRejected, sha256, verifyExport } from './import-readings.mjs';
import { consistentManifest, runRestoreRehearsal } from './restore-rehearsal.mjs';

const modulePath = process.env.FREEZER_PGLITE_MODULE;
const skip = modulePath ? false : 'Set FREEZER_PGLITE_MODULE to run the local PostgreSQL restore rehearsal';

const row = (overrides = {}) => ({ id: 1, freezer_id: 1, device_id: 'freezer-01', firmware_version: 'SYNTHETIC-FIXTURE',
  payload_version: 1, observation_id: 'freezer-01-1-1', sensor_tier: 'esp32_pt1000_max31865', temp_c: -80,
  rssi: -60, reset_reason: null, recorded_at: '2026-10-01T00:00:02+00:00', clock_valid: true,
  received_at: '2026-10-01T00:00:05+00:00', ...overrides });
const base = { format: 'jsonl', table: 'readings', recorded_at_gte: null, recorded_at_lt: null };
const encode = (rows) => rows.map((item) => JSON.stringify(item)).join('\n') + '\n';
const rejects = (code, fn) => assert.throws(fn, (error) => error instanceof ImportRejected && error.code === code);

test('verified export bytes parse with their original lines', () => {
  const content = encode([row(), row({ id: 2, observation_id: 'freezer-01-1-2', recorded_at: '2026-10-01T00:01:02Z' })]);
  const verified = verifyExport(content, consistentManifest(content, base), 'readings');
  assert.equal(verified.rows.length, 2);
  assert.equal(verified.lines[1], content.split('\n')[1]);
});

test('byte-level corruption and manifest mismatches are rejected before any database work', () => {
  const content = encode([row(), row({ id: 2, observation_id: 'freezer-01-1-2' })]);
  const manifest = consistentManifest(content, base);
  rejects('sha256_mismatch', () => verifyExport(content.slice(0, -5), manifest, 'readings'));
  rejects('truncated', () => verifyExport(content.slice(0, -5), consistentManifest(content.slice(0, -5), base), 'readings'));
  rejects('row_count_mismatch', () => verifyExport(content, { ...manifest, row_count: 3 }, 'readings'));
  rejects('bounds_mismatch', () => verifyExport(content, { ...manifest, recorded_at: null }, 'readings'));
  rejects('table_mismatch', () => verifyExport(content, manifest, 'prototype_readings'));
  rejects('manifest_missing', () => verifyExport(content, undefined, 'readings'));
  rejects('manifest_invalid', () => verifyExport(content, { ...manifest, format: 'csv' }, 'readings'));
});

test('row checks enforce timestamps, source mapping, legacy identity pairs and uniqueness', () => {
  const cases = [
    ['invalid_row', [row({ recorded_at: '2026-02-30T00:00:00Z' })]],
    ['invalid_row', [row({ received_at: '2026-10-01T00:00:05' })]],
    ['invalid_row', [row({ freezer_id: 22 })]],
    ['invalid_row', [row({ prototype_id: 22 })]],
    ['invalid_mapping', [row({ device_id: 'freezer-02' })]],
    ['invalid_mapping', [row({ observation_id: 'freezer-02-1-1' })]],
    ['invalid_mapping', [row({ observation_id: null })]],
    ['duplicate_id', [row(), row({ observation_id: 'freezer-01-1-2' })]],
    ['duplicate_observation', [row(), row({ id: 2 })]],
  ];
  for (const [code, rows] of cases) {
    const content = encode(rows);
    rejects(code, () => verifyExport(content, consistentManifest(content, base), 'readings'));
  }
  const legacy = encode([row({ device_id: null, observation_id: null, sensor_tier: 'esp32_ds18b20', clock_valid: null })]);
  assert.equal(verifyExport(legacy, consistentManifest(legacy, base), 'readings').rows.length, 1);
});

test('window bounds from the manifest are half-open and enforced', () => {
  const windowed = { ...base, recorded_at_gte: '2026-10-01T00:00:00Z', recorded_at_lt: '2026-10-01T00:01:00Z' };
  const late = encode([row({ recorded_at: '2026-10-01T00:01:00Z' })]);
  rejects('outside_window', () => verifyExport(late, consistentManifest(late, windowed), 'readings'));
  const inside = encode([row({ recorded_at: '2026-10-01T00:00:59.999999Z' })]);
  assert.equal(verifyExport(inside, consistentManifest(inside, windowed), 'readings').rows.length, 1);
  assert.equal(sha256(Buffer.from(inside)), consistentManifest(inside, windowed).sha256);
});

test('synthetic ledger-to-ledger restore rehearsal passes every check', { skip }, async () => {
  const report = await runRestoreRehearsal({ pgliteModule: modulePath });
  const failed = report.checks.filter((item) => !item.passed);
  assert.deepEqual(failed, []);
  assert.equal(report.passed, true);
  assert.equal(report.fixtures.readings, 45);
  assert.equal(report.fixtures.prototype_readings, 6);
  assert.ok(report.checks.length >= 20);
  assert.ok(report.findings.some((item) => /fresh schema\.sql path/.test(item)));
  assert.ok(report.schemaDifferences.some((item) => item.column === 'device_id' && item.field === 'is_nullable'));
  assert.match(report.disclaimer, /Not a production backup/);
});
