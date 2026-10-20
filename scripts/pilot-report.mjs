// Repeatable offline pilot QA report for an explicitly supplied local export
// from scripts/export-readings.mjs. It chains the existing manifest, audit and
// release-manifest tools; it never contacts a database or vendor service and
// parses no iMonnit, TRAXX or Facilities format.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTimestamp } from '../web/lib/reading-timestamps.mjs';
import { auditDay, elapsedIntervals, observationLineage, parseReadings } from './audit-readings.mjs';

const TIER = 'esp32_pt1000_max31865';
const DAY_MS = 86_400_000;
const MAX_DAYS = 92;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export class PilotReportError extends Error {}

function dayStart(date) {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new PilotReportError(`${date} is not a valid YYYY-MM-DD UTC day`);
  }
  return ms;
}

// Byte-level provenance only. Row problems are reported, not rejected.
export function verifyManifest(content, manifest) {
  if (!manifest) return { status: 'absent', checks: {} };
  const lines = content.length ? content.toString('utf8').replace(/\n$/, '').split('\n').length : 0;
  const checks = {
    format: manifest.format === 'jsonl',
    sha256: createHash('sha256').update(content).digest('hex') === manifest.sha256,
    row_count: lines === manifest.row_count,
    table: manifest.table === 'readings',
  };
  return { status: Object.values(checks).every(Boolean) ? 'verified' : 'mismatch', checks };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mergeIntervals(intervals) {
  const merged = [];
  for (const item of intervals) {
    const last = merged.at(-1);
    if (last && last.endExclusive === item.start) {
      last.endExclusive = item.endExclusive;
      last.slots += item.slots;
    } else merged.push({ ...item });
  }
  return merged;
}

const SYNTHETIC = /SYNTHETIC/i;

export function buildPilotReport({ content, manifest = null, startDate, endDate, dataLabel = null,
  allowUnverifiedInput = false, inputName = 'input.jsonl', tooling = null }) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const start = dayStart(startDate);
  const endExclusive = dayStart(endDate) + DAY_MS;
  const days = (endExclusive - start) / DAY_MS;
  if (days < 1 || days > MAX_DAYS) throw new PilotReportError(`Date range must cover 1-${MAX_DAYS} UTC days`);
  if (manifest && manifest.table && manifest.table !== 'readings') {
    throw new PilotReportError('Only fleet `readings` exports are pilot data; Prototype 22 is not a study freezer');
  }
  const integrity = verifyManifest(bytes, manifest);
  if (integrity.status !== 'verified' && !allowUnverifiedInput) {
    throw new PilotReportError(integrity.status === 'absent'
      ? 'No export manifest supplied; pass --allow-unverified-input to report on unverified bytes'
      : `Export does not match its manifest (${Object.entries(integrity.checks).filter(([, ok]) => !ok).map(([name]) => name).join(', ')})`);
  }
  const rows = parseReadings(bytes);

  const dates = Array.from({ length: days }, (_, index) => new Date(start + index * DAY_MS).toISOString().slice(0, 10));
  const daily = dates.map((date) => auditDay(rows, date));
  const first = daily[0];
  // Row-intrinsic counters repeat identically in every day's audit; count once.
  const rowIntrinsic = Object.fromEntries(['invalidRows', 'ignoredOtherTiers', 'invalidIds', 'invalidTimestamps']
    .map((key) => [key, first[key]]));
  const perDay = ['clockInvalid', 'missingClockValidity', 'invalidMappings', 'invalidTemperatures', 'missingDeviceIds',
    'missingObservationIds', 'duplicateObservations', 'conflictingObservationIds', 'invalidReceivedTimestamps',
    'negativeUploadDelays'];
  const summed = Object.fromEntries(perDay.map((key) => [key, daily.reduce((sum, day) => sum + day[key], 0)]));

  const inRange = [];
  let beforeRange = 0, afterRange = 0;
  for (const row of rows) {
    const recorded = row && typeof row === 'object' ? parseTimestamp(row.recorded_at) : null;
    if (recorded === null) continue;
    if (recorded < start) beforeRange++;
    else if (recorded >= endExclusive) afterRange++;
    else inRange.push(row);
  }

  const freezers = Array.from({ length: 21 }, (_, index) => {
    const freezerId = index + 1;
    const cadence = freezerId <= 6 ? 60_000 : 900_000;
    const dayItems = daily.map((day) => day.byFreezer[index]);
    const times = new Map();
    for (const row of inRange) {
      if (row.sensor_tier !== TIER || Number(row.freezer_id) !== freezerId || row.prototype_id !== undefined) continue;
      if (row.clock_valid !== undefined && row.clock_valid !== true) continue;
      const key = row.observation_id ?? `${row.recorded_at}\0${row.temp_c}`;
      if (!times.has(key)) times.set(key, parseTimestamp(row.recorded_at));
    }
    const sorted = [...times.values()].sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((time, i) => time - sorted[i]);
    const expected = dayItems.reduce((sum, item) => sum + item.expected, 0);
    const observed = dayItems.reduce((sum, item) => sum + item.observed, 0);
    return {
      freezerId, cadenceSeconds: cadence / 1000, expected, observed, missing: expected - observed,
      completenessPercent: Number((100 * observed / expected).toFixed(4)),
      duplicateRows: dayItems.reduce((sum, item) => sum + item.duplicateRows, 0),
      slotCollisions: dayItems.reduce((sum, item) => sum + item.slotCollisions, 0),
      maxUploadDelaySeconds: dayItems.reduce((max, item) => item.maxUploadDelaySeconds === null ? max
        : Math.max(max ?? 0, item.maxUploadDelaySeconds), null),
      missingIntervals: mergeIntervals(dayItems.flatMap((item) => item.missingIntervals)),
      cadence: { ...elapsedIntervals([...sorted], cadence),
        medianIntervalSeconds: gaps.length ? median(gaps) / 1000 : null,
        intervalsLongerThan1_5xCadence: gaps.filter((gap) => gap > cadence * 1.5).length },
    };
  });

  const count = (field) => {
    const counts = {};
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const value = row[field] == null ? '<null>' : String(row[field]);
      counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
  };
  const syntheticRows = rows.filter((row) => row && typeof row === 'object' &&
    (SYNTHETIC.test(String(row.firmware_version ?? '')) || SYNTHETIC.test(String(row.reset_reason ?? '')))).length;
  const label = dataLabel ?? (manifest?.synthetic_fixture || syntheticRows
    ? 'CONTAINS SYNTHETIC FIXTURE MARKERS - not research data' : 'unlabeled supplied export');

  return {
    reportVersion: 1,
    mode: 'offline_pilot_qa_report',
    generatedAtUtc: new Date().toISOString(),
    dataLabel: label,
    range: { startDate, endDate, days, startUtc: new Date(start).toISOString(), endExclusiveUtc: new Date(endExclusive).toISOString() },
    provenance: {
      input: { name: inputName, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), rows: rows.length },
      manifest: manifest ? { integrity: integrity.status, checks: integrity.checks, table: manifest.table ?? null,
        source_host: manifest.source_host ?? null, exported_at_utc: manifest.exported_at_utc ?? null,
        recorded_at_gte: manifest.recorded_at_gte ?? null, recorded_at_lt: manifest.recorded_at_lt ?? null,
        row_count: manifest.row_count ?? null, pagination: manifest.pagination ?? null,
        synthetic_fixture: manifest.synthetic_fixture === true } : { integrity: 'absent' },
      syntheticMarkerRows: syntheticRows,
      firmwareVersions: count('firmware_version'),
      sensorTiers: count('sensor_tier'),
      deviceIds: count('device_id'),
      tooling,
    },
    rows: { total: rows.length, inRange: inRange.length, beforeRange, afterRange, ...rowIntrinsic, ...summed },
    fleet: {
      expected: freezers.reduce((sum, item) => sum + item.expected, 0),
      observed: freezers.reduce((sum, item) => sum + item.observed, 0),
    },
    freezers,
    lineage: observationLineage(inRange),
    dailyAudits: daily.map(({ byFreezer, ...day }) => day),
    limitations: [
      'Offline QA of the supplied export only; not study, installation or data acceptance.',
      'Coverage uses half-open UTC cadence bins; completeness and exclusion rules await the study lead (R11).',
      'Physical freezer mapping, placement, sensor accuracy and genuineness of the data are not established here.',
      'Only this project\'s fleet export format is parsed; other sensor tiers are counted and ignored.',
    ],
  };
}

