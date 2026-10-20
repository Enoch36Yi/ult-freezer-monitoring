// Synthetic logical export/import recovery rehearsal in isolated in-process
// PGlite databases. Every observation is a labeled fixture. This is not a
// production backup, PITR restore, or evidence of Supabase grants/RPCs/RLS.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditDay, parseReadings } from './audit-readings.mjs';
import { exportReadings, summarizeRows } from './export-readings.mjs';
import { ImportRejected, importExport, sha256, snapshotTable, verifyExport } from './import-readings.mjs';
import { LEDGER_MIGRATIONS, LEGACY_BASE, buildFreshSchema, buildLedgerSchema, loadPglite, tableColumns } from './local-pg-schema.mjs';

export const FIXTURE_LABEL = 'SYNTHETIC-FIXTURE';
const TABLES = ['readings', 'prototype_readings'];
const WINDOW = { start: '2026-10-01T00:00:00Z', end: '2026-10-01T00:30:00Z' };
const CONFIG = { baseUrl: 'https://synthetic-restore-rehearsal.invalid', key: 'synthetic-fixture-public-key' };

const at = (ms) => new Date(ms).toISOString().replace('.000Z', '.123456Z');

// Conspicuous synthetic rows: firmware/reset labels, a fixed synthetic day,
// fleet IDs 1/7/21 at their 60 s and 900 s cadences, and Prototype 22 apart.
export function syntheticFixtures() {
  const day = Date.UTC(2026, 9, 1);
  const legacy = {
    readings: [0, 1, 2].map((i) => ({
      freezer_id: 1, sensor_tier: 'esp32_ds18b20', temp_c: ['21.5', '21.4375', '21.375'][i], rssi: -55,
      reset_reason: 'SYNTHETIC_FIXTURE', recorded_at: at(Date.UTC(2026, 8, 19, 20, i)),
      received_at: at(Date.UTC(2026, 8, 19, 20, i, 2)),
    })),
    prototype_readings: [{
      prototype_id: 22, sensor_tier: 'esp32_ds18b20', temp_c: '22.0625', rssi: -50,
      reset_reason: 'SYNTHETIC_FIXTURE', recorded_at: at(Date.UTC(2026, 8, 19, 21)),
      received_at: at(Date.UTC(2026, 8, 19, 21, 0, 2)),
    }],
  };
  const sample = (freezer, boot, index, recorded, received, temp) => ({
    freezer_id: freezer, device_id: `freezer-${String(freezer).padStart(2, '0')}`,
    firmware_version: FIXTURE_LABEL, payload_version: 1,
    observation_id: `freezer-${String(freezer).padStart(2, '0')}-${boot}-${index + 1}`,
    sensor_tier: 'esp32_pt1000_max31865', temp_c: temp, rssi: -60 - (index % 3),
    reset_reason: index === 0 ? 'poweron' : null, recorded_at: at(recorded), clock_valid: true,
    received_at: at(received),
  });
  const readings = [];
  for (let i = 0; i < 30; i++) {
    const recorded = day + 2000 + i * 60000;
    // Readings 11-20 were buffered and delivered together later.
    const received = i >= 10 && i < 20 ? day + 45 * 60000 + i * 1000 : recorded + 3000;
    readings.push(sample(1, 7, i, recorded, received, (-80 + (i % 5) * 0.025).toFixed(3)));
  }
  for (let i = 0; i < 8; i++) {
    readings.push(sample(7, 2, i, day + 5 * 60000 + i * 900000, day + 5 * 60000 + i * 900000 + 4000, '-78.500'));
  }
  for (let i = 0; i < 4; i++) {
    readings.push(sample(21, 1, i, day + 10 * 60000 + i * 900000, day + 10 * 60000 + i * 900000 + 5000, '-81.250'));
  }
  const prototype = [0, 1, 2, 3, 4].map((i) => ({
    prototype_id: 22, device_id: 'prototype-22', firmware_version: FIXTURE_LABEL, payload_version: 1,
    observation_id: `prototype-22-3-${i + 1}`, sensor_tier: 'esp32_pt1000_max31865',
    temp_c: (21.25 + i * 0.125).toFixed(3), rssi: -48, reset_reason: i === 0 ? 'poweron' : null,
    recorded_at: at(day + 30000 + i * 60000), clock_valid: true, received_at: at(day + 33000 + i * 60000),
  }));
  return { legacy, current: { readings, prototype_readings: prototype } };
}

