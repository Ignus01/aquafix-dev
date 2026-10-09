-- Tests for daily water usage: refresh_logger_daily_usage() (cleaning,
-- gaps, resets), the refresh after a pull, the time zone trigger, and
-- water_usage_report().
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-1092-000000000001', '00000000-0000-0000-1092-000000000000', 'authenticated', 'authenticated',
   'wu-sysadmin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1092-000000000002', '00000000-0000-0000-1092-000000000000', 'authenticated', 'authenticated',
   'wu-admin@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-1092-000000000001', 'system_admin'),
  ('10000000-0000-0000-1092-000000000002', 'admin');

insert into public.region (id, name) values ('a0000000-0000-0000-1092-000000000001', 'WU-North');
insert into public.organisation (id, name) values ('a1000000-0000-0000-1092-000000000001', 'WU-ORG');
insert into public.location (id, name, region_id, organisation_id) values
  ('a2000000-0000-0000-1092-000000000001', 'WU-Plant', 'a0000000-0000-0000-1092-000000000001', 'a1000000-0000-0000-1092-000000000001'),
  ('a2000000-0000-0000-1092-000000000002', 'WU-Other', 'a0000000-0000-0000-1092-000000000001', 'a1000000-0000-0000-1092-000000000001');
insert into public.asset_type (id, name) values ('a3000000-0000-0000-1092-000000000001', 'WU-Meter');

-- At WU-Plant: A (duplicate feed), B (gap and excursion), C (meter reset),
-- E (no readings), F (filled by a pull). At WU-Other: D (pressure).
insert into public.asset (id, name, code, asset_type_id, location_id, active, logger_code, logger_type) values
  ('30000000-0000-0000-1092-00000000000a', 'WU A', 'WU-A', 'a3000000-0000-0000-1092-000000000001', 'a2000000-0000-0000-1092-000000000001', true, 'wu_a', 'HYDRUS'),
  ('30000000-0000-0000-1092-00000000000b', 'WU B', 'WU-B', 'a3000000-0000-0000-1092-000000000001', 'a2000000-0000-0000-1092-000000000001', true, 'wu_b', 'HYDRUS'),
  ('30000000-0000-0000-1092-00000000000c', 'WU C', 'WU-C', 'a3000000-0000-0000-1092-000000000001', 'a2000000-0000-0000-1092-000000000001', true, 'wu_c', 'HYDRUS'),
  ('30000000-0000-0000-1092-00000000000d', 'WU D', 'WU-D', 'a3000000-0000-0000-1092-000000000001', 'a2000000-0000-0000-1092-000000000002', true, 'wu_d', 'HYDRUS'),
  ('30000000-0000-0000-1092-00000000000e', 'WU E', 'WU-E', 'a3000000-0000-0000-1092-000000000001', 'a2000000-0000-0000-1092-000000000001', true, 'wu_e', 'HYDRUS'),
  ('30000000-0000-0000-1092-00000000000f', 'WU F', 'WU-F', 'a3000000-0000-0000-1092-000000000001', 'a2000000-0000-0000-1092-000000000001', true, 'wu_f', 'HYDRUS');

-- Local wall time in the app time zone (Africa/Johannesburg).
create function pg_temp.ts(p text) returns timestamptz
language sql stable as $$ select p::timestamp at time zone public.app_time_zone() $$;

-- Every 10 minutes from `from_` to `to_`, a total rising 0.1 m³ per
-- reading: 14.4 m³ a day.
create function pg_temp.meter(p_asset uuid, p_code text, from_ text, to_ text, base numeric)
returns setof public.logger_reading
language sql as $$
  insert into public.logger_reading (asset_id, logger_type, logger_code, reading_at, value, unit)
  select p_asset, 'HYDRUS', p_code, g, base + 0.1 * (extract(epoch from g - pg_temp.ts(from_)) / 600), 'm^3'
  from generate_series(pg_temp.ts(from_), pg_temp.ts(to_), interval '10 minutes') g
  returning *;
$$;

-- A: 1–5 Jan, plus a second feed 500 m³ lower for the first 12 hours.
select count(*) from pg_temp.meter('30000000-0000-0000-1092-00000000000a', 'wu_a', '2026-01-01 00:00', '2026-01-05 00:00', 1000);
insert into public.logger_reading (asset_id, logger_type, logger_code, reading_at, value, unit)
select '30000000-0000-0000-1092-00000000000a', 'HYDRUS', 'wu_a', g + interval '5 minutes',
       500 + 0.1 * (extract(epoch from g - pg_temp.ts('2026-01-01 00:00')) / 600), 'm^3'
