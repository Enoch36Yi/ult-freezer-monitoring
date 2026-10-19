-- ULT Freezer Monitoring System — database schema
-- Run once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).

create table public.readings (
  id bigint generated always as identity primary key,
  freezer_id smallint not null check (freezer_id between 1 and 21),
  sensor_tier text not null default 'esp32_ds18b20',
  temp_c numeric not null,
  rssi integer,
  reset_reason text,
  recorded_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);

create index on public.readings (freezer_id, recorded_at desc);

alter table public.readings enable row level security;

-- New projects may require explicit Data API grants in addition to RLS.
grant select, insert on public.readings to anon;

create policy "anon can insert readings"
  on public.readings for insert
  to anon
  with check (freezer_id between 1 and 21);

create policy "anon can read readings"
  on public.readings for select
  to anon
  using (true);

-- ---------------------------------------------------------------------------
-- Server-side time bucketing, for history ranges too long to page raw rows.
--
-- This matches migrations/002_bucketed_by_tier.sql. It is repeated here so a
-- fresh project gets the whole schema from one paste. This file must not be
-- run on the populated production project.
--
-- Not SECURITY DEFINER, so it runs as the calling role and RLS still applies.
-- ---------------------------------------------------------------------------

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

-- Supports the three-column access pattern (freezer + tier + time) used by
-- every query once more than one instrument reports into this table.
create index if not exists readings_freezer_tier_time_idx
  on public.readings (freezer_id, sensor_tier, recorded_at desc);
