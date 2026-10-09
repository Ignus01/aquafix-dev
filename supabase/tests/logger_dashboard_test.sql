-- Tests for logger_dashboard(): who may call it, the filters, and each
-- logger's figures (days with data, longest gap, silent / never, previous
-- period, pull failures).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-1091-000000000001', '00000000-0000-0000-1091-000000000000', 'authenticated', 'authenticated',
   'ld-sysadmin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1091-000000000002', '00000000-0000-0000-1091-000000000000', 'authenticated', 'authenticated',
   'ld-admin@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-1091-000000000001', 'system_admin'),
  ('10000000-0000-0000-1091-000000000002', 'admin');

insert into public.region (id, name) values ('a0000000-0000-0000-1091-000000000001', 'LD-North');
insert into public.organisation (id, name) values ('a1000000-0000-0000-1091-000000000001', 'LD-ORG');
insert into public.location (id, name, region_id, organisation_id) values
  ('a2000000-0000-0000-1091-000000000001', 'LD-Plant', 'a0000000-0000-0000-1091-000000000001', 'a1000000-0000-0000-1091-000000000001'),
  ('a2000000-0000-0000-1091-000000000002', 'LD-Other', 'a0000000-0000-0000-1091-000000000001', 'a1000000-0000-0000-1091-000000000001');
insert into public.asset_type (id, name) values ('a3000000-0000-0000-1091-000000000001', 'LD-Meter');

-- At LD-Plant: A reports, B went silent, C never reported, E has no logger.
-- At LD-Other: D.
insert into public.asset (id, name, code, asset_type_id, location_id, active, logger_code, logger_type) values
  ('30000000-0000-0000-1091-00000000000a', 'LD A', 'LD-A', 'a3000000-0000-0000-1091-000000000001', 'a2000000-0000-0000-1091-000000000001', true, 'ld_a', 'HYDRUS'),
  ('30000000-0000-0000-1091-00000000000b', 'LD B', 'LD-B', 'a3000000-0000-0000-1091-000000000001', 'a2000000-0000-0000-1091-000000000001', true, 'ld_b', 'HYDRUS'),
  ('30000000-0000-0000-1091-00000000000c', 'LD C', 'LD-C', 'a3000000-0000-0000-1091-000000000001', 'a2000000-0000-0000-1091-000000000001', true, 'ld_c', 'HYDRUS'),
  ('30000000-0000-0000-1091-00000000000d', 'LD D', 'LD-D', 'a3000000-0000-0000-1091-000000000001', 'a2000000-0000-0000-1091-000000000002', true, 'ld_d', 'HYDRUS'),
  ('30000000-0000-0000-1091-00000000000e', 'LD E', 'LD-E', 'a3000000-0000-0000-1091-000000000001', 'a2000000-0000-0000-1091-000000000001', true, null, null);

-- Wall time `day` days ago at `hour`:00 in the app time zone.
create function pg_temp.at(day integer, hour integer) returns timestamptz
language sql stable as $$
  select ((public.app_today() - day) + make_time(hour, 0, 0)) at time zone public.app_time_zone()
$$;

-- A: every 6 hours from 9 days ago to yesterday, but nothing 5 days ago
-- (8 days with data out of 9; longest gap 6 days ago 18:00 → 4 days ago
-- 00:00 = 30 hours). One reading in the previous period. Values 100–103.
insert into public.logger_reading (asset_id, logger_type, logger_code, reading_at, value, unit)
select '30000000-0000-0000-1091-00000000000a', 'HYDRUS', 'ld_a', pg_temp.at(d, h), 100 + h / 6, 'kPa'
from generate_series(1, 9) d, generate_series(0, 18, 6) h
where d <> 5;
insert into public.logger_reading (asset_id, logger_type, logger_code, reading_at, value, unit)
values ('30000000-0000-0000-1091-00000000000a', 'HYDRUS', 'ld_a', pg_temp.at(12, 0), 50, 'kPa');

-- B: two readings 4 days ago, one of them zero.
insert into public.logger_reading (asset_id, logger_type, logger_code, reading_at, value, unit) values
  ('30000000-0000-0000-1091-00000000000b', 'HYDRUS', 'ld_b', pg_temp.at(4, 12), 0, 'm'),
  ('30000000-0000-0000-1091-00000000000b', 'HYDRUS', 'ld_b', pg_temp.at(4, 13), 5, 'm');

-- D: one reading yesterday.
insert into public.logger_reading (asset_id, logger_type, logger_code, reading_at, value, unit)
values ('30000000-0000-0000-1091-00000000000d', 'HYDRUS', 'ld_d', pg_temp.at(1, 6), 7, 'kPa');

-- A pull 2 days ago: A succeeded, B failed.
with run as (
  insert into public.logger_pull_run (trigger, range_start, range_end, created_at)
  values ('manual', pg_temp.at(3, 0), pg_temp.at(2, 0), pg_temp.at(2, 6))
  returning id
)
insert into public.logger_pull_result (run_id, asset_id, logger_code, status, readings_saved, error)
select run.id, x.asset_id, x.code, x.status, x.saved, x.error
from run, (values
  ('30000000-0000-0000-1091-00000000000a'::uuid, 'ld_a', 'success', 4, null),
  ('30000000-0000-0000-1091-00000000000b'::uuid, 'ld_b', 'failed', null, 'Logger code not found.')
) as x (asset_id, code, status, saved, error);

