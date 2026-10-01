-- Migration 010 — batch the fleet latest-reading lookup.
--
-- The dashboard previously issued one indexed query per freezer every refresh.
-- This function returns at most one row per freezer for one sensor tier and
-- continues to order liveness by server receipt time.

begin;

create index if not exists readings_tier_freezer_received_idx
  on public.readings (sensor_tier, freezer_id, received_at desc);

create or replace function public.readings_latest(
  p_sensor_tier text default 'esp32_ds18b20'
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
  if p_sensor_tier not in ('esp32_ds18b20', 'imonnit', 'traxx') then
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

revoke all on function public.readings_latest(text) from public;
grant execute on function public.readings_latest(text) to anon, authenticated;

commit;
