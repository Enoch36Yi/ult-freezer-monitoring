import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDay } from './audit-readings.mjs';

test('uses 1-minute and 15-minute UTC grids without counting duplicate slots', () => {
  const rows = [
    { freezer_id: 1, sensor_tier: 'esp32_ds18b20', recorded_at: '2026-09-25T00:00:02Z', received_at: '2026-09-25T00:00:05Z' },
    { freezer_id: 1, sensor_tier: 'esp32_ds18b20', recorded_at: '2026-09-25T00:00:04Z', received_at: '2026-09-25T00:00:06Z' },
    { freezer_id: 7, sensor_tier: 'esp32_ds18b20', recorded_at: '2026-09-25T00:15:10Z', received_at: '2026-09-25T00:15:20Z' },
  ];
  const result = auditDay(rows, '2026-09-25');
  assert.equal(result.expectedTotal, 10080);
  assert.deepEqual(result.byFreezer[0], { freezerId: 1, expected: 1440, observed: 1,
    missing: 1439, duplicateRows: 1, completenessPercent: 0.0694, maxUploadDelaySeconds: 3 });
  assert.equal(result.byFreezer[6].expected, 96);
  assert.equal(result.byFreezer[6].observed, 1);
});

test('reports invalid and out-of-window timestamps instead of inventing slots', () => {
  const result = auditDay([
    { freezer_id: 1, sensor_tier: 'esp32_ds18b20', recorded_at: 'bad' },
    { freezer_id: 1, sensor_tier: 'esp32_ds18b20', recorded_at: '2026-09-24T23:59:59Z' },
    { freezer_id: 1, sensor_tier: 'imonnit', recorded_at: '2026-09-25T00:00:00Z' },
  ], '2026-09-25');
  assert.equal(result.invalidTimestamps, 1);
  assert.equal(result.outOfWindow, 1);
  assert.equal(result.byFreezer[0].observed, 0);
});

test('an empty export is clearly incomplete rather than accepted as a pilot', () => {
  const result = auditDay([], '2026-09-25');
  assert.equal(result.observedTotal, 0);
  assert.equal(result.byFreezer[0].completenessPercent, 0);
});
