-- Migration 009 — record the telemetry payload contract version.
--
-- Existing rows predate the version field and are assigned the current
-- contract version. New application payloads must continue to use version 1
-- until a future migration deliberately adds and verifies another version.

begin;

alter table public.readings
  add column if not exists payload_version smallint;

alter table public.prototype_readings
  add column if not exists payload_version smallint;

update public.readings
   set payload_version = 1
 where payload_version is null;

update public.prototype_readings
   set payload_version = 1
 where payload_version is null;

alter table public.readings
  alter column payload_version set default 1,
  alter column payload_version set not null;

alter table public.prototype_readings
  alter column payload_version set default 1,
  alter column payload_version set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'readings_payload_version_check'
       and conrelid = 'public.readings'::regclass
  ) then
    alter table public.readings
      add constraint readings_payload_version_check check (payload_version = 1);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'prototype_readings_payload_version_check'
       and conrelid = 'public.prototype_readings'::regclass
  ) then
    alter table public.prototype_readings
      add constraint prototype_readings_payload_version_check check (payload_version = 1);
  end if;
end;
$$;

commit;