from generate_series(pg_temp.ts('2026-01-01 00:00'), pg_temp.ts('2026-01-01 12:00'), interval '10 minutes') g;

-- B: 1–8 Jan, nothing 2 Jan 06:00–14:00, and from 4 Jan 12:10 to 5 Jan
-- 12:00 a climb of 5 m³ per reading on top, then back to the real total.
select count(*) from pg_temp.meter('30000000-0000-0000-1092-00000000000b', 'wu_b', '2026-01-01 00:00', '2026-01-08 00:00', 2000);
delete from public.logger_reading
where logger_code = 'wu_b' and reading_at > pg_temp.ts('2026-01-02 06:00') and reading_at < pg_temp.ts('2026-01-02 14:00');
update public.logger_reading
set value = value + 5 * (extract(epoch from reading_at - pg_temp.ts('2026-01-04 12:00')) / 600)
where logger_code = 'wu_b' and reading_at > pg_temp.ts('2026-01-04 12:00') and reading_at <= pg_temp.ts('2026-01-05 12:00');

-- C: 1–4 Jan; the meter is replaced on 2 Jan at 12:00 and starts at zero.
select count(*) from pg_temp.meter('30000000-0000-0000-1092-00000000000c', 'wu_c', '2026-01-01 00:00', '2026-01-04 00:00', 3000);
update public.logger_reading
set value = value - 3000 - 0.1 * 216
where logger_code = 'wu_c' and reading_at >= pg_temp.ts('2026-01-02 12:00');

-- D: pressure, not volume.
insert into public.logger_reading (asset_id, logger_type, logger_code, reading_at, value, unit)
select '30000000-0000-0000-1092-00000000000d', 'HYDRUS', 'wu_d', g, 300, 'kPa'
from generate_series(pg_temp.ts('2026-01-01 00:00'), pg_temp.ts('2026-01-03 00:00'), interval '10 minutes') g;

select public.refresh_all_logger_daily_usage();

create temp view usage as
select a.code, u.day, u.usage, u.status
from public.logger_daily_usage u
join public.asset a on a.id = u.asset_id;

-- ============================================================================
-- The calculation
-- ============================================================================
select results_eq(
  $$ select day::text, usage, status from usage where code = 'WU-A' order by day $$,
  $$ values ('2026-01-01', 14.4, 'ok'), ('2026-01-02', 14.4, 'ok'), ('2026-01-03', 14.4, 'ok'), ('2026-01-04', 14.4, 'ok') $$,
  'A: 14.4 m³ a day; the second feed is left out; 5 Jan has no next midnight');

select results_eq(
  $$ select kind, readings from public.logger_usage_issue where asset_id = '30000000-0000-0000-1092-00000000000a' $$,
  $$ values ('duplicate', 73) $$,
  'A: the second feed is recorded as a duplicate');

select results_eq(
  $$ select day::text, usage, status from usage where code = 'WU-B' order by day $$,
  $$ values ('2026-01-01', 14.4, 'ok'), ('2026-01-02', 14.4, 'long_gap'), ('2026-01-03', 14.4, 'ok'),
            ('2026-01-04', 14.4, 'long_gap'), ('2026-01-05', 14.4, 'long_gap'), ('2026-01-06', 14.4, 'ok'),
            ('2026-01-07', 14.4, 'ok') $$,
  'B: the gap and the excursion are interpolated, so every day is still 14.4 m³');

select results_eq(
  $$ select kind, readings, from_at, to_at from public.logger_usage_issue where asset_id = '30000000-0000-0000-1092-00000000000b' $$,
  $$ values ('excursion', 144, pg_temp.ts('2026-01-04 12:10'), pg_temp.ts('2026-01-05 12:00')) $$,
  'B: the climb and fall back is recorded as an excursion, from where the climb began');

select is(
  (select fell_back_to from public.logger_usage_issue where asset_id = '30000000-0000-0000-1092-00000000000b'),
  2000 + 0.1 * (4 * 144 + 72 + 1), 'B: with the total it fell back to');

select results_eq(
  $$ select day::text, usage, status from usage where code = 'WU-C' order by day $$,
  $$ values ('2026-01-01', 14.4, 'ok'), ('2026-01-02', null::numeric, 'reset'), ('2026-01-03', 14.4, 'ok') $$,
  'C: no figure on the day the meter was replaced');

select results_eq(
  $$ select kind, low, high from public.logger_usage_issue where asset_id = '30000000-0000-0000-1092-00000000000c' $$,
  $$ values ('reset', 3000 + 0.1 * 215, 0::numeric) $$,
  'C: the reset is recorded with the totals either side');

