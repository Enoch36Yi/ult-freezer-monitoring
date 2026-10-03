import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
    return { freezerId, expected: 86_400_000 / interval, slots: new Set(),
      duplicateRows: 0, maxUploadDelaySeconds: null };
  });
  let invalidTimestamps = 0;
  let invalidReceivedTimestamps = 0;
  let invalidIds = 0;
  let outOfWindow = 0;
  let boundaryUnmatched = 0;
  let negativeUploadDelays = 0;
  for (const row of rows) {
    if (row.sensor_tier !== tier) continue;
    const id = Number(row.freezer_id);
    if (!Number.isInteger(id) || id < 1 || id > 21) { invalidIds++; continue; }
    const recorded = Date.parse(row.recorded_at);
    if (!Number.isFinite(recorded)) { invalidTimestamps++; continue; }
    if (recorded < start || recorded >= end) { outOfWindow++; continue; }
    const target = byFreezer[id - 1];
    const interval = id <= 6 ? 60_000 : 900_000;
    const slot = Math.round((recorded - start) / interval);
    if (slot >= target.expected) { boundaryUnmatched++; continue; }
    if (target.slots.has(slot)) target.duplicateRows++;
    else target.slots.add(slot);
    const received = Date.parse(row.received_at);
    if (!Number.isFinite(received)) invalidReceivedTimestamps++;
    else {
      const delay = (received - recorded) / 1000;
      if (delay < 0) negativeUploadDelays++;
      else target.maxUploadDelaySeconds = Math.max(target.maxUploadDelaySeconds ?? 0, delay);
    }
  }
  const summarized = byFreezer.map(({ slots, ...item }) => ({
    ...item,
    observed: slots.size,
    missing: item.expected - slots.size,
    completenessPercent: Number((100 * slots.size / item.expected).toFixed(4)),
  }));
  return {
    date, tier, mode: 'offline_raw_count_audit',
    expectedTotal: 10080,
    observedTotal: summarized.reduce((sum, item) => sum + item.observed, 0),
    invalidTimestamps, invalidReceivedTimestamps, invalidIds, outOfWindow,
    boundaryUnmatched, negativeUploadDelays,
    byFreezer: summarized,
    limitation: 'Counts do not establish sensor accuracy, placement, exclusions, or baseline eligibility.',
  };
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
  const report = auditDay(JSON.parse(input.toString('utf8')), options['--date']);
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
