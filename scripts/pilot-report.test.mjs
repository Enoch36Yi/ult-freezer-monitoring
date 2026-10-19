// Labeled synthetic fixtures only (firmware_version SYNTHETIC-FIXTURE). These
// rows are not research observations and no vendor/Facilities format is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { observationLineage } from './audit-readings.mjs';
import { PilotReportError, buildPilotReport, pilotMarkdown } from './pilot-report.mjs';
import { syntheticPilotExport } from './fixtures/synthetic-pilot-export.mjs';

const fixture = () => syntheticPilotExport().content;
const fixtureManifest = () => syntheticPilotExport().manifest;

test('pilot report chains manifest verification, daily audits, cadence and lineage', () => {
  const content = fixture();
  const report = buildPilotReport({ content, manifest: fixtureManifest(),
    startDate: '2026-10-01', endDate: '2026-10-02', inputName: 'synthetic.jsonl' });
  assert.match(report.dataLabel, /SYNTHETIC/);
  assert.equal(report.provenance.manifest.integrity, 'verified');
  assert.equal(report.rows.invalidTimestamps, 1);
  assert.equal(report.rows.ignoredOtherTiers, 1);
  assert.equal(report.rows.invalidIds, 1);
  assert.equal(report.rows.clockInvalid, 1);
  assert.equal(report.rows.duplicateObservations, 1);
  assert.equal(report.rows.afterRange, 1);
  assert.equal(report.rows.conflictingObservationIds, 0, 'per-day audits cannot see a cross-day reuse');

  const freezer1 = report.freezers[0];
  assert.equal(freezer1.expected, 2880);
  assert.ok(freezer1.missingIntervals.some((item) => item.start === '2026-10-01T00:05:00.000Z' && item.slots === 1));
  assert.equal(freezer1.slotCollisions, 1);
  const freezer7 = report.freezers[6];
  assert.equal(freezer7.cadence.medianIntervalSeconds, 900);
  assert.equal(freezer7.cadence.intervalsLongerThan1_5xCadence, 1);
  assert.equal(freezer7.cadence.maxObservedIntervalSeconds, 2700);

  const lineage = report.lineage.devices.find((item) => item.deviceId === 'freezer-01');
  // Sequence 13 exists only with an unusable timestamp, so it is absent too.
  assert.equal(lineage.sequenceGaps, 2);
  assert.deepEqual(lineage.gapRanges, [{ boot: 5, firstMissing: 6, lastMissing: 6 },
    { boot: 5, firstMissing: 13, lastMissing: 13 }]);
  assert.equal(lineage.clockStepsBackward, 1);
  assert.equal(lineage.bootCounterRegressions, 1);
  assert.equal(lineage.conflictingObservationIds, 1);
  assert.equal(lineage.replayedObservations, 1);
  assert.match(pilotMarkdown(report), /SYNTHETIC/);
});

test('unverified, mismatched, Prototype 22 and out-of-bounds requests are refused', () => {
  const content = fixture();
  const manifest = fixtureManifest();
  const args = { content, startDate: '2026-10-01', endDate: '2026-10-02' };
  assert.throws(() => buildPilotReport({ ...args, manifest: { ...manifest, sha256: '0'.repeat(64) } }), /sha256/);
  assert.throws(() => buildPilotReport({ ...args, manifest: null }), /No export manifest/);
  assert.equal(buildPilotReport({ ...args, manifest: null, allowUnverifiedInput: true }).provenance.manifest.integrity, 'absent');
  assert.throws(() => buildPilotReport({ ...args, manifest: { ...manifest, table: 'prototype_readings' } }), PilotReportError);
  assert.throws(() => buildPilotReport({ ...args, manifest, endDate: '2026-09-30' }), /1-92/);
  assert.throws(() => buildPilotReport({ ...args, manifest, startDate: '2026-02-30' }), /valid/);
});

test('lineage ignores legacy NULL identities and counts unparsable IDs separately', () => {
  const result = observationLineage([{ device_id: null, observation_id: null, recorded_at: '2026-10-01T00:00:00Z' },
    { device_id: 'freezer-01', observation_id: 'freezer-02-1-1', recorded_at: '2026-10-01T00:00:00Z' }]);
  assert.equal(result.legacyRowsWithoutIdentity, 1);
  assert.equal(result.unparsedObservationIds, 1);
  assert.deepEqual(result.devices, []);
});

test('command line writes JSON and Markdown with release-manifest tooling provenance', (t) => {
  const dir = mkdtempSync(resolve(tmpdir(), 'freezer-pilot-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const content = fixture();
  writeFileSync(resolve(dir, 'synthetic.jsonl'), content);
  writeFileSync(resolve(dir, 'synthetic.jsonl.manifest.json'), JSON.stringify(fixtureManifest()));
  execFileSync(process.execPath, [new URL('./pilot-report.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    '--input', resolve(dir, 'synthetic.jsonl'), '--start-date', '2026-10-01', '--end-date', '2026-10-02',
    '--output-dir', resolve(dir, 'out')], { encoding: 'utf8' });
  const report = JSON.parse(readFileSync(resolve(dir, 'out/pilot-report.json'), 'utf8'));
  assert.match(report.provenance.tooling.git_commit, /^[0-9a-f]{40}$/);
  assert.match(report.provenance.tooling.source_sha256, /^[0-9a-f]{64}$/);
  assert.equal(report.provenance.tooling.artifacts[0].sha256, report.provenance.input.sha256);
  assert.match(readFileSync(resolve(dir, 'out/pilot-report.md'), 'utf8'), /Observation lineage/);
});