export function pilotMarkdown(report) {
  const p = report.provenance;
  const lines = [
    `# Offline pilot QA report: ${report.range.startDate} to ${report.range.endDate}`, '',
    `**Data label:** ${report.dataLabel}`, '',
    `Generated ${report.generatedAtUtc}. Input \`${p.input.name}\`, ${p.input.rows} rows, SHA-256 \`${p.input.sha256}\`.`,
    `Manifest integrity: **${p.manifest.integrity}**${p.manifest.source_host ? `; source host \`${p.manifest.source_host}\`, exported ${p.manifest.exported_at_utc}` : ''}.`,
    p.tooling?.git_commit ? `Tooling: commit \`${p.tooling.git_commit}\`${p.tooling.git_dirty ? ' (dirty working tree)' : ''}, source fingerprint \`${p.tooling.source_sha256}\`, Node ${p.tooling.node_version}.`
      : `Tooling provenance: ${p.tooling?.error ?? 'not recorded'}.`, '',
    `Rows in range ${report.rows.inRange}; before ${report.rows.beforeRange}; after ${report.rows.afterRange}. ` +
      `Invalid timestamps ${report.rows.invalidTimestamps}; invalid IDs ${report.rows.invalidIds}; other tiers ignored ${report.rows.ignoredOtherTiers}; ` +
      `clock-invalid ${report.rows.clockInvalid}; mapping errors ${report.rows.invalidMappings}; replays ${report.rows.duplicateObservations}; ` +
      `same-day conflicting IDs ${report.rows.conflictingObservationIds}.`, '',
    `Fleet UTC-bin coverage: ${report.fleet.observed}/${report.fleet.expected} slots.`, '',
    '| Freezer | Cadence s | Observed/expected | Missing intervals | Replays | Slot collisions | Median interval s | Max interval s | >1.5x cadence | Max upload delay s |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.freezers.map((f) => `| ${f.freezerId} | ${f.cadenceSeconds} | ${f.observed}/${f.expected} | ${f.missingIntervals.length} | ${f.duplicateRows} | ${f.slotCollisions} | ${f.cadence.medianIntervalSeconds ?? 'n/a'} | ${f.cadence.maxObservedIntervalSeconds ?? 'n/a'} | ${f.cadence.intervalsLongerThan1_5xCadence} | ${f.maxUploadDelaySeconds ?? 'n/a'} |`),
    '', '## Observation lineage', '',
    '| Device | Unique IDs | Boots | Sequence gaps | Backward clock steps | Boot-counter regressions | Cross-day conflicting IDs |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.lineage.devices.map((d) => `| ${d.deviceId} | ${d.uniqueObservations} | ${d.bootCount} | ${d.sequenceGaps} | ${d.clockStepsBackward} | ${d.bootCounterRegressions} | ${d.conflictingObservationIds} |`),
    '', report.lineage.interpretation, '',
    '## Limitations', '', ...report.limitations.map((item) => `- ${item}`), '',
  ];
  return `${lines.join('\n')}\n`;
}

