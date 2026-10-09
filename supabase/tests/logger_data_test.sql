-- Tests for logger data: the asset logger type rule, starting runs (daily and
-- manual), the worker's claim/record cycle, overwrite on the same logger and
-- time, retries, RLS and the Hydrus password.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-1090-000000000001', '00000000-0000-0000-1090-000000000000', 'authenticated', 'authenticated',
   'l-sysadmin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1090-000000000002', '00000000-0000-0000-1090-000000000000', 'authenticated', 'authenticated',
   'l-admin@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-1090-000000000001', 'system_admin'),
  ('10000000-0000-0000-1090-000000000002', 'admin');

insert into public.region (id, name) values ('a0000000-0000-0000-1090-000000000001', 'L-North');
insert into public.organisation (id, name) values ('a1000000-0000-0000-1090-000000000001', 'L-ORG');
insert into public.location (id, name, region_id, organisation_id)
values ('a2000000-0000-0000-1090-000000000001', 'L-Plant', 'a0000000-0000-0000-1090-000000000001', 'a1000000-0000-0000-1090-000000000001');
insert into public.asset_type (id, name) values ('a3000000-0000-0000-1090-000000000001', 'L-Meter');

-- Pulled: L1, L2. Not pulled: inactive L3, Datav8 L4, L5 without a logger.
insert into public.asset (id, name, code, asset_type_id, location_id, active, logger_code, logger_type) values
  ('30000000-0000-0000-1090-000000000001', 'Meter 1', 'L-1', 'a3000000-0000-0000-1090-000000000001', 'a2000000-0000-0000-1090-000000000001', true, 'hy_1', 'HYDRUS'),
  ('30000000-0000-0000-1090-000000000002', 'Meter 2', 'L-2', 'a3000000-0000-0000-1090-000000000001', 'a2000000-0000-0000-1090-000000000001', true, 'hy_2', 'HYDRUS'),
  ('30000000-0000-0000-1090-000000000003', 'Meter 3', 'L-3', 'a3000000-0000-0000-1090-000000000001', 'a2000000-0000-0000-1090-000000000001', false, 'hy_3', 'HYDRUS'),
  ('30000000-0000-0000-1090-000000000004', 'Meter 4', 'L-4', 'a3000000-0000-0000-1090-000000000001', 'a2000000-0000-0000-1090-000000000001', true, 'dv_4', 'DATAV8'),
  ('30000000-0000-0000-1090-000000000005', 'Meter 5', 'L-5', 'a3000000-0000-0000-1090-000000000001', 'a2000000-0000-0000-1090-000000000001', true, null, null);

-- Only this test's assets take part in "all loggers" runs.
update public.asset set active = false
where logger_code is not null and id::text not like '30000000-0000-0000-1090-%';

create temp table ids (name text primary key, id bigint);
grant all on ids to authenticated, service_role;
grant usage on schema extensions to authenticated, service_role;

-- ============================================================================
-- Asset: logger type goes with the logger code
-- ============================================================================
select throws_ok(
  $$ update public.asset set logger_type = null where id = '30000000-0000-0000-1090-000000000001' $$,
  '23514', null, 'a logger code needs a logger type');
select throws_ok(
  $$ update public.asset set logger_type = 'HYDRUS' where id = '30000000-0000-0000-1090-000000000005' $$,
  '23514', null, 'a logger type needs a logger code');

-- ============================================================================
-- Manual pull: who and what
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-1090-000000000002", "role": "authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$ select public.request_logger_pull(now() - interval '1 day', now()) $$,
  '42501', 'Only system admins can pull logger data.', 'admin (not system admin) cannot pull');
select is((select count(*) from public.logger_reading), 0::bigint, 'admin cannot read logger data (RLS)');

select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-1090-000000000001", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.request_logger_pull(now() - interval '8 days', now()) $$,
  'P0001', 'A pull can cover at most 7 days.', 'at most 7 days');
select throws_ok(
  $$ select public.request_logger_pull(now(), now() - interval '1 hour') $$,
  'P0001', 'The end time must be after the start time.', 'end after start');