select is((select count(*) from usage where code = 'WU-D'), 0::bigint, 'D: pressure readings have no usage');

-- ============================================================================
-- A pull refreshes the meter's days
-- ============================================================================
set local role service_role;
with run as (
  insert into public.logger_pull_run (trigger, range_start, range_end)
  values ('manual', pg_temp.ts('2026-01-10 00:00'), pg_temp.ts('2026-01-12 00:00'))
  returning id
)
insert into public.logger_pull_result (run_id, asset_id, logger_code, status, attempts, claimed_at)
select run.id, '30000000-0000-0000-1092-00000000000f', 'wu_f', 'running', 1, now() from run;

select is(
  public.record_logger_pull_result(
    (select id from public.logger_pull_result where logger_code = 'wu_f'), 'success', 'm^3',
    (select jsonb_agg(jsonb_build_object(
        'reading', (100 + 0.1 * k)::text,
        'reading_timestamp', to_char(timestamp '2026-01-10 00:00' + k * interval '10 minutes', 'YYYY-MM-DD HH24:MI:SS')))
     from generate_series(0, 288) k),
    200, null),
  289, 'the pull saves its readings');
reset role;

select results_eq(
  $$ select day::text, usage, status from usage where code = 'WU-F' order by day $$,
  $$ values ('2026-01-10', 14.4, 'ok'), ('2026-01-11', 14.4, 'ok') $$,
  'F: its days are filled as the pull is recorded');

-- ============================================================================
-- The report
-- ============================================================================
create temp table result (d jsonb);
grant all on result to authenticated;

select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-1092-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.water_usage_report('2026-01-01', '2026-01-31') $$,
  '42501', 'Only system admins can see logger data.', 'an admin cannot see the water usage report');
select is((select count(*) from public.logger_daily_usage), 0::bigint, 'nor read the daily usage');
reset role;

select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-1092-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.water_usage_report('2026-01-31', '2026-01-01') $$,
  '22023', null, 'the period must not end before it starts');
insert into result
select public.water_usage_report('2025-12-01', '2026-01-31', null, null, 'a2000000-0000-0000-1092-000000000001');
reset role;

select is(
  (select (d -> 'period') - 'today' from result),
  '{"from": "2025-12-01", "to": "2026-01-31", "first_day": "2026-01-01", "last_day": "2026-01-11"}'::jsonb,
  'the period is trimmed to the days with usage');

create temp view meters as
select m from result, jsonb_array_elements(d -> 'meters') m;

select is((select array_agg(m ->> 'name' order by m ->> 'name') from meters), array['WU A', 'WU B', 'WU C', 'WU F'],
  'one entry per meter at the site with usage');

select is(
  (select m - 'id' - 'location_id' from meters where m ->> 'name' = 'WU C'),
  jsonb_build_object(
    'name', 'WU C', 'code', 'WU-C', 'logger_code', 'wu_c', 'active', true,
    'location', 'WU-Plant', 'region', 'WU-North', 'organisation', 'WU-ORG', 'first_day', '2026-01-01',
    'usage', '[14.4, null, 14.4, null, null, null, null, null, null, null, null]'::jsonb,
    'status', 'oro--------'),
  'C: usage and status per day');
select is((select m ->> 'status' from meters where m ->> 'name' = 'WU B'), 'ogoggoo----', 'B: status per day');

select is(
  (select jsonb_agg(e - 'id' order by e ->> 'name') from result, jsonb_array_elements(d -> 'excluded') e),
  '[{"name": "WU E", "code": "WU-E", "location": "WU-Plant", "unit": null, "reason": "no_readings"}]'::jsonb,
  'loggers at the site without usage');

select is(
  (select array_agg(i ->> 'kind' order by i ->> 'from_at') from result, jsonb_array_elements(d -> 'issues') i),
  array['duplicate', 'reset', 'excursion'], 'the issues of the meters in scope');

-- Every site: D shows as not a volume meter.
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-1092-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select ok(
  public.water_usage_report('2026-01-01', '2026-01-31') -> 'excluded' @>
    '[{"name": "WU D", "unit": "kPa", "reason": "not_volume"}]'::jsonb,
  'without a site filter, a pressure logger elsewhere is listed as not a volume meter');
reset role;

-- ============================================================================
-- A new time zone recalculates every day
-- ============================================================================
update public.system_settings set time_zone = 'UTC' where id = 1;
select results_eq(
  $$ select day::text, usage from usage where code = 'WU-A' order by day $$,
  $$ values ('2026-01-01', 14.4), ('2026-01-02', 14.4), ('2026-01-03', 14.4) $$,
  'A: days now run midnight to midnight UTC');

select * from finish();
rollback;
