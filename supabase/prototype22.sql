-- Prototype 22 is a bench instrument, not a 22nd study freezer. Execute once
-- against project dfxxamgnrimwoumknuxa. Does not alter public.readings.
begin;

create table public.prototype_readings (
  id bigint generated always as identity primary key,
  prototype_id smallint not null default 22 check (prototype_id = 22),
  device_id text not null,
  observation_id text not null,
  sensor_tier text not null default 'esp32_ds18b20'
    check (sensor_tier = 'esp32_ds18b20'),
  temp_c numeric not null,
  rssi integer,
  reset_reason text,
  recorded_at timestamptz not null default now(),
  clock_valid boolean not null default true,
  received_at timestamptz not null default now()
);

comment on table public.prototype_readings is
  'Bench measurements from Prototype 22; excluded from the 21-freezer study.';

create index prototype_readings_tier_time_idx
  on public.prototype_readings (prototype_id, sensor_tier, recorded_at desc);
create unique index prototype_device_observation_uidx
  on public.prototype_readings (device_id, observation_id);

alter table public.prototype_readings enable row level security;
revoke all on public.prototype_readings from public, anon, authenticated;
grant select on public.prototype_readings to anon;

create policy "anon can read prototype 22 readings"
  on public.prototype_readings for select to anon
  using (true);

create or replace function public.prototype_readings_bucketed(
  p_prototype_id smallint,
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
    from public.prototype_readings
    where prototype_id = p_prototype_id
      and sensor_tier = p_sensor_tier
      and recorded_at >= p_start
      and recorded_at < p_end
    group by 1
    order by 1;
end;
$$;

revoke all on function public.prototype_readings_bucketed(
  smallint, timestamptz, timestamptz, integer, text
) from public, anon, authenticated;
grant execute on function public.prototype_readings_bucketed(
  smallint, timestamptz, timestamptz, integer, text
) to anon;

commit;
