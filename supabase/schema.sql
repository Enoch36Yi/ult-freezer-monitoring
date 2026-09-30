-- ULT Freezer Monitoring System — database schema
-- Run once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).

create table public.readings (
  id bigint generated always as identity primary key,
  freezer_id smallint not null check (freezer_id between 1 and 21),
  device_id text not null,
  observation_id text not null,
  sensor_tier text not null default 'esp32_ds18b20',
  temp_c numeric not null,
  rssi integer,
  reset_reason text,
  recorded_at timestamptz not null default now(),
  clock_valid boolean not null default true,
  received_at timestamptz not null default now()
);

create index on public.readings (freezer_id, recorded_at desc);
create unique index readings_device_observation_uidx
  on public.readings (device_id, observation_id);

alter table public.readings enable row level security;

-- Devices write through the authenticated application ingestion route. The
-- browser's publishable key is read-only, so it cannot spoof observations.
grant select on public.readings to anon;

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
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_bucket_seconds not in (300, 900, 3600, 21600) then
    raise exception using message = 'unsupported bucket width', errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception using message = 'invalid history range', errcode = '22023';
  end if;
  if p_end > p_start + interval '10 years' then
    raise exception using message = 'history range is too large', errcode = '22023';
  end if;

  return query
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
end;
$$;

revoke all on function public.readings_bucketed(smallint, timestamptz, timestamptz, integer, text) from public;
grant execute on function public.readings_bucketed(smallint, timestamptz, timestamptz, integer, text) to anon, authenticated;

-- Supports the three-column access pattern (freezer + tier + time) used by
-- every query once more than one instrument reports into this table.
create index if not exists readings_freezer_tier_time_idx
  on public.readings (freezer_id, sensor_tier, recorded_at desc);

create index if not exists readings_freezer_tier_received_idx
  on public.readings (freezer_id, sensor_tier, received_at desc);