select throws_ok(
  $$ select public.request_logger_pull(now() + interval '1 hour', now() + interval '2 hours') $$,
  'P0001', 'The start time must be in the past.', 'start in the past');
select throws_ok(
  $$ select public.request_logger_pull(now() - interval '1 day', now(),
       array['30000000-0000-0000-1090-000000000004']::uuid[]) $$,
  'P0001', 'Not an active Hydrus logger: Meter 4.', 'a picked Datav8 asset is refused');
select throws_ok(
  $$ select public.request_logger_pull(now() - interval '1 day', now(),
       array['30000000-0000-0000-1090-000000000003']::uuid[]) $$,
  'P0001', 'Not an active Hydrus logger: Meter 3.', 'a picked inactive asset is refused');

insert into ids values ('manual_all', public.request_logger_pull(now() - interval '7 days', now()));
select is(
  (select array_agg(logger_code order by logger_code) from public.logger_pull_result
   where run_id = (select id from ids where name = 'manual_all')),
  array['hy_1', 'hy_2'],
  'all loggers = active Hydrus assets with a logger code');
select is(
  (select status from public.logger_pull_run_overview where id = (select id from ids where name = 'manual_all')),
  'running', 'a queued run is running');

insert into ids values ('manual_one', public.request_logger_pull(now() - interval '1 day', now(),
  array['30000000-0000-0000-1090-000000000002']::uuid[]));
select is(
  (select array_agg(logger_code) from public.logger_pull_result
   where run_id = (select id from ids where name = 'manual_one')),
  array['hy_2'], 'a pull of selected assets queues only those');

-- ============================================================================
-- Worker: claim and record
-- ============================================================================
reset role;
set local role service_role;

create temp table claimed as select * from public.claim_logger_pull_results(10);
select is((select count(*) from claimed), 3::bigint, 'the worker claims every due logger');
select is(
  (select range_end - range_start from claimed
   where run_id = (select id from ids where name = 'manual_all') limit 1),
  7 * 86400::bigint, 'the claim carries the range as Unix seconds');
select is((select count(*) from public.claim_logger_pull_results(10)), 0::bigint, 'claimed loggers are not claimed twice');

-- hy_1 in the 7-day run: two good readings, one duplicate time, one bad value.
select is(
  public.record_logger_pull_result(
    (select id from claimed where logger_code = 'hy_1'), 'success', 'kPa',
    '[{"reading": "307.4", "reading_timestamp": "2022-07-08 13:50:00"},
      {"reading": "309.43", "reading_timestamp": "2022-07-08 13:40:00"},
      {"reading": "309.43", "reading_timestamp": "2022-07-08 13:40:00"},
      {"reading": "n/a", "reading_timestamp": "2022-07-08 13:30:00"}]'::jsonb,
    200, null),
  2, 'good readings are saved, duplicates and bad values skipped');
select is(
  (select reading_at from public.logger_reading where logger_code = 'hy_1' and value = 307.4),
  '2022-07-08 11:50:00+00'::timestamptz, 'Hydrus times are read as SAST');
select is(
  (select unit from public.logger_reading where logger_code = 'hy_1' and value = 307.4),
  'kPa', 'the unit is stored on the reading');
select matches(
  (select error from public.logger_pull_result where id = (select id from claimed where logger_code = 'hy_1')),
  '^2 of 4 readings skipped', 'skipped readings are noted on the result');

-- hy_2 in the 7-day run fails for good.
select is(
  public.record_logger_pull_result(
    (select id from claimed where logger_code = 'hy_2' and run_id = (select id from ids where name = 'manual_all')),
    'failed', null, null, 200, 'Hydrus rejected the logger code or password.'),
  0, 'a failure saves nothing');
select is(
  (select status from public.logger_pull_run_overview where id = (select id from ids where name = 'manual_all')),
  'partial', 'a run with successes and failures is partial');
select isnt(
  (select finished_at from public.logger_pull_run where id = (select id from ids where name = 'manual_all')),
  null, 'the run is finished once no logger is pending');

