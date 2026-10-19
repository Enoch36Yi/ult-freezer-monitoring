// Synthetic fixtures only. These temperatures are not research observations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDay } from './audit-readings.mjs';

const day = '2026-10-01';
function row(overrides = {}) {
  return { freezer_id: 1, device_id: 'freezer-01', sensor_tier: 'esp32_pt1000_max31865',
    observation_id: 'freezer-01-1-1', temp_c: -72, clock_valid: true,
    recorded_at: `${day}T00:00:02Z`, received_at: `${day}T00:00:05Z`, ...overrides };
}

test('includes the entire UTC day and reports actual missing intervals at both cadences', () => {
  const report = auditDay([row({ recorded_at: `${day}T23:59:59Z`, received_at: '2026-10-02T00:00:01Z' }),
    row({ freezer_id: 7, device_id: 'freezer-07', observation_id: 'freezer-07-1-1',
      recorded_at: `${day}T23:59:59Z`, received_at: '2026-10-02T00:00:01Z' })], day);
  assert.equal(report.expectedTotal, 10080);
  assert.equal(report.observedTotal, 2);
  assert.deepEqual(report.byFreezer[0].missingIntervals, [
    { start: `${day}T00:00:00.000Z`, endExclusive: `${day}T23:59:00.000Z`, slots: 1439 },
  ]);
  assert.equal(report.byFreezer[6].expected, 96);
  assert.equal(report.byFreezer[6].missingIntervals[0].endExclusive, `${day}T23:45:00.000Z`);
});

test('separates a replayed observation from two samples sharing one UTC bin', () => {
  const first = row();
  const report = auditDay([first, { ...first, received_at: `${day}T00:05:00Z` },
    row({ observation_id: 'freezer-01-1-2', recorded_at: `${day}T00:00:40Z` })], day);
  assert.equal(report.duplicateObservations, 1);
  assert.equal(report.byFreezer[0].duplicateRows, 1);
  assert.equal(report.byFreezer[0].slotCollisions, 1);
  assert.equal(report.byFreezer[0].observed, 1);
});

test('rejects malformed timestamps, invalid clocks, and mismatched logical source IDs', () => {
  const bad = ['2026-02-30T00:00:00Z', `${day}T12:00:00`, day, null];
  const report = auditDay([null, ...bad.map((recorded_at) => row({ recorded_at })),
    row({ clock_valid: false }), row({ freezer_id: 2 }),
    row({ observation_id: 'freezer-02-1-1' }), row({ temp_c: null })], day);
  assert.equal(report.invalidRows, 1);
  assert.equal(report.invalidTimestamps, 4);
  assert.equal(report.invalidMappings, 2);
  assert.equal(report.clockInvalid, 1);
  assert.equal(report.invalidTemperatures, 1);
  assert.equal(report.observedTotal, 0);
});

test('accepts explicit timezone offsets and microseconds while isolating other tiers and Prototype 22', () => {
  const report = auditDay([row({ recorded_at: '2026-09-30T17:00:02.123456-07:00' }),
    row({ sensor_tier: 'imonnit' }), row({ prototype_id: 22, freezer_id: undefined })], day);
  assert.equal(report.observedTotal, 1);
  assert.equal(report.ignoredOtherTiers, 1);
  assert.equal(report.invalidIds, 1);
});

test('rejects coerced hexadecimal and boolean freezer identifiers', () => {
  const report = auditDay([row({ freezer_id: '0x1' }), row({ freezer_id: true })], day);
  assert.equal(report.invalidIds, 2);
  assert.equal(report.observedTotal, 0);
});

test('conflicting replay IDs are flagged and cannot create another observed slot', () => {
  const report = auditDay([row(), row({ recorded_at: `${day}T00:01:02Z`, temp_c: -60 })], day);
  assert.equal(report.conflictingObservationIds, 1);
  assert.equal(report.observedTotal, 1);
});

test('an empty export stays explicitly incomplete and invalid days fail', () => {
  assert.equal(auditDay([], day).observedTotal, 0);
  assert.equal(auditDay([], day).byFreezer[20].missing, 96);
  assert.throws(() => auditDay([], '2026-02-30'), /valid/);
});

test('reports elapsed acquisition intervals separately from UTC bin coverage', () => {
  const report = auditDay([row({ recorded_at: `${day}T00:00:59Z` }),
    row({ observation_id: 'freezer-01-1-2', recorded_at: `${day}T00:02:00Z` }),
    row({ observation_id: 'freezer-01-1-3', recorded_at: `${day}T00:07:00Z` })], day);
  assert.equal(report.byFreezer[0].sampleCount, 3);
  assert.equal(report.byFreezer[0].maxObservedIntervalSeconds, 300);
  assert.equal(report.byFreezer[0].intervalsLongerThanCadence, 2);
});
