// Verified logical import of an export-readings.mjs JSONL snapshot into an
// isolated local PGlite database. There is deliberately no connection-string
// option: this is a restore rehearsal tool, not a production restore path.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTimestamp } from '../web/lib/reading-timestamps.mjs';
import { summarizeRows } from './export-readings.mjs';
import { buildLedgerSchema, loadPglite, tableColumns } from './local-pg-schema.mjs';

const TABLES = {
  readings: { sourceKey: 'freezer_id', otherKey: 'prototype_id' },
  prototype_readings: { sourceKey: 'prototype_id', otherKey: 'freezer_id' },
};

export class ImportRejected extends Error {
  constructor(code, message, detail = {}) {
    super(`${code}: ${message}`);
    this.code = code;
    this.detail = detail;
  }
}

const reject = (code, message, detail) => { throw new ImportRejected(code, message, detail); };

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function expectedDevice(table, row) {
  return table === 'readings'
    ? `freezer-${String(row.freezer_id).padStart(2, '0')}`
    : 'prototype-22';
}

function isId(value) {
  return (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === 'string' && /^[1-9]\d*$/.test(value));
}

// Structural and provenance checks only. Study acceptance, exclusions and
// physical mapping are deliberately out of scope for a restore.
export function validateRow(row, table, window, line) {
  const where = { line };
  const fail = (message) => reject('invalid_row', `line ${line}: ${message}`, where);
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail('not a JSON object');
  if (!isId(row.id)) fail('id must be a positive integer');
  const { sourceKey, otherKey } = TABLES[table];
  if (row[otherKey] !== undefined) fail(`${otherKey} does not belong in ${table}`);
  const source = row[sourceKey];
  if (!Number.isInteger(source) ||
      (table === 'readings' ? source < 1 || source > 21 : source !== 22)) {
    fail(`${sourceKey} is outside the ${table} source range`);
  }
  if (typeof row.sensor_tier !== 'string' || !row.sensor_tier) fail('sensor_tier is required');
  if (typeof row.temp_c !== 'number' || !Number.isFinite(row.temp_c)) fail('temp_c must be a finite number');
  const recorded = parseTimestamp(row.recorded_at);
  if (recorded === null) fail('recorded_at needs a real date and explicit timezone');
  if (parseTimestamp(row.received_at) === null) fail('received_at needs a real date and explicit timezone');
  for (const key of ['rssi', 'payload_version']) {
    if (row[key] !== null && row[key] !== undefined && !Number.isInteger(row[key])) fail(`${key} must be an integer`);
  }
  for (const key of ['reset_reason', 'firmware_version']) {
    if (row[key] !== null && row[key] !== undefined && typeof row[key] !== 'string') fail(`${key} must be text`);
  }
  if (row.clock_valid !== null && row.clock_valid !== undefined && typeof row.clock_valid !== 'boolean') {
    fail('clock_valid must be boolean');
  }
  if (window.start !== null && recorded < window.start) reject('outside_window', `line ${line}: recorded_at precedes the export window`, where);
  if (window.end !== null && recorded >= window.end) reject('outside_window', `line ${line}: recorded_at is not before the export window end`, where);

  // Legacy rows predate identity: both fields NULL. Every newer row carries
  // its logical device and an observation ID derived from that device.
  const device = row.device_id ?? null;
  const observation = row.observation_id ?? null;
  if ((device === null) !== (observation === null)) {
    reject('invalid_mapping', `line ${line}: device_id and observation_id must both be present or both be legacy NULL`, where);
  }
  if (device !== null) {
    if (device !== expectedDevice(table, row)) {
      reject('invalid_mapping', `line ${line}: ${device} does not match ${sourceKey}=${source}`, where);
    }
    const escaped = device.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (typeof observation !== 'string' || !new RegExp(`^${escaped}-[0-9]+-[0-9]+$`).test(observation)) {
      reject('invalid_mapping', `line ${line}: observation_id does not belong to ${device}`, where);
    }
  }
}

