// Labeled synthetic pilot export (firmware_version SYNTHETIC-FIXTURE) with
// deliberate anomalies for exercising scripts/pilot-report.mjs. These rows are
// not research observations and use no iMonnit, TRAXX or Facilities format.
import { consistentManifest } from '../restore-rehearsal.mjs';

const day1 = Date.UTC(2026, 9, 1);
const day2 = Date.UTC(2026, 9, 2);
const iso = (ms) => new Date(ms).toISOString();

export function syntheticPilotExport() {
  let nextId = 1;
  const row = (freezer, boot, seq, recordedMs, overrides = {}) => {
    const device = `freezer-${String(freezer).padStart(2, '0')}`;
    return { id: nextId++, freezer_id: freezer, device_id: device, firmware_version: 'SYNTHETIC-FIXTURE',
      payload_version: 1, observation_id: `${device}-${boot}-${seq}`, sensor_tier: 'esp32_pt1000_max31865',
      temp_c: -80, rssi: -60, reset_reason: null, recorded_at: iso(recordedMs), clock_valid: true,
      received_at: iso(recordedMs + 3000), ...overrides };
  };
  const rows = [];
  // Freezer 1, boot 5: sequence 6 never arrives; sequence 3 is replayed.
  for (let seq = 1; seq <= 10; seq++) {
    if (seq !== 6) rows.push(row(1, 5, seq, day1 + 30_000 + (seq - 1) * 60_000));
  }
  rows.push({ ...rows[2], id: nextId++, received_at: iso(day1 + 3_600_000) });
  // A valid clock stepped back 45 s: sequence 11 is recorded before 10.
  rows.push(row(1, 5, 11, day1 + 30_000 + 8 * 60_000 + 15_000));
  // Rows the audit must count but not use, in sequence/time order.
  rows.push(row(1, 5, 12, day1 + 11 * 60_000 + 30_000, { clock_valid: false }));
  rows.push(row(1, 5, 13, day1, { recorded_at: '2026-10-01T00:12:30' }));
  rows.push(row(1, 5, 14, day1 + 13 * 60_000 + 30_000, { sensor_tier: 'synthetic-other-tier' }));
  rows.push({ ...row(1, 5, 15, day1 + 14 * 60_000 + 30_000), freezer_id: undefined, prototype_id: 22 });
  // Day 2: NVS erase/replacement simulation restarts the boot counter and
  // later reuses an ID from day 1 with different content.
  for (let seq = 1; seq <= 3; seq++) rows.push(row(1, 1, seq, day2 + 30_000 + (seq - 1) * 60_000));
  rows.push(row(1, 5, 2, day2 + 3_600_000, { temp_c: -70 }));
  // Freezer 7 at 900 s with one 45-minute acquisition gap.
  for (const [seq, minute] of [[1, 5], [2, 20], [3, 35], [4, 80]]) rows.push(row(7, 2, seq, day1 + minute * 60_000));
  // Outside the requested two-day range.
  rows.push(row(1, 5, 16, day2 + 2 * 86_400_000));
  const content = `${rows.map((item) => JSON.stringify(item)).join('\n')}\n`;
  const manifest = consistentManifest(content, { format: 'jsonl', table: 'readings', source_host: 'synthetic.invalid',
    exported_at_utc: '2026-10-18T00:00:00.000Z', recorded_at_gte: null, recorded_at_lt: null, synthetic_fixture: true });
  return { content, manifest, startDate: '2026-10-01', endDate: '2026-10-02' };
}