-- hy_2 in the one-asset run: transient errors retry, then fail.
select public.record_logger_pull_result(
  (select id from claimed where run_id = (select id from ids where name = 'manual_one')),
  'retry', null, null, 503, 'Hydrus answered HTTP 503.');
select is(
  (select status from public.logger_pull_result where run_id = (select id from ids where name = 'manual_one')),
  'pending', 'a transient error is retried');
select is(
  (select next_attempt_at - now() from public.logger_pull_result where run_id = (select id from ids where name = 'manual_one')),
  interval '1 minute', 'the first retry waits 1 minute');

reset role;
update public.logger_pull_result set next_attempt_at = now() where run_id = (select id from ids where name = 'manual_one');
set local role service_role;
select public.record_logger_pull_result(id, 'retry', null, null, 503, 'Hydrus answered HTTP 503.')
from public.claim_logger_pull_results(10);
reset role;
update public.logger_pull_result set next_attempt_at = now() where run_id = (select id from ids where name = 'manual_one');
set local role service_role;
select public.record_logger_pull_result(id, 'retry', null, null, 503, 'Hydrus answered HTTP 503.')
from public.claim_logger_pull_results(10);
select is(
  (select status || '/' || attempts from public.logger_pull_result where run_id = (select id from ids where name = 'manual_one')),
  'failed/3', 'after the 3rd attempt a transient error fails');
select is(
  (select status from public.logger_pull_run_overview where id = (select id from ids where name = 'manual_one')),
  'failed', 'a run where every logger failed is failed');

-- ============================================================================
-- Daily run, and pulling the same reading again overwrites it
-- ============================================================================
select public.run_daily_logger_pull();
select public.run_daily_logger_pull();
select is(
  (select count(*) from public.logger_pull_run where trigger = 'cron' and created_at = now()),
  1::bigint, 'the daily run is created once per window');
select is(
  (select to_char(range_end at time zone 'Africa/Johannesburg', 'HH24:MI') || ' ' || extract(epoch from range_end - range_start)::integer::text
   from public.logger_pull_run where trigger = 'cron' and created_at = now()),
  '06:00 86400', 'the daily window is the 24 hours up to 06:00 SAST');
select ok(
  (select range_end <= now() and range_end > now() - interval '1 day'
   from public.logger_pull_run where trigger = 'cron' and created_at = now()),
  'the daily window ends at the latest 06:00 SAST');

select public.record_logger_pull_result(c.id, 'success', 'bar',
  '[{"reading": "1.5", "reading_timestamp": "2022-07-08 13:50:00"}]'::jsonb, 200, null)
from public.claim_logger_pull_results(10) c
where c.logger_code = 'hy_1';
select is(
  (select count(*) || ' ' || max(value) || ' ' || max(unit) from public.logger_reading
   where logger_code = 'hy_1' and reading_at = '2022-07-08 11:50:00+00'),
  '1 1.5 bar', 'the same logger and time is overwritten, not duplicated');

-- ============================================================================
-- Deleting an asset with logger data is blocked
-- ============================================================================
reset role;
select throws_ok(
  $$ delete from public.asset where id = '30000000-0000-0000-1090-000000000001' $$,
  '23503', null, 'an asset with logger data cannot be deleted');

-- ============================================================================
-- Hydrus password
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-1090-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.set_hydrus_password('secret') $$,
  '42501', null, 'only system admins can set the Hydrus password');

select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-1090-000000000001", "role": "authenticated"}', true);
select throws_ok($$ select public.set_hydrus_password('  ') $$, 'P0001', 'Enter the password.', 'blank password refused');
select lives_ok($$ select public.set_hydrus_password('s3cret pass') $$, 'system admin sets the password');
select throws_ok($$ select public.get_logger_config() $$, '42501', null, 'the password is not readable by users');

reset role;
set local role service_role;
select is(public.get_logger_config() ->> 'hydrus_password', 's3cret pass', 'the worker reads the password');

reset role;
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-1090-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.remove_hydrus_password() $$, 'system admin removes the password');
reset role;
set local role service_role;
select is(public.get_logger_config() ->> 'hydrus_password', '', 'no password = empty password');

select * from finish();
rollback;
