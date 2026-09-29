-- Migration 003 — remove anonymous device writes.
--
-- Devices now authenticate to web/app/api/ingest/route.ts with a per-device
-- HMAC. Keep the dashboard's intentionally public reads, but do not let a
-- browser or arbitrary curl caller insert study or prototype observations.

begin;

revoke insert on public.readings from anon, authenticated;
drop policy if exists "anon can insert readings" on public.readings;

revoke insert on public.prototype_readings from anon, authenticated;
drop policy if exists "anon can insert prototype 22 readings" on public.prototype_readings;

commit;
