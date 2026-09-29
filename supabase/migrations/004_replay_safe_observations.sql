-- Migration 004 — add replay-safe observation identity.
--
-- Existing rows predate device identity, so the new columns are nullable in
-- this additive migration. New rows from /api/ingest always provide both
-- values, and the partial unique indexes make retries idempotent.

begin;

alter table public.readings
  add column if not exists device_id text,
  add column if not exists observation_id text;

alter table public.prototype_readings
  add column if not exists device_id text,
  add column if not exists observation_id text;

create unique index if not exists readings_device_observation_uidx
  on public.readings (device_id, observation_id)
  where device_id is not null and observation_id is not null;

create unique index if not exists prototype_device_observation_uidx
  on public.prototype_readings (device_id, observation_id)
  where device_id is not null and observation_id is not null;

commit;
