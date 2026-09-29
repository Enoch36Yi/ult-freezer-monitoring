-- Migration 002 — make readings_bucketed() tier-aware.
--
-- WHY THIS IS NOT OPTIONAL FOR A MULTI-INSTRUMENT STUDY
--
-- The 001 function aggregated every row for a freezer regardless of which
-- instrument produced it. With only the ESP32/DS18B20 tier writing, that was
-- harmless. The moment a second tier (TRAXX, iMonnit) writes to the same
-- freezer_id, avg/min/max are computed across instruments with different
-- offsets, placements and accuracies — and the chart shows a single line that
-- corresponds to no real measurement. Silently. That is a data-validity bug,
-- not a display bug, so the filter belongs in the function.
--
-- ADDITIVE AND IDEMPOTENT with respect to data: creates an index and replaces
-- a function. No table changes, no row changes. Safe on a populated table.

-- The 4-argument signature must go, or a 4-argument call becomes ambiguous
-- between it and the new version's defaulted parameter.
drop function if exists public.readings_bucketed(smallint, timestamptz, timestamptz, integer);

create or replace function public.readings_bucketed(
  p_freezer_id smallint,
  p_start timestamptz,
  p_end timestamptz,
  p_bucket_seconds integer,
  p_sensor_tier text default 'esp32_ds18b20'
)
returns table (
  bucket_time timestamptz,
  avg_temp_c numeric,
  min_temp_c numeric,
  max_temp_c numeric,
  reading_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    to_timestamp(floor(extract(epoch from recorded_at) / p_bucket_seconds) * p_bucket_seconds) as bucket_time,
    avg(temp_c) as avg_temp_c,
    min(temp_c) as min_temp_c,
    max(temp_c) as max_temp_c,
    count(*) as reading_count
  from public.readings
  where freezer_id = p_freezer_id
    and sensor_tier = p_sensor_tier
    and recorded_at >= p_start
    and recorded_at < p_end
  group by 1
  order by 1;
$$;

revoke all on function public.readings_bucketed(smallint, timestamptz, timestamptz, integer, text) from public;
grant execute on function public.readings_bucketed(smallint, timestamptz, timestamptz, integer, text) to anon, authenticated;

-- Supports the new three-column access pattern (freezer + tier + time), which
-- the original (freezer_id, recorded_at desc) index can only partly serve.
create index if not exists readings_freezer_tier_time_idx
  on public.readings (freezer_id, sensor_tier, recorded_at desc);