// Verifies the exact bytes against the export manifest before any database
// work. Returns parsed rows plus their original JSON lines (exact digits).
export function verifyExport(content, manifest, table) {
  if (!TABLES[table]) reject('table_mismatch', `unsupported table ${table}`);
  if (!manifest || typeof manifest !== 'object') reject('manifest_missing', 'a matching export manifest is required');
  if (manifest.format !== 'jsonl') reject('manifest_invalid', 'manifest format must be jsonl');
  if (manifest.table !== table) reject('table_mismatch', `manifest table ${manifest.table} is not ${table}`);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  if (sha256(bytes) !== manifest.sha256) reject('sha256_mismatch', 'export bytes do not match the manifest SHA-256');
  const text = bytes.toString('utf8');
  if (text && !text.endsWith('\n')) reject('truncated', 'export does not end with a complete JSONL record');
  const lines = text ? text.slice(0, -1).split('\n') : [];
  const rows = lines.map((line, index) => {
    try { return JSON.parse(line); }
    catch { return reject('invalid_json', `line ${index + 1} is not valid JSON`, { line: index + 1 }); }
  });
  if (rows.length !== manifest.row_count) {
    reject('row_count_mismatch', `manifest lists ${manifest.row_count} rows; file has ${rows.length}`);
  }
  const bounds = summarizeRows(rows);
  for (const field of ['recorded_at', 'received_at']) {
    if (JSON.stringify(bounds[field]) !== JSON.stringify(manifest[field] ?? null)) {
      reject('bounds_mismatch', `${field} bounds differ from the manifest`);
    }
  }
  const window = {
    start: manifest.recorded_at_gte ? parseTimestamp(manifest.recorded_at_gte) : null,
    end: manifest.recorded_at_lt ? parseTimestamp(manifest.recorded_at_lt) : null,
  };
  if ((manifest.recorded_at_gte && window.start === null) || (manifest.recorded_at_lt && window.end === null)) {
    reject('manifest_invalid', 'manifest window bounds are not valid timestamps');
  }
  const ids = new Set();
  const observations = new Set();
  rows.forEach((row, index) => {
    validateRow(row, table, window, index + 1);
    const id = String(row.id);
    if (ids.has(id)) reject('duplicate_id', `line ${index + 1} repeats id ${id}`, { line: index + 1 });
    ids.add(id);
    if (row.device_id != null) {
      const key = `${row.device_id}\0${row.observation_id}`;
      if (observations.has(key)) reject('duplicate_observation', `line ${index + 1} repeats ${row.observation_id}`, { line: index + 1 });
      observations.add(key);
    }
  });
  return { rows, lines };
}