async function insertRows(db, table, rows) {
  if (!rows.length) return;
  const names = Object.keys(rows[0]).map((name) => `"${name}"`).join(', ');
  await db.query(`insert into public.${table} (${names})
    select ${names} from json_populate_recordset(null::public.${table}, $1::json)`, [JSON.stringify(rows)]);
}

// Serves the subset of PostgREST that export-readings.mjs uses, straight from
// PGlite JSON output, including a server-side row cap that forces short pages.
export function postgrestAdapter(db, { maxRows = 7 } = {}) {
  return async (input, init = {}) => {
    const url = new URL(input);
    const table = /^\/rest\/v1\/(readings|prototype_readings)$/.exec(url.pathname)?.[1];
    if (!table) return new Response('not found', { status: 404 });
    if (!init.headers?.apikey) return new Response('missing apikey', { status: 401 });
    const params = url.searchParams;
    if (params.get('select') !== '*' || params.get('order') !== 'id.asc') return new Response('unsupported', { status: 400 });
    const values = [];
    const where = params.getAll('recorded_at').map((filter) => {
      const match = /^(gte|lt)\.(.+)$/.exec(filter);
      if (!match) throw new Error(`Unsupported filter ${filter}`);
      values.push(match[2]);
      return `recorded_at ${match[1] === 'gte' ? '>=' : '<'} $${values.length}::timestamptz`;
    });
    values.push(Math.min(Number(params.get('limit')), maxRows), Number(params.get('offset')));
    const body = (await db.query(`select coalesce(json_agg(t order by t.id), '[]'::json)::text as body
      from (select * from public.${table} ${where.length ? `where ${where.join(' and ')}` : ''}
            order by id asc limit $${values.length - 1} offset $${values.length}) t`, values)).rows[0].body;
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

// Rebuilds a manifest that is internally consistent with altered bytes, so a
// test proves the row-level checks, not just the SHA-256 comparison.
export function consistentManifest(content, base) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;
  let rows = [];
  try { rows = parseReadings(text); } catch { rows = []; }
  return { ...base, sha256: sha256(Buffer.from(text, 'utf8')), row_count: text ? text.replace(/\n$/, '').split('\n').length : 0,
    ...summarizeRows(rows) };
}

async function engineVersion(db, modulePath) {
  let pglite = null;
  try {
    pglite = JSON.parse(await readFile(path.resolve(path.dirname(modulePath), '..', 'package.json'), 'utf8')).version;
  } catch { /* version stays unknown rather than guessed */ }
  return { pglite, postgres: (await db.query('select version() as v')).rows[0].v };
}

function schemaDifferences(ledger, fresh) {
  const differences = [];
  for (const table of TABLES) {
    const left = new Map(ledger[table].map((column) => [column.column_name, column]));
    const right = new Map(fresh[table].map((column) => [column.column_name, column]));
    for (const name of new Set([...left.keys(), ...right.keys()])) {
      const a = left.get(name);
      const b = right.get(name);
      if (!a || !b) { differences.push({ table, column: name, ledger: a ? 'present' : 'absent', fresh: b ? 'present' : 'absent' }); continue; }
      for (const field of ['data_type', 'is_nullable', 'column_default']) {
        if ((a[field] ?? null) !== (b[field] ?? null)) {
          differences.push({ table, column: name, field, ledger: a[field] ?? null, fresh: b[field] ?? null });
        }
      }
    }
  }
  return differences;
}

export async function runRestoreRehearsal({ pgliteModule }) {
  const PGlite = await loadPglite(pgliteModule);
  const checks = [];
  const findings = [];
  const databases = [];
  const open = async (build, timezone, hook) => {
    const db = new PGlite();
    databases.push(db);
    await db.exec(`set time zone '${timezone}'`);
    await build(db, hook);
    return db;
  };
  const check = async (name, fn) => {
    try {
      const detail = await fn();
      checks.push({ name, passed: true, ...(detail === undefined ? {} : { detail }) });
    } catch (error) {
      checks.push({ name, passed: false, error: error.message });
    }
  };
  const expectRejected = async (code, fn) => {
    try {
      await fn();
    } catch (error) {
      if (error instanceof ImportRejected && error.code === code) return { rejected: code, message: error.message };
      throw new Error(`expected ${code}, got ${error.code ?? error.message}`);
    }
    throw new Error(`expected ${code}, but the input was accepted`);
  };

  try {
    const fixtures = syntheticFixtures();
    // Source mirrors Supabase: UTC session and the recorded migration ledger.
    const source = await open(buildLedgerSchema, 'UTC', { beforeMigrations: async (db) => {
      for (const table of TABLES) await insertRows(db, table, fixtures.legacy[table]);
    } });
    for (const table of TABLES) await insertRows(source, table, fixtures.current[table]);
    const engine = await engineVersion(source, pgliteModule);
    const fetchImpl = postgrestAdapter(source, { maxRows: 7 });

    const exports = {};
    for (const table of TABLES) {
      exports[table] = await exportReadings({ table, output: 'unused', start: null, end: null }, CONFIG, fetchImpl);
    }
    const bounded = await exportReadings({ table: 'readings', output: 'unused', ...WINDOW }, CONFIG, fetchImpl);
    const sourceSnapshots = {};
    for (const table of TABLES) sourceSnapshots[table] = await snapshotTable(source, table);

    await check('existing exporter paginates through server-capped pages', () => {
      for (const table of TABLES) {
        const rows = sourceSnapshots[table].row_count;
        assert.equal(exports[table].manifest.row_count, rows);
        // Each capped page is short of the requested 1000; only an empty page ends.
        assert.equal(exports[table].manifest.pagination.pages, Math.ceil(rows / 7) + 1);
      }
      return Object.fromEntries(TABLES.map((table) => [table, exports[table].manifest.pagination]));
    });
    await check('bounded export matches an independent half-open UTC count', async () => {
      const expected = (await source.query(`select count(*)::int as n from public.readings
        where recorded_at >= $1 and recorded_at < $2`, [WINDOW.start, WINDOW.end])).rows[0].n;
      assert.equal(bounded.manifest.row_count, expected);
      assert.equal(expected, 34);
      for (const row of parseReadings(bounded.content)) {
        assert.ok(Date.parse(row.recorded_at) >= Date.parse(WINDOW.start) && Date.parse(row.recorded_at) < Date.parse(WINDOW.end));
      }
      return { window: WINDOW, rows: expected };
    });

    // Target 1: same recorded ledger, empty, deliberately non-UTC session.
    const restored = await open(buildLedgerSchema, 'America/Los_Angeles');
    const imports = {};
    await check('full logical import restores every row', async () => {
      for (const table of TABLES) {
        imports[table] = await importExport(restored, table, exports[table].content, exports[table].manifest);
        assert.equal(imports[table].inserted, sourceSnapshots[table].row_count);
        assert.equal(imports[table].replays, 0);
      }
      return imports;
    });
    const restoredSnapshots = {};
    for (const table of TABLES) restoredSnapshots[table] = await snapshotTable(restored, table);
    await check('counts, UTC bounds and source/device mapping match the source', () => {
      for (const table of TABLES) {
        assert.equal(restoredSnapshots[table].row_count, sourceSnapshots[table].row_count);
        assert.deepEqual(restoredSnapshots[table].bounds, sourceSnapshots[table].bounds);
        assert.deepEqual(restoredSnapshots[table].mapping, sourceSnapshots[table].mapping);
      }
      return Object.fromEntries(TABLES.map((table) => [table, {
        rows: restoredSnapshots[table].row_count, bounds: restoredSnapshots[table].bounds, mapping: restoredSnapshots[table].mapping }]));
    });
    await check('normalized rows are equivalent (timezone- and numeric-scale-independent)', () => {
      for (const table of TABLES) {
        assert.equal(restoredSnapshots[table].canonical_sha256, sourceSnapshots[table].canonical_sha256);
      }
      return Object.fromEntries(TABLES.map((table) => [table, restoredSnapshots[table].canonical_sha256]));
    });
    await check('restored identity sequences stay above restored ids', async () => {
      for (const table of TABLES) {
        const result = (await restored.query(`select (select last_value from pg_sequences
            where schemaname = 'public' and sequencename = split_part(pg_get_serial_sequence('public.${table}', 'id'), '.', 2)) >=
            (select max(id) from public.${table}) as ok`)).rows[0].ok;
        assert.equal(result, true);
      }
    });
    await check('existing audit gives an identical report from a re-export of the restored target', async () => {
      const reexport = await exportReadings({ table: 'readings', output: 'unused', start: null, end: null }, CONFIG,
        postgrestAdapter(restored, { maxRows: 11 }));
      const before = auditDay(parseReadings(exports.readings.content), '2026-10-01');
      const after = auditDay(parseReadings(reexport.content), '2026-10-01');
      assert.deepEqual(after, before);
      // Bytes differ because the restored session renders local offsets.
      return { sourceExportSha256: exports.readings.manifest.sha256, reexportSha256: reexport.manifest.sha256,
        byteIdentical: reexport.manifest.sha256 === exports.readings.manifest.sha256, observedTotal: after.observedTotal };
    });
    await check('re-importing the same export is an identical replay with no new rows', async () => {
      for (const table of TABLES) {
        const replay = await importExport(restored, table, exports[table].content, exports[table].manifest);
        assert.deepEqual(replay, { received: sourceSnapshots[table].row_count, inserted: 0, replays: sourceSnapshots[table].row_count });
        assert.equal((await snapshotTable(restored, table)).canonical_sha256, sourceSnapshots[table].canonical_sha256);
      }
    });
    await check('overlapping exports insert only the missing rows', async () => {
      const partial = await open(buildLedgerSchema, 'UTC');
      const first = await importExport(partial, 'readings', bounded.content, bounded.manifest);
      const second = await importExport(partial, 'readings', exports.readings.content, exports.readings.manifest);
      assert.equal(first.inserted, 34);
      assert.equal(second.inserted, sourceSnapshots.readings.row_count - 34);
      assert.equal(second.replays, 34);
      assert.equal((await snapshotTable(partial, 'readings')).canonical_sha256, sourceSnapshots.readings.canonical_sha256);
      return { first, second };
    });

    const lines = exports.readings.content.replace(/\n$/, '').split('\n');
    const withLines = (edit) => `${edit([...lines]).join('\n')}\n`;
    const pt1000Index = lines.findIndex((line) => JSON.parse(line).observation_id === 'freezer-01-7-5');
    const unchanged = async () => assert.equal((await snapshotTable(restored, 'readings')).canonical_sha256,
      sourceSnapshots.readings.canonical_sha256);
    await check('a same-id row with different content rejects the whole import', async () => {
      const content = withLines((copy) => {
        const row = JSON.parse(copy[pt1000Index]);
        copy[pt1000Index] = JSON.stringify({ ...row, temp_c: row.temp_c + 1 });
        return copy;
      });
      const result = await expectRejected('conflict', () =>
        importExport(restored, 'readings', content, consistentManifest(content, exports.readings.manifest)));
      await unchanged();
      return result;
    });
    await check('a reused device observation ID under a new row id is a conflict, not a replay', async () => {
      // The NVS-erase / replacement-MCU identity risk at database level: the
      // ingest route would silently ignore this row as a duplicate.
      const row = JSON.parse(lines[pt1000Index]);
      const content = `${JSON.stringify({ ...row, id: 9001, temp_c: -70, recorded_at: '2026-10-01T03:00:02.123456+00:00',
        received_at: '2026-10-01T03:00:05.123456+00:00' })}\n`;
      const result = await expectRejected('conflict', () =>
        importExport(restored, 'readings', content, consistentManifest(content, exports.readings.manifest)));
      await unchanged();
      return result;
    });

    const corrupt = [
      ['truncated mid-record with the original manifest', 'sha256_mismatch',
        () => [exports.readings.content.slice(0, -17), exports.readings.manifest]],
      ['truncated at a record boundary with only the hash refreshed', 'row_count_mismatch', () => {
        const content = withLines((copy) => copy.slice(0, -2));
        return [content, { ...exports.readings.manifest, sha256: sha256(Buffer.from(content)) }];
      }],
      ['truncated mid-record with a refreshed manifest', 'truncated', () => {
        const content = exports.readings.content.slice(0, -17);
        return [content, consistentManifest(content, exports.readings.manifest)];
      }],
      ['one flipped byte', 'sha256_mismatch', () => [exports.readings.content.replace('"temp_c":-80', '"temp_c":-81'),
        exports.readings.manifest]],
      ['invalid JSON with a refreshed manifest', 'invalid_json', () => {
        const content = withLines((copy) => { copy[3] = copy[3].slice(0, -1); return copy; });
        return [content, consistentManifest(content, exports.readings.manifest)];
      }],
      ['local timestamp without timezone', 'invalid_row', () => {
        const content = withLines((copy) => {
          copy[pt1000Index] = JSON.stringify({ ...JSON.parse(copy[pt1000Index]), recorded_at: '2026-10-01T00:04:02' });
          return copy;
        });
        return [content, consistentManifest(content, exports.readings.manifest)];
      }],
      ['row outside the manifest window', 'outside_window', () => {
        const extra = JSON.parse(lines[pt1000Index]);
        const content = `${bounded.content}${JSON.stringify({ ...extra, id: 9002, observation_id: 'freezer-01-7-999',
          recorded_at: '2026-10-01T01:00:02.123456+00:00' })}\n`;
        return [content, consistentManifest(content, bounded.manifest)];
      }],
      ['duplicate id inside the export', 'duplicate_id', () => {
        const content = withLines((copy) => [...copy, copy[pt1000Index]]);
        return [content, consistentManifest(content, exports.readings.manifest)];
      }],
      ['device ID that does not match freezer_id', 'invalid_mapping', () => {
        const content = withLines((copy) => {
          copy[pt1000Index] = JSON.stringify({ ...JSON.parse(copy[pt1000Index]), freezer_id: 2 });
          return copy;
        });
        return [content, consistentManifest(content, exports.readings.manifest)];
      }],
      ['unexpected extra column', 'schema_mismatch', () => {
        const content = withLines((copy) => {
          copy[pt1000Index] = JSON.stringify({ ...JSON.parse(copy[pt1000Index]), synthetic_extra: 1 });
          return copy;
        });
        return [content, consistentManifest(content, exports.readings.manifest)];
      }],
      ['missing manifest', 'manifest_missing', () => [exports.readings.content, null]],
    ];
    for (const [name, code, build] of corrupt) {
      await check(`rejects ${name} (${code}) and leaves the target unchanged`, async () => {
        const [content, manifest] = build();
        const result = await expectRejected(code, () => importExport(restored, 'readings', content, manifest));
        await unchanged();
        return result;
      });
    }
    await check('rejects a fleet export imported as Prototype 22 data', async () => expectRejected('table_mismatch', () =>
      importExport(restored, 'prototype_readings', exports.readings.content, exports.readings.manifest)));

    // Target 3: the documented fresh-project path (schema.sql + prototype22.sql).
    const fresh = await open(buildFreshSchema, 'UTC');
    await check('fresh-project schema rejects legacy NULL-identity history atomically', async () => {
      const result = await expectRejected('database_rejected', () =>
        importExport(fresh, 'readings', exports.readings.content, exports.readings.manifest));
      assert.equal((await snapshotTable(fresh, 'readings')).row_count, 0);
      findings.push('A logical restore of migrated history needs a ledger-path target: the fresh schema.sql path declares device_id, observation_id and clock_valid NOT NULL, so legacy rows are rejected (the whole import rolls back).');
      return result;
    });
    await check('fresh-project schema accepts identity-bearing PT1000 rows equivalently', async () => {
      const result = await importExport(fresh, 'readings', bounded.content, bounded.manifest);
      assert.equal(result.inserted, 34);
      const freshRows = (await snapshotTable(fresh, 'readings')).rows;
      const sourceRows = sourceSnapshots.readings.rows.filter((row) =>
        row.recorded_at >= '2026-10-01T00:00:00.000000Z' && row.recorded_at < '2026-10-01T00:30:00.000000Z');
      assert.deepEqual(freshRows, sourceRows);
      return result;
    });
    const ledgerColumns = {};
    const freshColumns = {};
    for (const table of TABLES) {
      ledgerColumns[table] = await tableColumns(restored, table);
      freshColumns[table] = await tableColumns(fresh, table);
    }
    const differences = schemaDifferences(ledgerColumns, freshColumns);
    if (differences.length) {
      findings.push(`Schema drift between the recorded migration ledger and the fresh schema.sql path: ${differences.length} column attribute difference(s); see schemaDifferences. No production schema was changed.`);
    }

    return {
      reportVersion: 1,
      kind: 'synthetic_local_restore_rehearsal',
      generatedAtUtc: new Date().toISOString(),
      passed: checks.every((item) => item.passed),
      disclaimer: 'Labeled synthetic fixtures restored between isolated in-process PGlite databases. Not a production backup, PITR restore or Supabase restore, and not evidence of production grants, RLS, RPCs, retention or migration history.',
      engine,
      schemaPaths: {
        source: { base: LEGACY_BASE, migrations: LEDGER_MIGRATIONS, session_timezone: 'UTC' },
        restoredTarget: { base: LEGACY_BASE.commit, migrations: LEDGER_MIGRATIONS, session_timezone: 'America/Los_Angeles' },
        freshTarget: ['supabase/schema.sql', 'supabase/prototype22.sql'],
      },
      fixtures: { label: FIXTURE_LABEL,
        readings: sourceSnapshots.readings.row_count, prototype_readings: sourceSnapshots.prototype_readings.row_count },
      exports: Object.fromEntries([...TABLES.map((table) => [table, {
        sha256: exports[table].manifest.sha256, rows: exports[table].manifest.row_count,
        pages: exports[table].manifest.pagination.pages }]), ['readings_bounded', {
        sha256: bounded.manifest.sha256, rows: bounded.manifest.row_count, window: WINDOW }]]),
      checks,
      findings,
      schemaDifferences: differences,
      artifacts: { exports, bounded },
    };
  } finally {
    for (const db of databases) await db.close();
  }
}

export function rehearsalMarkdown(report) {
  const lines = [
    '# Synthetic restore rehearsal', '',
    `Generated ${report.generatedAtUtc}. Overall: **${report.passed ? 'PASSED' : 'FAILED'}** (${report.checks.filter((c) => c.passed).length}/${report.checks.length} checks).`, '',
    `> ${report.disclaimer}`, '',
    `Engine: PGlite ${report.engine.pglite ?? 'unknown'}; ${report.engine.postgres.split(',')[0]}.`,
    `Fixtures (${report.fixtures.label}): ${report.fixtures.readings} fleet rows, ${report.fixtures.prototype_readings} Prototype 22 rows.`, '',
    '| Check | Result |', '| --- | --- |',
    ...report.checks.map((item) => `| ${item.name} | ${item.passed ? 'passed' : `FAILED: ${item.error}`} |`), '',
    '## Findings', '', ...(report.findings.length ? report.findings.map((item) => `- ${item}`) : ['- None.']), '',
    '## Schema differences (ledger vs fresh)', '',
    '| Table | Column | Attribute | Ledger | Fresh |', '| --- | --- | --- | --- | --- |',
    ...report.schemaDifferences.map((d) => `| ${d.table} | ${d.column} | ${d.field ?? 'presence'} | ${d.ledger ?? 'NULL'} | ${d.fresh ?? 'NULL'} |`), '',
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--pglite-module', '--output-dir'].includes(args[index]) || !args[index + 1]) {
      throw new Error('Usage: node scripts/restore-rehearsal.mjs --output-dir DIR [--pglite-module PATH]');
    }
    options[args[index]] = args[index + 1];
  }
  if (!options['--output-dir']) throw new Error('--output-dir is required');
  const report = await runRestoreRehearsal({ pgliteModule: options['--pglite-module'] ?? process.env.FREEZER_PGLITE_MODULE });
  const out = path.resolve(options['--output-dir']);
  await mkdir(out, { recursive: true });
  const { artifacts, ...summary } = report;
  for (const [name, item] of Object.entries({ readings: artifacts.exports.readings,
    prototype_readings: artifacts.exports.prototype_readings, readings_bounded: artifacts.bounded })) {
    await writeFile(path.join(out, `synthetic-${name}.jsonl`), item.content, { flag: 'wx' });
    await writeFile(path.join(out, `synthetic-${name}.jsonl.manifest.json`), `${JSON.stringify({ ...item.manifest, synthetic_fixture: true }, null, 2)}\n`, { flag: 'wx' });
  }
  await writeFile(path.join(out, 'restore-rehearsal.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.join(out, 'restore-rehearsal.md'), rehearsalMarkdown(summary), { flag: 'wx' });
  console.log(`${report.passed ? 'PASSED' : 'FAILED'}: ${report.checks.filter((c) => c.passed).length}/${report.checks.length} checks. Report: ${out}`);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
