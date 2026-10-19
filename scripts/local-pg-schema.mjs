// Builds isolated local PostgreSQL schemas for restore rehearsals and tests.
// It accepts only an in-process PGlite instance created by the caller; it has
// no connection-string path and therefore cannot reach Supabase or production.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);

// The initial repository snapshot's eight-column tables, byte-identical to
// commit 893637cf6af2a6df27322714ecfe320c60d1b292. Git blob hashes are checked
// before use so an edited fixture cannot silently stand in for history.
export const LEGACY_BASE = {
  commit: '893637cf6af2a6df27322714ecfe320c60d1b292',
  files: [
    { path: 'scripts/fixtures/legacy-893637c/schema.sql', blob: '356073c28cb89f37e50703939e9b099f8f35f06e' },
    { path: 'scripts/fixtures/legacy-893637c/prototype22.sql', blob: 'ed4de55ac7e59fecec09872bbfcd228eb911419c' },
  ],
};

// The live sequence recorded on 2026-10-09: 004-011 applied in order; 003 was
// deliberately deferred; 001/002 functions already exist in the base snapshot.
// The final file is the prepared, still-unapplied replay-conflict migration.
export const LEDGER_MIGRATIONS = [
  '004_replay_safe_observations.sql',
  '005_clock_provenance.sql',
  '006_bound_history_rpc.sql',
  '007_latest_received_index.sql',
  '008_firmware_version.sql',
  '009_payload_version.sql',
  '010_latest_readings_rpc.sql',
  '011_pt1000_max31865_sensor_tier.sql',
  '20261017233132_replay_conflict_identity.sql',
];

export function gitBlobSha1(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

async function projectFile(relative) {
  return readFile(new URL(relative, root));
}

export async function loadPglite(modulePath) {
  if (!modulePath) throw new Error('Set FREEZER_PGLITE_MODULE or pass --pglite-module to a local @electric-sql/pglite dist/index.js');
  const { PGlite } = await import(pathToFileURL(path.resolve(modulePath)).href);
  return PGlite;
}

// Supabase API roles referenced by grants and policies. Local stand-ins only.
export async function createApiRoles(db) {
  await db.exec(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;`);
}

export async function applyLegacyBase(db) {
  await createApiRoles(db);
  for (const file of LEGACY_BASE.files) {
    const bytes = await projectFile(file.path);
    if (gitBlobSha1(bytes) !== file.blob) throw new Error(`${file.path} does not match commit ${LEGACY_BASE.commit}`);
    await db.exec(bytes.toString('utf8'));
  }
}

export async function applyLedgerMigrations(db, migrations = LEDGER_MIGRATIONS) {
  for (const name of migrations) {
    await db.exec((await projectFile(`supabase/migrations/${name}`)).toString('utf8'));
  }
}

// Existing-project path: historical base tables, then the recorded ledger.
export async function buildLedgerSchema(db, { beforeMigrations } = {}) {
  await applyLegacyBase(db);
  if (beforeMigrations) await beforeMigrations(db);
  await applyLedgerMigrations(db);
}

// Fresh-project path documented in supabase/MIGRATIONS.md.
export async function buildFreshSchema(db) {
  await createApiRoles(db);
  await db.exec((await projectFile('supabase/schema.sql')).toString('utf8'));
  await db.exec((await projectFile('supabase/prototype22.sql')).toString('utf8'));
}

export async function tableColumns(db, table) {
  const result = await db.query(`select column_name, data_type, is_nullable, column_default, is_identity
      from information_schema.columns
     where table_schema = 'public' and table_name = $1
     order by ordinal_position`, [table]);
  return result.rows;
}
