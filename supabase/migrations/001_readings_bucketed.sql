-- Migration 001 — server-side time bucketing for long history ranges.
--
-- ADDITIVE AND IDEMPOTENT. Safe to run on a project where `readings` already
-- holds data: it creates no tables, alters no columns, and touches no rows.
-- `create or replace` + `grant` can be re-run as often as you like.
--
-- Do NOT re-run schema.sql to pick this up — that file starts with
-- `create table readings`, which errors out on an existing table. Run this
-- file instead. (schema.sql also carries the function, so a brand-new project
-- gets everything from that one paste and can skip this migration.)

create or replace function readings_bucketed(
  p_freezer_id smallint,
  p_start timestamptz,
  p_end timestamptz,
  p_bucket_seconds integer
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
as $$
  select
    to_timestamp(floor(extract(epoch from recorded_at) / p_bucket_seconds) * p_bucket_seconds) as bucket_time,
    avg(temp_c) as avg_temp_c,
    min(temp_c) as min_temp_c,
    max(temp_c) as max_temp_c,
    count(*) as reading_count
  from readings
  where freezer_id = p_freezer_id
    and recorded_at >= p_start
    and recorded_at < p_end
  group by 1
  order by 1;
$$;

grant execute on function readings_bucketed to anon;

-- The function is not SECURITY DEFINER, so it executes as the calling role and
-- row-level security on `readings` still applies. anon gains no reach here that
-- it did not already have through the existing select policy.
