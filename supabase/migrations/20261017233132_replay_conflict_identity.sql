-- Pair with /api/ingest's on_conflict=device_id,observation_id.
-- PostgREST defaults to the generated id primary key and cannot infer the
-- partial indexes from migration 004 using conflict columns alone.
--
-- Ordinary UNIQUE indexes retain PostgreSQL's default NULLS DISTINCT behavior:
-- historical rows with either identity field NULL remain valid and unchanged.
-- Drop/recreate is atomic and holds write locks until commit. A failed rebuild
-- rolls back both index replacements; rerunning safely rebuilds the same keys.

begin;

drop index if exists public.readings_device_observation_uidx;
create unique index readings_device_observation_uidx
  on public.readings (device_id, observation_id);

drop index if exists public.prototype_device_observation_uidx;
create unique index prototype_device_observation_uidx
  on public.prototype_readings (device_id, observation_id);

commit;
