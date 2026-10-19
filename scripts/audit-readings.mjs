import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseTimestamp } from '../web/lib/reading-timestamps.mjs';

export function auditDay(rows, date) {
  const tier = 'esp32_pt1000_max31865';
  if (!Array.isArray(rows)) throw new Error('Input must be a JSON array of readings');
  const start = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(start) ||
      new Date(start).toISOString().slice(0, 10) !== date) {
    throw new Error('Date must be a valid YYYY-MM-DD UTC day');
  }
  const end = start + 86_400_000;
  const byFreezer = Array.from({ length: 21 }, (_, index) => {
    const freezerId = index + 1;
    const interval = freezerId <= 6 ? 60_000 : 900_000;
    return { freezerId, expected: 86_400_000 / interval, slots: new Set(), times: [],
      duplicateRows: 0, slotCollisions: 0, maxUploadDelaySeconds: null };
  });
  let invalidTimestamps = 0;
  let invalidReceivedTimestamps = 0;
  let invalidIds = 0;
  let outOfWindow = 0;
  let negativeUploadDelays = 0;
  let invalidRows = 0, ignoredOtherTiers = 0, invalidMappings = 0;
  let clockInvalid = 0, missingClockValidity = 0, invalidTemperatures = 0;
  let missingDeviceIds = 0, missingObservationIds = 0;
  let duplicateObservations = 0, conflictingObservationIds = 0;
  const observations = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { invalidRows++; continue; }
    if (row.sensor_tier !== tier) { ignoredOtherTiers++; continue; }
    const id = Number(row.freezer_id);
    if (!['number', 'string'].includes(typeof row.freezer_id) ||
        (typeof row.freezer_id === 'string' && !/^\d+$/.test(row.freezer_id)) ||
        !Number.isInteger(id) || id < 1 || id > 21 || row.prototype_id !== undefined) { invalidIds++; continue; }
    const recorded = parseTimestamp(row.recorded_at);
    if (recorded === null) { invalidTimestamps++; continue; }
    if (recorded < start || recorded >= end) { outOfWindow++; continue; }
    if (row.clock_valid !== undefined && row.clock_valid !== true) { clockInvalid++; continue; }
    if (row.clock_valid === undefined) missingClockValidity++;
    const expectedDevice = `freezer-${String(id).padStart(2, '0')}`;
    if (row.device_id === undefined || row.device_id === null) missingDeviceIds++;
    else if (row.device_id !== expectedDevice) { invalidMappings++; continue; }
    if (row.observation_id === undefined || row.observation_id === null) missingObservationIds++;
    else if (typeof row.observation_id !== 'string' ||
        !new RegExp(`^${expectedDevice}-[0-9]+-[0-9]+$`).test(row.observation_id)) { invalidMappings++; continue; }
    const temperature = Number(row.temp_c);
    if (!['number', 'string'].includes(typeof row.temp_c) ||
        (typeof row.temp_c === 'string' && !row.temp_c.trim()) ||
        !Number.isFinite(temperature) || temperature < -200 || temperature > 850) { invalidTemperatures++; continue; }
    const target = byFreezer[id - 1];
    const interval = id <= 6 ? 60_000 : 900_000;
    const received = parseTimestamp(row.received_at);
    if (received === null) invalidReceivedTimestamps++;
    else {
      const delay = (received - recorded) / 1000;
      if (delay < 0) negativeUploadDelays++;
      else target.maxUploadDelaySeconds = Math.max(target.maxUploadDelaySeconds ?? 0, delay);
    }
    if (row.observation_id != null) {
      const fingerprint = JSON.stringify([id, recorded, temperature]);
      if (observations.has(row.observation_id)) {
        if (observations.get(row.observation_id) !== fingerprint) conflictingObservationIds++;
        else { duplicateObservations++; target.duplicateRows++; }
        continue;
      }
      observations.set(row.observation_id, fingerprint);
    }
    // Half-open UTC bins cover the whole day; rounding loses the final half
    // interval and mislabels late samples. Bin collisions are not replay IDs.
    const slot = Math.floor((recorded - start) / interval);
    target.times.push(recorded);
    if (target.slots.has(slot)) target.slotCollisions++;
    else target.slots.add(slot);
  }
  const summarized = byFreezer.map(({ slots, times, ...item }) => ({
    ...item,
    observed: slots.size,
    missing: item.expected - slots.size,
    completenessPercent: Number((100 * slots.size / item.expected).toFixed(4)),
    missingIntervals: missingIntervals(slots, item.expected, start, item.freezerId <= 6 ? 60_000 : 900_000),
    ...elapsedIntervals(times, item.freezerId <= 6 ? 60_000 : 900_000),
  }));
  return {
    reportVersion: 2, date, tier, mode: 'offline_raw_count_audit',
    expectedTotal: 10080,
    observedTotal: summarized.reduce((sum, item) => sum + item.observed, 0),
    invalidTimestamps, invalidReceivedTimestamps, invalidIds, outOfWindow,
    negativeUploadDelays, invalidRows, ignoredOtherTiers, invalidMappings,
    clockInvalid, missingClockValidity, invalidTemperatures, missingDeviceIds,
    missingObservationIds, duplicateObservations, conflictingObservationIds,
    byFreezer: summarized,
    completenessDefinition: 'Occupied half-open UTC cadence bins; duplicate observation IDs do not add coverage. Slot collisions are separate from replays.',
    limitation: 'Raw coverage is not acceptance. Missing provenance, conflicts, sensor accuracy, physical mapping, placement, exclusions and baseline eligibility require review. UTC bins do not prove exact elapsed-time cadence.',
  };
}