// Reuses the existing release-manifest tool for git commit, dirty state and
// source fingerprint; the export itself is recorded as the hashed artifact.
export function toolingProvenance(inputPath) {
  try {
    const manifest = JSON.parse(execFileSync(process.execPath, [path.join(scriptDir, 'create-release-manifest.mjs'), inputPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    const { source_files: files, ...rest } = manifest;
    return { ...rest, source_file_count: files.length };
  } catch (error) {
    return { error: `release-manifest tool unavailable: ${error.message.split('\n')[0]}` };
  }
}

function usage() {
  return 'Usage: node scripts/pilot-report.mjs --input EXPORT.jsonl --start-date YYYY-MM-DD --end-date YYYY-MM-DD --output-dir DIR [--manifest FILE] [--data-label TEXT] [--allow-unverified-input]';
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--allow-unverified-input') { options[flag] = true; continue; }
    if (!['--input', '--start-date', '--end-date', '--output-dir', '--manifest', '--data-label'].includes(flag) ||
        !args[index + 1] || args[index + 1].startsWith('--') || options[flag]) throw new Error(usage());
    options[flag] = args[++index];
  }
  for (const flag of ['--input', '--start-date', '--end-date', '--output-dir']) if (!options[flag]) throw new Error(usage());
  const content = await readFile(options['--input']);
  const manifestPath = options['--manifest'] ?? `${options['--input']}.manifest.json`;
  const manifest = options['--manifest'] || existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : null;
  const report = buildPilotReport({ content, manifest, startDate: options['--start-date'], endDate: options['--end-date'],
    dataLabel: options['--data-label'] ?? null, allowUnverifiedInput: Boolean(options['--allow-unverified-input']),
    inputName: path.basename(options['--input']), tooling: toolingProvenance(path.resolve(options['--input'])) });
  const out = path.resolve(options['--output-dir']);
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'pilot-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.join(out, 'pilot-report.md'), pilotMarkdown(report), { flag: 'wx' });
  console.log(`Pilot report (${report.dataLabel}) written to ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
