import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedHost = 'dfxxamgnrimwoumknuxa.supabase.co';
const siteUrl = 'https://ult-freezres.vercel.app';

export function parseSerial(log) {
  const posted = [];
  let pending = null;
  let sensorFound = false;
  let sensorMissing = false;
  let diagnosticRuns = 0;
  for (const line of log.split(/\r?\n/)) {
    if (line.includes('[sensor] DS18B20 found')) sensorFound = true;
    if (line.includes('[sensor] no DS18B20')) sensorMissing = true;
    if (line.includes('[1wire-diag] VERDICT:')) diagnosticRuns++;
    const reading = line.match(/\[reading\] (\{.*\})/);
    if (reading) {
      try { pending = JSON.parse(reading[1]); } catch { pending = null; }
    } else if (line.includes('[reading] posted')) {
      if (pending) posted.push(pending);
      pending = null;
    } else if (line.includes('[queue] buffered') || line.includes('[http] POST failed')) {
      pending = null;
    }
  }
  return { sensorFound, sensorMissing, diagnosticRuns, posted };
}

export function evaluateObservation(serial, rows) {
  const reading = serial.posted.at(-1);
  if (!reading) return { state: 'no_posted_serial_reading' };
  if (reading.prototype_id !== 22 || reading.sensor_tier !== 'esp32_ds18b20' ||
      !Number.isFinite(Date.parse(reading.recorded_at))) {
    return { state: 'posted_serial_reading_lacks_match_fields' };
  }
  const row = rows.find((candidate) =>
    candidate.prototype_id === 22 && candidate.sensor_tier === 'esp32_ds18b20' &&
    Date.parse(candidate.recorded_at) === Date.parse(reading.recorded_at) &&
    Math.abs(Number(candidate.temp_c) - Number(reading.temp_c)) < 0.0001);
  return row
    ? { state: 'matched', rowId: row.id, recordedAt: row.recorded_at, tempC: Number(row.temp_c) }
    : { state: 'posted_not_found_in_rows', recordedAt: reading.recorded_at };
}

function envValue(text, name) {
  const line = text.split(/\r?\n/).find((part) => part.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '');
}

async function check() {
  const args = process.argv.slice(2);
  const validFlags = new Set(['--serial-log', '--report']);
  const supplied = new Set();
  const validArgs = args.length % 2 === 0 && args.every((arg, index) => {
    if (index % 2 === 1) return Boolean(arg) && !arg.startsWith('--');
    if (!validFlags.has(arg) || supplied.has(arg)) return false;
    supplied.add(arg);
    return true;
  });
  if (!validArgs) {
    throw new Error('Usage: node scripts/prototype-check.mjs [--serial-log PATH] [--report PATH]');
  }
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const envText = await readFile(path.join(projectRoot, 'web/.env.local'), 'utf8');
  const baseUrl = envValue(envText, 'NEXT_PUBLIC_SUPABASE_URL');
  const key = envValue(envText, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ||
    envValue(envText, 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!baseUrl || !key || new URL(baseUrl).host !== expectedHost) {
    throw new Error('Local dashboard config is missing or points to the wrong Supabase project');
  }
  const serialPath = option('--serial-log');
  const serial = serialPath ? parseSerial(await readFile(serialPath, 'utf8')) : null;
  const latestPosted = serial?.posted.at(-1);
  const query = new URL('/rest/v1/prototype_readings', baseUrl);
  query.searchParams.set('select', 'id,prototype_id,sensor_tier,temp_c,recorded_at,received_at');
  query.searchParams.set('prototype_id', 'eq.22');
  query.searchParams.set('sensor_tier', 'eq.esp32_ds18b20');
  if (latestPosted?.recorded_at) {
    query.searchParams.set('recorded_at', `eq.${latestPosted.recorded_at}`);
  } else {
    query.searchParams.set('order', 'recorded_at.desc');
    query.searchParams.set('limit', '1');
  }
  const api = await fetch(query, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!api.ok) throw new Error(`Prototype API returned HTTP ${api.status}`);
  const rows = await api.json();
  if (!Array.isArray(rows)) throw new Error('Prototype API did not return an array');
  const [home, detail] = await Promise.all([
    fetch(siteUrl), fetch(`${siteUrl}/prototype/22`),
  ]);
  const homeText = home.ok ? await home.text() : '';
  const detailText = detail.ok ? await detail.text() : '';
  const report = {
    checkedAtUtc: new Date().toISOString(),
    projectHost: expectedHost,
    mode: 'read_only',
    api: 'reachable',
    site: {
      home: home.ok && homeText.includes('Prototype 22') ? 'reachable' : `HTTP ${home.status} or missing label`,
      detail: detail.ok && detailText.includes('Prototype 22') ? 'reachable' : `HTTP ${detail.status} or missing label`,
      note: 'HTTP checks verify routes only; compare client-rendered temperature in a browser after a real reading.',
    },
    serial: serial && { sensorFound: serial.sensorFound, sensorMissing: serial.sensorMissing,
      diagnosticRuns: serial.diagnosticRuns, postedReadings: serial.posted.length },
    observation: serial ? evaluateObservation(serial, rows) : {
      state: rows.length ? 'row_present_without_serial_provenance' : 'no_readings_yet',
    },
  };
  const reportPath = option('--report');
  if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.site.home !== 'reachable' || report.site.detail !== 'reachable') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  check().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
