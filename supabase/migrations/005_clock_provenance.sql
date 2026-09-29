-- Migration 005 — preserve measurement timestamp provenance.
--
-- Existing rows are left nullable because their original clock state is not
-- recoverable. The authenticated ingestion route requires a real recorded_at
-- and writes clock_valid=true for all new observations.

begin;

alter table public.readings
  add column if not exists clock_valid boolean;

alter table public.prototype_readings
  add column if not exists clock_valid boolean;

commit;