create temp table result (d jsonb);
grant all on result to authenticated;

-- ============================================================================
-- Who may call it
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-1091-000000000002", "role": "authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$ select public.logger_dashboard(public.app_today() - 9, public.app_today()) $$,
  '42501', 'Only system admins can see logger data.', 'an admin cannot see the logger report');

reset role;
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-1091-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$ select public.logger_dashboard(public.app_today(), public.app_today() - 1) $$,
  '22023', null, 'the period must not end before it starts');

insert into result
select public.logger_dashboard(public.app_today() - 9, public.app_today(), null, null, 'a2000000-0000-0000-1091-000000000001');

-- ============================================================================
-- Totals
-- ============================================================================
select is((select d -> 'period' ->> 'bucket' from result), 'day', 'a 10-day period is shown per day');
select is((select jsonb_array_length(d -> 'series') from result), 10, 'one series point per day');

select is((select d -> 'scope' from result),
  '{"loggers": 3, "reporting": 2, "ok": 1, "silent": 1, "never": 1}'::jsonb,
  'loggers at the site: A reporting, B silent, C never; D (other site) and E (no logger) are left out');

select is((select (d -> 'readings' ->> 'count')::int from result), 34, 'readings in the period');
select is((select (d -> 'readings' ->> 'prev')::int from result), 1, 'readings in the previous period');
select is((select (d -> 'readings' ->> 'days_with_data')::int from result), 9, 'days with data: A 8 + B 1');
select is((select (d -> 'readings' ->> 'days_expected')::int from result), 9 + 4 + 9,
  'days expected: A from its first reading, B from its first reading, C the whole period, up to yesterday');

select is((select d -> 'pulls' from result),
  '{"succeeded": 1, "failed": 1, "pending": 0, "loggers_failed": 1}'::jsonb, 'pulls in the period');

-- ============================================================================
-- Per logger
-- ============================================================================
create temp view lg as
select l from result, jsonb_array_elements(d -> 'loggers') l;
grant select on lg to authenticated;

select is((select array_agg(l ->> 'name' order by l ->> 'name') from lg), array['LD A', 'LD B', 'LD C'],
  'one row per logger at the site');

select is(
  (select jsonb_build_object(
     'status', l -> 'status', 'unit', l -> 'unit', 'readings', l -> 'readings',
     'min', (l ->> 'min')::numeric, 'max', (l ->> 'max')::numeric, 'avg', (l ->> 'avg')::numeric,
     'days_with_data', l -> 'days_with_data', 'days_expected', l -> 'days_expected',
     'longest_gap_hours', (l ->> 'longest_gap_hours')::numeric,
     'prev_readings', l -> 'prev_readings', 'prev_avg', (l ->> 'prev_avg')::numeric,
     'last_value', (l ->> 'last_value')::numeric, 'pulls_succeeded', l -> 'pulls_succeeded')
   from lg where l ->> 'name' = 'LD A'),
  '{"status": "ok", "unit": "kPa", "readings": 32, "min": 100, "max": 103, "avg": 101.5,
    "days_with_data": 8, "days_expected": 9, "longest_gap_hours": 30,
    "prev_readings": 1, "prev_avg": 50, "last_value": 103, "pulls_succeeded": 1}'::jsonb,
  'A: figures for the period');

select is(
  (select jsonb_build_object('status', l -> 'status', 'zeros', l -> 'zeros', 'longest_gap_hours',
     (l ->> 'longest_gap_hours')::numeric, 'pulls_failed', l -> 'pulls_failed', 'last_error', l -> 'last_error')
   from lg where l ->> 'name' = 'LD B'),
  '{"status": "silent", "zeros": 1, "longest_gap_hours": 1, "pulls_failed": 1, "last_error": "Logger code not found."}'::jsonb,
  'B: silent, a zero reading and a failed pull');

select is(
  (select jsonb_build_object('status', l -> 'status', 'readings', l -> 'readings', 'last_at', l -> 'last_at')
   from lg where l ->> 'name' = 'LD C'),
  '{"status": "never", "readings": 0, "last_at": null}'::jsonb,
  'C: never reported');

select is(
  (select jsonb_array_length(l -> 'series') from lg where l ->> 'name' = 'LD A'), 10,
  'each logger has a value per series point');
select is(
  (select (l -> 'series' ->> 4)::numeric from lg where l ->> 'name' = 'LD A'), null,
  'no daily average on the day without readings');

reset role;

-- Every site: D counts too.
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-1091-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select ok(
  (select public.logger_dashboard(public.app_today() - 9, public.app_today()) -> 'loggers') @>
    '[{"name": "LD D"}]'::jsonb,
  'without a site filter other sites are included');
reset role;

select * from finish();
rollback;
