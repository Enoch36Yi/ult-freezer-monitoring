-- Migration 006 — bound history RPC resource usage.
--
-- The dashboard only needs four bucket widths and finite historical ranges.
-- Rejecting arbitrary widths and unbounded intervals prevents an anonymous
-- caller from turning the public read API into an expensive scan.

begin;

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

revoke all on function public.readings_bucketed(smallint, timestamptz, timestamptz, integer, text) from public;
grant execute on function public.readings_bucketed(smallint, timestamptz, timestamptz, integer, text) to anon, authenticated;
revoke all on function public.prototype_readings_bucketed(smallint, timestamptz, timestamptz, integer, text) from public;
grant execute on function public.prototype_readings_bucketed(smallint, timestamptz, timestamptz, integer, text) to anon;

commit;
