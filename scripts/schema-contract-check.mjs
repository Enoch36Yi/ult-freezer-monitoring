import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function text(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

export async function runContractChecks() {
  const checks = [];
  const pass = (name) => checks.push({ name, passed: true });
  const requireText = (name, source, pattern) => {
    if (!pattern.test(source)) {
      throw new Error(`${name}: required contract is missing (${pattern})`);
    }
    pass(name);
  };

  const [schema, prototype, route, readings, verify] = await Promise.all([
    text('supabase/schema.sql'),
    text('supabase/prototype22.sql'),
    text('web/app/api/ingest/route.ts'),
    text('web/lib/readings.ts'),
    text('supabase/verify.ps1'),
  ]);

  requireText('fleet table', schema, /create table public\.readings\s*\(/);
  for (const column of ['device_id', 'firmware_version', 'observation_id',
    'clock_valid', 'received_at']) {
    requireText(`fleet column ${column}`, schema, new RegExp(`\\b${column}\\b`));
  }
  requireText('fleet read grant', schema, /grant select on public\.readings to anon/);
  requireText('fleet RLS read policy', schema, /create policy "anon can read readings"/);
  requireText('fleet liveness index', schema, /readings_freezer_tier_received_idx/);
  requireText('fleet bounded history RPC', schema, /p_bucket_seconds integer[\s\S]*unsupported bucket width/);

  requireText('prototype table', prototype, /create table public\.prototype_readings\s*\(/);
  for (const column of ['device_id', 'firmware_version', 'observation_id',
    'clock_valid', 'received_at']) {
    requireText(`prototype column ${column}`, prototype, new RegExp(`\\b${column}\\b`));
  }
  requireText('prototype read grant', prototype, /grant select on public\.prototype_readings to anon/);
  requireText('prototype liveness index', prototype, /prototype_readings_tier_received_idx/);
  requireText('prototype bounded history RPC', prototype, /prototype_readings_bucketed[\s\S]*unsupported bucket width/);

  const migrationNames = (await readdir(path.join(root, 'supabase/migrations')))
    .filter((name) => /^\d{3}_.*\.sql$/.test(name))
    .sort();
  const expectedMigrations = [
    '001_readings_bucketed.sql',
    '002_bucketed_by_tier.sql',
    '003_authenticated_ingest.sql',
    '004_replay_safe_observations.sql',
    '005_clock_provenance.sql',
    '006_bound_history_rpc.sql',
    '007_latest_received_index.sql',
    '008_firmware_version.sql',
  ];
  if (JSON.stringify(migrationNames) !== JSON.stringify(expectedMigrations)) {
    throw new Error(`migration ordering mismatch: found ${migrationNames.join(', ')}`);
  }
  pass('migration sequence 001-008');

  const authenticatedIngest = await text('supabase/migrations/003_authenticated_ingest.sql');
  requireText('anonymous fleet insert revoked', authenticatedIngest,
    /revoke insert on public\.readings from anon, authenticated/);
  requireText('anonymous prototype insert revoked', authenticatedIngest,
    /revoke insert on public\.prototype_readings from anon, authenticated/);

  requireText('ingest body cap', route, /MAX_BODY_BYTES = 32 \* 1024/);
  requireText('streamed body reader', route, /readBodyLimited/);
  requireText('placeholder secret rejection', route, /secret\.startsWith\("replace-"\)/);
  requireText('firmware version validation', route, /firmware_version/);
  requireText('latest fleet receipt ordering', readings,
    /select\("freezer_id,firmware_version[\s\S]*received_at"\)[\s\S]*order\("received_at"/);
  requireText('latest prototype receipt ordering', readings,
    /select\("prototype_id,firmware_version[\s\S]*received_at"\)[\s\S]*order\("received_at"/);
  requireText('verifier prototype path', verify, /prototype_readings\?select=/);
  requireText('verifier firmware field', verify, /firmware_version/);

  return checks;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runContractChecks()
    .then((checks) => {
      for (const check of checks) console.log(`ok - ${check.name}`);
      console.log(`Schema contract checks passed: ${checks.length}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
