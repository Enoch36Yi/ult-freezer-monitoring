-- Migration 007 — index server receipt time for node liveness.
--
-- Dashboard status uses received_at so buffered/replayed measurements do not
-- make a connected node look offline. Keep recorded_at indexes for history.

begin;

create index if not exists readings_freezer_tier_received_idx
  on public.readings (freezer_id, sensor_tier, received_at desc);

create index if not exists prototype_readings_tier_received_idx
  on public.prototype_readings (prototype_id, sensor_tier, received_at desc);

commit;
