-- Migration 011 — add the shared PT1000/MAX31865 in-house sensor tier.
--
-- Existing DS18B20 rows remain unchanged and queryable as
-- `esp32_ds18b20`. New firmware writes `esp32_pt1000_max31865`.

begin;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
      from pg_constraint
     where conrelid = 'public.prototype_readings'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%sensor_tier%'
  loop
    execute format(
      'alter table public.prototype_readings drop constraint %I',
      constraint_name
    );
  end loop;
end;
$$;

alter table public.prototype_readings
  add constraint prototype_readings_sensor_tier_check
  check (sensor_tier in ('esp32_ds18b20', 'esp32_pt1000_max31865'));

create or replace function public.readings_bucketed(
  p_freezer_id smallint,
  p_start timestamptz,
  p_end timestamptz,
  p_bucket_seconds integer,
  p_sensor_tier text default 'esp32_pt1000_max31865'
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
    select to_timestamp(floor(extract(epoch from recorded_at) / p_bucket_seconds) * p_bucket_seconds),
           avg(temp_c), min(temp_c), max(temp_c), count(*)
      from public.readings
     where freezer_id = p_freezer_id
       and sensor_tier = p_sensor_tier
       and recorded_at >= p_start
       and recorded_at < p_end
     group by 1
     order by 1;
end;
$$;

create or replace function public.prototype_readings_bucketed(
  p_prototype_id smallint,
  p_start timestamptz,
  p_end timestamptz,
  p_bucket_seconds integer,
  p_sensor_tier text default 'esp32_pt1000_max31865'
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
    select to_timestamp(floor(extract(epoch from recorded_at) / p_bucket_seconds) * p_bucket_seconds),
           avg(temp_c), min(temp_c), max(temp_c), count(*)
      from public.prototype_readings
     where prototype_id = p_prototype_id
       and sensor_tier = p_sensor_tier
       and recorded_at >= p_start
       and recorded_at < p_end
     group by 1
     order by 1;
end;
$$;

create or replace function public.readings_latest(
  p_sensor_tier text default 'esp32_pt1000_max31865'
)
returns table (
  freezer_id smallint,
  firmware_version text,
  temp_c numeric,
  rssi integer,
  reset_reason text,
  recorded_at timestamptz,
  received_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_sensor_tier not in (
    'esp32_ds18b20', 'esp32_pt1000_max31865', 'imonnit', 'traxx'
  ) then
    raise exception using message = 'unsupported sensor tier', errcode = '22023';
  end if;

  return query
    select distinct on (r.freezer_id)
      r.freezer_id, r.firmware_version, r.temp_c, r.rssi, r.reset_reason,
      r.recorded_at, r.received_at
      from public.readings as r
     where r.sensor_tier = p_sensor_tier
     order by r.freezer_id, r.received_at desc, r.id desc;
end;
$$;

revoke all on function public.readings_bucketed(smallint, timestamptz, timestamptz, integer, text) from public;
grant execute on function public.readings_bucketed(smallint, timestamptz, timestamptz, integer, text) to anon, authenticated;
revoke all on function public.prototype_readings_bucketed(smallint, timestamptz, timestamptz, integer, text) from public;
grant execute on function public.prototype_readings_bucketed(smallint, timestamptz, timestamptz, integer, text) to anon;
revoke all on function public.readings_latest(text) from public;
grant execute on function public.readings_latest(text) to anon, authenticated;

commit;