function quoteColumn(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected column name ${name}`);
  return `"${name}"`;
}

// Timezone- and scale-independent text projection used for every comparison.
export function canonicalExpressions(columns, alias = 'r') {
  return [...columns].sort((a, b) => a.column_name.localeCompare(b.column_name)).map(({ column_name: name, data_type: type }) => {
    const ref = `${alias}.${quoteColumn(name)}`;
    if (type === 'timestamp with time zone') {
      return `to_char(${ref} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ${quoteColumn(name)}`;
    }
    if (type === 'numeric') return `trim_scale(${ref})::text as ${quoteColumn(name)}`;
    return `${ref}::text as ${quoteColumn(name)}`;
  }).join(', ');
}

// Canonical content of one local table: rows, hash, bounds and source mapping.
export async function snapshotTable(db, table) {
  if (!TABLES[table]) throw new Error(`Unsupported table ${table}`);
  const columns = await tableColumns(db, table);
  const rows = (await db.query(`select ${canonicalExpressions(columns)} from public.${table} r order by r.id`)).rows;
  const { sourceKey } = TABLES[table];
  const mapping = (await db.query(`select ${sourceKey}::text as source, coalesce(device_id, '<legacy-null>') as device_id,
      sensor_tier, count(*)::int as rows from public.${table} group by 1, 2, 3 order by 1, 2, 3`)).rows;
  const bounds = (await db.query(`select
      to_char(min(recorded_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as recorded_first,
      to_char(max(recorded_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as recorded_last,
      to_char(min(received_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as received_first,
      to_char(max(received_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as received_last
    from public.${table}`)).rows[0];
  return {
    table,
    row_count: rows.length,
    canonical_sha256: sha256(rows.map((row) => JSON.stringify(row)).join('\n')),
    bounds,
    mapping,
    rows,
  };
}

// Imports verified rows in one transaction. Identical replays are counted and
// skipped; any row that collides with different content (by id or by device
// observation identity) rejects the whole import and leaves the target as-is.
export async function importVerified(db, table, verified) {
  const columns = await tableColumns(db, table);
  const target = new Set(columns.map((column) => column.column_name));
  for (const [index, row] of verified.rows.entries()) {
    const keys = Object.keys(row);
    const extra = keys.filter((key) => !target.has(key));
    const missing = [...target].filter((key) => !keys.includes(key));
    if (extra.length || missing.length) {
      reject('schema_mismatch', `line ${index + 1} columns do not match the target ${table} table`, { extra, missing });
    }
  }
  if (verified.rows.length === 0) return { received: 0, inserted: 0, replays: 0 };

  const names = columns.map((column) => quoteColumn(column.column_name)).join(', ');
  const payload = `[${verified.lines.join(',')}]`;
  try {
    return await db.transaction(async (tx) => {
      const inserted = new Set((await tx.query(`insert into public.${table} (${names}) overriding system value
          select ${names} from json_populate_recordset(null::public.${table}, $1::json)
          on conflict do nothing returning id::text as id`, [payload])).rows.map((row) => row.id));
      const skipped = verified.rows.map((row) => String(row.id)).filter((id) => !inserted.has(id));
      if (skipped.length) {
        const incoming = new Map((await tx.query(`select ${canonicalExpressions(columns)}
            from json_populate_recordset(null::public.${table}, $1::json) r`, [payload])).rows.map((row) => [row.id, row]));
        const existing = new Map((await tx.query(`select ${canonicalExpressions(columns)}
            from public.${table} r where r.id = any($1::bigint[])`, [skipped])).rows.map((row) => [row.id, row]));
        const conflicts = skipped.filter((id) => JSON.stringify(existing.get(id) ?? null) !== JSON.stringify(incoming.get(id)));
        if (conflicts.length) {
          reject('conflict', `${conflicts.length} row(s) collide with different stored content`, { ids: conflicts.slice(0, 10) });
        }
      }
      // Keep later identity-generated inserts above every restored id.
      await tx.query(`select setval(pg_get_serial_sequence('public.${table}', 'id'),
          greatest((select max(id) from public.${table}), 1))`);
      return { received: verified.rows.length, inserted: inserted.size, replays: skipped.length };
    });
  } catch (error) {
    if (error instanceof ImportRejected) throw error;
    return reject('database_rejected', error.message, { sqlstate: error.code ?? null });
  }
}

export async function importExport(db, table, content, manifest) {
  return importVerified(db, table, verifyExport(content, manifest, table));
}

function usage() {
  return 'Usage: node scripts/import-readings.mjs --pglite-module PATH --data-dir DIR --table readings|prototype_readings --input FILE [--manifest FILE]';
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--pglite-module', '--data-dir', '--table', '--input', '--manifest'].includes(flag) ||
        !args[index + 1] || args[index + 1].startsWith('--') || options[flag]) throw new Error(usage());
    options[flag] = args[index + 1];
  }
  if (!options['--data-dir'] || !options['--table'] || !options['--input']) throw new Error(usage());
  const dataDir = path.resolve(options['--data-dir']);
  if (/[\\/]OneDrive[^\\/]*[\\/]/i.test(`${dataDir}${path.sep}`)) {
    throw new Error('Local restore databases must stay outside OneDrive.');
  }
  const content = await readFile(options['--input']);
  const manifest = JSON.parse(await readFile(options['--manifest'] ?? `${options['--input']}.manifest.json`, 'utf8'));
  const verified = verifyExport(content, manifest, options['--table']);
  const PGlite = await loadPglite(options['--pglite-module'] ?? process.env.FREEZER_PGLITE_MODULE);
  const db = new PGlite(dataDir);
  try {
    const exists = (await db.query(`select to_regclass('public.${options['--table']}') is not null as present`)).rows[0].present;
    if (!exists) await buildLedgerSchema(db);
    const result = await importVerified(db, options['--table'], verified);
    const snapshot = await snapshotTable(db, options['--table']);
    delete snapshot.rows;
    process.stdout.write(`${JSON.stringify({ ...result, target: snapshot,
      limitation: 'Local PGlite rehearsal target only; not a production restore or backup verification.' }, null, 2)}\n`);
  } finally {
    await db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
