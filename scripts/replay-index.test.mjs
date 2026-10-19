// Synthetic rows in an in-memory PostgreSQL engine; never connects to Supabase.
// Set FREEZER_PGLITE_MODULE to an externally installed @electric-sql/pglite
// dist/index.js. An explicitly configured but unavailable module fails the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.FREEZER_PGLITE_MODULE;
const skip = modulePath ? false : 'Set FREEZER_PGLITE_MODULE to run the local PostgreSQL integration test';
const tables = [
  { table: 'readings', device: 'freezer-01' },
  { table: 'prototype_readings', device: 'prototype-22' },
];

test('replay migration preserves nullable history and enables identity conflicts on both tables', { skip }, async (t) => {
  const { PGlite } = await import(pathToFileURL(path.resolve(modulePath)).href);
  const db = new PGlite();
  t.after(() => db.close());
  const migration = await readFile(new URL('../supabase/migrations/20261017233132_replay_conflict_identity.sql', import.meta.url), 'utf8');

  for (const { table } of tables) {
    await db.exec(`CREATE TABLE public.${table} (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      temp_c numeric NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT now()
    )`);
  }
  // Exercise the actual upgrade path, including migration 004's partial indexes.
  await db.exec(await readFile(new URL('../supabase/migrations/004_replay_safe_observations.sql', import.meta.url), 'utf8'));
  const snapshots = new Map();
  for (const { table, device } of tables) {
    await db.query(`INSERT INTO public.${table} (device_id, observation_id, temp_c) VALUES
      (NULL, NULL, -1), (NULL, NULL, -2),
      (NULL, 'legacy', -3), (NULL, 'legacy', -4),
      ('legacy', NULL, -5), ('legacy', NULL, -6),
      ($1, $2, -72)`, [device, `${device}-1-1`]);
    const before = (await db.query(`SELECT * FROM public.${table} ORDER BY id`)).rows;
    snapshots.set(table, before);

    await t.test(`${table}: the default id conflict target rejects a whole mixed replay batch`, async () => {
      await assert.rejects(db.query(`INSERT INTO public.${table} (device_id, observation_id, temp_c)
        VALUES ($1, $2, -72), ($1, $3, -71) ON CONFLICT (id) DO NOTHING RETURNING *`,
      [device, `${device}-1-1`, `${device}-1-2`]), (error) => error.code === '23505');
      assert.deepEqual((await db.query(`SELECT * FROM public.${table} ORDER BY id`)).rows, before);
    });
    await t.test(`${table}: migration 004 alone cannot infer the observation conflict target`, async () => {
      await assert.rejects(db.query(`INSERT INTO public.${table} (device_id, observation_id, temp_c)
        VALUES ($1, $2, -71) ON CONFLICT (device_id, observation_id) DO NOTHING RETURNING *`,
      [device, `${device}-1-2`]), (error) => error.code === '42P10');
    });
  }

  await db.exec(migration);
  for (const { table, device } of tables) {
    await t.test(`${table}: the migration preserves history and accepts only new observations`, async () => {
      assert.deepEqual((await db.query(`SELECT * FROM public.${table} ORDER BY id`)).rows, snapshots.get(table));
      const mixed = await db.query(`INSERT INTO public.${table} (device_id, observation_id, temp_c)
        VALUES ($1, $2, -72), ($1, $3, -71), ($1, $3, -71)
        ON CONFLICT (device_id, observation_id) DO NOTHING RETURNING observation_id`,
      [device, `${device}-1-1`, `${device}-1-2`]);
      assert.deepEqual(mixed.rows, [{ observation_id: `${device}-1-2` }]);
      const replay = await db.query(`INSERT INTO public.${table} (device_id, observation_id, temp_c)
        VALUES ($1, $2, -72), ($1, $3, -71)
        ON CONFLICT (device_id, observation_id) DO NOTHING RETURNING observation_id`,
      [device, `${device}-1-1`, `${device}-1-2`]);
      assert.deepEqual(replay.rows, []);
      await db.exec(`INSERT INTO public.${table} (device_id, observation_id, temp_c)
        VALUES (NULL, NULL, -7), (NULL, 'legacy', -8), ('legacy', NULL, -9)`);
      assert.equal((await db.query(`SELECT count(*)::int AS count FROM public.${table}`)).rows[0].count, 11);
    });
  }

  await t.test('rerunning the migration preserves rows and replay behavior', async () => {
    const beforeRerun = new Map();
    for (const { table } of tables) {
      beforeRerun.set(table, (await db.query(`SELECT * FROM public.${table} ORDER BY id`)).rows);
    }
    await db.exec(migration);
    for (const { table, device } of tables) {
      assert.deepEqual((await db.query(`SELECT * FROM public.${table} ORDER BY id`)).rows, beforeRerun.get(table));
      const replay = await db.query(`INSERT INTO public.${table} (device_id, observation_id, temp_c)
        VALUES ($1, $2, -72) ON CONFLICT (device_id, observation_id) DO NOTHING RETURNING *`,
      [device, `${device}-1-1`]);
      assert.deepEqual(replay.rows, []);
    }
  });
});
