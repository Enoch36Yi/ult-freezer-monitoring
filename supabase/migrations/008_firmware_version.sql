-- Migration 008 — record the firmware build that produced each observation.
--
-- Nullable keeps historical rows and older queued payloads valid. New firmware
-- includes the version, while the ingest route still accepts legacy rows.

begin;

alter table public.readings
  add column if not exists firmware_version text;

alter table public.prototype_readings
  add column if not exists firmware_version text;

commit;