export function elapsedIntervals(times, cadence) {
  times.sort((a, b) => a - b);
  let max = null, longer = 0;
  for (let index = 1; index < times.length; index++) {
    const interval = times[index] - times[index - 1];
    max = Math.max(max ?? 0, interval);
    if (interval > cadence) longer++;
  }
  return { sampleCount: times.length,
    firstRecordedAt: times.length ? new Date(times[0]).toISOString() : null,
    lastRecordedAt: times.length ? new Date(times.at(-1)).toISOString() : null,
    maxObservedIntervalSeconds: max === null ? null : max / 1000,
    intervalsLongerThanCadence: longer };
}

function missingIntervals(slots, expected, start, interval) {
  const result = [];
  for (let slot = 0; slot < expected;) {
    if (slots.has(slot)) { slot++; continue; }
    const first = slot;
    while (slot < expected && !slots.has(slot)) slot++;
    result.push({ start: new Date(start + first * interval).toISOString(),
      endExclusive: new Date(start + slot * interval).toISOString(), slots: slot - first });
  }
  return result;
}

// Observation IDs are `<device>-<persistent boot counter>-<sample sequence>`.
// Across an entire export (not one UTC day) this reports what the counter and
// sequence imply: sequence numbers absent between the first and last seen in a
// boot, recorded_at moving backward within a boot, the boot counter decreasing
// over recorded time (NVS erase or MCU replacement under one logical ID), and
// IDs reused with different content. These are QA signals, not exclusions.
export function observationLineage(rows) {
  const devices = new Map();
  let legacyRowsWithoutIdentity = 0, unparsedObservationIds = 0, invalidTimestamps = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    if (row.device_id == null && row.observation_id == null) { legacyRowsWithoutIdentity++; continue; }
    const device = row.device_id;
    const id = row.observation_id;
    const parts = typeof device === 'string' && typeof id === 'string' && id.startsWith(`${device}-`)
      ? /^([0-9]+)-([0-9]+)$/.exec(id.slice(device.length + 1)) : null;
    const boot = parts ? Number(parts[1]) : NaN;
    const seq = parts ? Number(parts[2]) : NaN;
    if (!Number.isSafeInteger(boot) || !Number.isSafeInteger(seq)) { unparsedObservationIds++; continue; }
    const recorded = parseTimestamp(row.recorded_at);
    if (recorded === null) { invalidTimestamps++; continue; }
    if (!devices.has(device)) devices.set(device, new Map());
    const seen = devices.get(device);
    const fingerprint = JSON.stringify([recorded, Number(row.temp_c)]);
    const previous = seen.get(id);
    if (previous) {
      if (previous.fingerprint === fingerprint) previous.replays++;
      else previous.conflicts++;
      continue;
    }
    seen.set(id, { id, boot, seq, recorded, fingerprint, replays: 0, conflicts: 0 });
  }
  const summary = [...devices.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([deviceId, seen]) => {
    const samples = [...seen.values()];
    const boots = new Map();
    for (const sample of samples) {
      if (!boots.has(sample.boot)) boots.set(sample.boot, []);
      boots.get(sample.boot).push(sample);
    }
    let sequenceGaps = 0, clockStepsBackward = 0;
    const gapRanges = [], clockStepExamples = [];
    const bootSummaries = [...boots.entries()].sort(([a], [b]) => a - b).map(([boot, list]) => {
      list.sort((a, b) => a.seq - b.seq);
      for (let index = 1; index < list.length; index++) {
        const missing = list[index].seq - list[index - 1].seq - 1;
        if (missing > 0) {
          sequenceGaps += missing;
          if (gapRanges.length < 20) gapRanges.push({ boot, firstMissing: list[index - 1].seq + 1, lastMissing: list[index].seq - 1 });
        }
        if (list[index].recorded < list[index - 1].recorded) {
          clockStepsBackward++;
          if (clockStepExamples.length < 10) {
            clockStepExamples.push({ before: list[index - 1].id, after: list[index].id,
              stepSeconds: (list[index].recorded - list[index - 1].recorded) / 1000 });
          }
        }
      }
      return { boot, samples: list.length, firstSequence: list[0].seq, lastSequence: list.at(-1).seq };
    });
    const byTime = [...samples].sort((a, b) => a.recorded - b.recorded || a.boot - b.boot || a.seq - b.seq);
    let bootCounterRegressions = 0;
    const regressionExamples = [];
    for (let index = 1; index < byTime.length; index++) {
      if (byTime[index].boot < byTime[index - 1].boot) {
        bootCounterRegressions++;
        if (regressionExamples.length < 10) regressionExamples.push({ before: byTime[index - 1].id, after: byTime[index].id });
      }
    }
    return {
      deviceId, uniqueObservations: samples.length, bootCount: boots.size,
      replayedObservations: samples.reduce((sum, item) => sum + item.replays, 0),
      conflictingObservationIds: samples.filter((item) => item.conflicts > 0).length,
      sequenceGaps, gapRanges, clockStepsBackward, clockStepExamples,
      bootCounterRegressions, regressionExamples, boots: bootSummaries,
    };
  });
  return {
    devices: summary, legacyRowsWithoutIdentity, unparsedObservationIds, invalidTimestamps,
    interpretation: 'Sequence gaps are produced readings absent from this export: undelivered, trimmed from a full queue, still buffered, outside the window, or ignored by the server as reused IDs. Boot-counter regressions indicate NVS reset, MCU replacement or clock problems and need investigation.',
  };
}

export function parseReadings(input) {
  const text = input.toString('utf8').trim();
  if (!text) return [];
  if (text.startsWith('[')) return JSON.parse(text);
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`Invalid JSONL at line ${index + 1}`); }
  });
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  if (args.length % 2 !== 0) throw new Error('Usage: node scripts/audit-readings.mjs --input PATH --date YYYY-MM-DD [--report PATH]');
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--input', '--date', '--report'].includes(flag) ||
        options[flag] || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Invalid audit options');
    }
    options[flag] = args[index + 1];
  }
  if (!options['--input'] || !options['--date']) throw new Error('Both --input and --date are required');
  const input = await readFile(options['--input']);
  const report = auditDay(parseReadings(input), options['--date']);
  report.inputSha256 = createHash('sha256').update(input).digest('hex');
  if (options['--report']) await writeFile(options['--report'], `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
