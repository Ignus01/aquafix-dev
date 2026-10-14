-- Tests for the borehole usage limit: the asset_usage_limit_check constraint
-- and water_borehole_matrix() (sums of borehole meters and their limits, day
-- status, access).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-1094-000000000001', '00000000-0000-0000-1094-000000000000', 'authenticated', 'authenticated',
   'wbm-sysadmin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1094-000000000002', '00000000-0000-0000-1094-000000000000', 'authenticated', 'authenticated',
   'wbm-admin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1094-000000000003', '00000000-0000-0000-1094-000000000000', 'authenticated', 'authenticated',
   'wbm-user@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1094-000000000004', '00000000-0000-0000-1094-000000000000', 'authenticated', 'authenticated',
   'wbm-viewer@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-1094-000000000001', 'system_admin'),
  ('10000000-0000-0000-1094-000000000002', 'admin'),
  ('10000000-0000-0000-1094-000000000003', 'user'),
  ('10000000-0000-0000-1094-000000000004', 'viewer');

create function pg_temp.as_user(p_n integer) returns void
language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub": "10000000-0000-0000-1094-00000000000%s", "role": "authenticated"}', p_n), true);
$$;

insert into public.region (id, name) values
  ('a0000000-0000-0000-1094-000000000001', 'WBM-North'),
  ('a0000000-0000-0000-1094-000000000002', 'WBM-South');
insert into public.organisation (id, name) values ('a1000000-0000-0000-1094-000000000001', 'WBM-ORG');
-- A: limits on every borehole. B: one borehole without a limit. C: inactive.
-- D: treated only. E: the other region.
insert into public.location (id, name, region_id, organisation_id, active) values
  ('a2000000-0000-0000-1094-00000000000a', 'WBM-A', 'a0000000-0000-0000-1094-000000000001', 'a1000000-0000-0000-1094-000000000001', true),
  ('a2000000-0000-0000-1094-00000000000b', 'WBM-B', 'a0000000-0000-0000-1094-000000000001', 'a1000000-0000-0000-1094-000000000001', true),
  ('a2000000-0000-0000-1094-00000000000c', 'WBM-C', 'a0000000-0000-0000-1094-000000000001', 'a1000000-0000-0000-1094-000000000001', false),
  ('a2000000-0000-0000-1094-00000000000d', 'WBM-D', 'a0000000-0000-0000-1094-000000000001', 'a1000000-0000-0000-1094-000000000001', true),
  ('a2000000-0000-0000-1094-00000000000e', 'WBM-E', 'a0000000-0000-0000-1094-000000000002', 'a1000000-0000-0000-1094-000000000001', true);
insert into public.asset_type (id, name) values ('a3000000-0000-0000-1094-000000000001', 'WBM-Meter');

insert into public.asset (id, name, code, asset_type_id, location_id, active, meter_type, usage_limit) values
  ('30000000-0000-0000-1094-0000000000a1', 'WBM BH1', 'WBM-BH1', 'a3000000-0000-0000-1094-000000000001', 'a2000000-0000-0000-1094-00000000000a', true, 'borehole', 100),
  ('30000000-0000-0000-1094-0000000000a2', 'WBM BH2', 'WBM-BH2', 'a3000000-0000-0000-1094-000000000001', 'a2000000-0000-0000-1094-00000000000a', true, 'borehole', 50),
  ('30000000-0000-0000-1094-0000000000a3', 'WBM BHI', 'WBM-BHI', 'a3000000-0000-0000-1094-000000000001', 'a2000000-0000-0000-1094-00000000000a', false, 'borehole', 10),
  ('30000000-0000-0000-1094-0000000000a4', 'WBM Treated', 'WBM-T', 'a3000000-0000-0000-1094-000000000001', 'a2000000-0000-0000-1094-00000000000a', true, 'treated', null),
  ('30000000-0000-0000-1094-0000000000a5', 'WBM Untyped', 'WBM-NT', 'a3000000-0000-0000-1094-000000000001', 'a2000000-0000-0000-1094-00000000000a', true, null, null),
  ('30000000-0000-0000-1094-0000000000b1', 'WBM BH3', 'WBM-BH3', 'a3000000-0000-0000-1094-000000000001', 'a2000000-0000-0000-1094-00000000000b', true, 'borehole', 40),
  ('30000000-0000-0000-1094-0000000000b2', 'WBM BH4', 'WBM-BH4', 'a3000000-0000-0000-1094-000000000001', 'a2000000-0000-0000-1094-00000000000b', true, 'borehole', null),
  ('30000000-0000-0000-1094-0000000000c1', 'WBM BH6', 'WBM-BH6', 'a3000000-0000-0000-1094-000000000001', 'a2000000-0000-0000-1094-00000000000c', true, 'borehole', 99),
  ('30000000-0000-0000-1094-0000000000d1', 'WBM D Treated', 'WBM-DT', 'a3000000-0000-0000-1094-000000000001', 'a2000000-0000-0000-1094-00000000000d', true, 'treated', null),
  ('30000000-0000-0000-1094-0000000000e1', 'WBM BH5', 'WBM-BH5', 'a3000000-0000-0000-1094-000000000001', 'a2000000-0000-0000-1094-00000000000e', true, 'borehole', 80);

-- Daily usage, 1–4 Jan 2026.
insert into public.logger_daily_usage (asset_id, day, usage, status)
select a::uuid, d::date, u, s
from (values
  -- BH1: 60 a day; estimated on the 3rd, a long gap on the 4th.
  ('30000000-0000-0000-1094-0000000000a1', '2026-01-01', 60, 'ok'),
  ('30000000-0000-0000-1094-0000000000a1', '2026-01-02', 60, 'ok'),
  ('30000000-0000-0000-1094-0000000000a1', '2026-01-03', 60, 'estimated'),
  ('30000000-0000-0000-1094-0000000000a1', '2026-01-04', 60, 'long_gap'),
  -- BH2: reset on the 2nd, nothing on the 4th.
  ('30000000-0000-0000-1094-0000000000a2', '2026-01-01', 50, 'ok'),
  ('30000000-0000-0000-1094-0000000000a2', '2026-01-02', null, 'reset'),
  ('30000000-0000-0000-1094-0000000000a2', '2026-01-03', 45, 'ok'),
  -- BHI (inactive): a figure on the 3rd only.
  ('30000000-0000-0000-1094-0000000000a3', '2026-01-03', 5, 'ok'),
  -- Treated and untyped meters: never counted.
  ('30000000-0000-0000-1094-0000000000a4', '2026-01-01', 500, 'ok'),
  ('30000000-0000-0000-1094-0000000000a5', '2026-01-01', 300, 'ok'),
  ('30000000-0000-0000-1094-0000000000b1', '2026-01-01', 30, 'ok'),
  ('30000000-0000-0000-1094-0000000000b1', '2026-01-02', 30, 'ok'),
  ('30000000-0000-0000-1094-0000000000b1', '2026-01-03', 30, 'ok'),
  ('30000000-0000-0000-1094-0000000000b1', '2026-01-04', 30, 'ok'),
  ('30000000-0000-0000-1094-0000000000b2', '2026-01-01', 20, 'ok'),
  ('30000000-0000-0000-1094-0000000000b2', '2026-01-02', 20, 'ok'),
  ('30000000-0000-0000-1094-0000000000b2', '2026-01-03', 20, 'ok'),
  ('30000000-0000-0000-1094-0000000000b2', '2026-01-04', 20, 'ok'),
  ('30000000-0000-0000-1094-0000000000c1', '2026-01-01', 99, 'ok'),
  ('30000000-0000-0000-1094-0000000000d1', '2026-01-01', 99, 'ok'),
  -- BH5: first figure on the 2nd.
  ('30000000-0000-0000-1094-0000000000e1', '2026-01-02', 80, 'ok'),
  ('30000000-0000-0000-1094-0000000000e1', '2026-01-03', 90.5, 'ok'),
  ('30000000-0000-0000-1094-0000000000e1', '2026-01-04', 70, 'ok')
) as x (a, d, u, s);

create temp table result (d jsonb);
grant all on result to authenticated;

-- ============================================================================
-- The matrix
-- ============================================================================
select pg_temp.as_user(1);
set local role authenticated;
insert into result select public.water_borehole_matrix('2026-01-01', '2026-01-04');
reset role;

create temp view locs as
select l from result, jsonb_array_elements(d -> 'locations') l;

select is(
  (select d -> 'days' from result),
  '["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]'::jsonb,
  'one column per day of the period');

select is(
  (select array_agg(l ->> 'name' order by ord) from result, jsonb_array_elements(d -> 'locations') with ordinality x (l, ord)),
  array['WBM-A', 'WBM-B', 'WBM-E'],
  'active locations with a borehole meter, by name; inactive and treated-only locations are left out');

select is(
  (select l -> 'usage' from locs where l ->> 'name' = 'WBM-A'),
  '[110, null, 110, null]'::jsonb,
  'A: the sum of its borehole meters; treated and untyped meters are not counted');
select is(
  (select l ->> 'status' from locs where l ->> 'name' = 'WBM-A'),
  'ore-',
  'A: estimated carries over; a reset or a missing meter leaves the day without a figure');
select is(
  (select (l -> 'meters')::int from locs where l ->> 'name' = 'WBM-A'), 3,
  'A: the inactive meter counts, on the day it has a figure');
select is(
  (select l -> 'meter_ids' from locs where l ->> 'name' = 'WBM-A'),
  '["30000000-0000-0000-1094-0000000000a1", "30000000-0000-0000-1094-0000000000a2", "30000000-0000-0000-1094-0000000000a3"]'::jsonb,
  'A: its borehole meters, by name');
select is(
  (select array[l -> 'limit', l -> 'unlimited'] from locs where l ->> 'name' = 'WBM-A'),
  array['160.00'::jsonb, '0'::jsonb],
  'A: the sum of its meters'' limits');

select is(
  (select l - 'id' - 'meter_ids' from locs where l ->> 'name' = 'WBM-B'),
  jsonb_build_object('name', 'WBM-B', 'region', 'WBM-North', 'limit', null, 'meters', 2, 'unlimited', 1,
    'usage', '[50, 50, 50, 50]'::jsonb, 'status', 'oooo'),
  'B: a borehole without a limit leaves the site without one');

select is(
  (select array[l -> 'usage', to_jsonb(l ->> 'status'), l -> 'limit'] from locs where l ->> 'name' = 'WBM-E'),
  array['[null, 80, 90.5, 70]'::jsonb, '"-ooo"'::jsonb, '80.00'::jsonb],
  'E: no figure before its meter''s first day');

-- Filters.
select pg_temp.as_user(1);
set local role authenticated;
select is(
  (select array_agg(l ->> 'name') from jsonb_array_elements(
    public.water_borehole_matrix('2026-01-01', '2026-01-04', 'a0000000-0000-0000-1094-000000000002') -> 'locations') l),
  array['WBM-E'], 'the region filter applies');
select is(
  (select array_agg(l ->> 'name') from jsonb_array_elements(
    public.water_borehole_matrix('2026-01-01', '2026-01-04', null, null, 'a2000000-0000-0000-1094-00000000000b') -> 'locations') l),
  array['WBM-B'], 'the site filter applies');
select is(
  public.water_borehole_matrix('2026-01-01', '2026-01-04', null, null, 'a2000000-0000-0000-1094-00000000000d') -> 'locations',
  '[]'::jsonb, 'a site with only treated meters is not listed');
select throws_ok(
  $$ select public.water_borehole_matrix('2026-01-04', '2026-01-01') $$,
  '22023', null, 'the period must not end before it starts');
reset role;

-- Today is never shown.
insert into public.logger_daily_usage (asset_id, day, usage, status)
select '30000000-0000-0000-1094-0000000000e1', public.app_today() - k, 50, 'ok' from generate_series(0, 2) k;

select pg_temp.as_user(1);
set local role authenticated;
select is(
  public.water_borehole_matrix(public.app_today() - 2, public.app_today() + 3, null, null, 'a2000000-0000-0000-1094-00000000000e')
    -> 'days',
  jsonb_build_array(public.app_today() - 2, public.app_today() - 1),
  'a period that includes today ends yesterday');
select is(
  public.water_borehole_matrix(public.app_today(), public.app_today() + 3) -> 'days', '[]'::jsonb,
  'a period of today and later has no days');
reset role;

-- ============================================================================
-- Access
-- ============================================================================
select pg_temp.as_user(2);
set local role authenticated;
select is(
  public.water_borehole_matrix('2026-01-01', '2026-01-04') -> 'locations',
  (select d -> 'locations' from result),
  'an admin sees the same matrix');
reset role;

select pg_temp.as_user(3);
set local role authenticated;
select throws_ok(
  $$ select public.water_borehole_matrix('2026-01-01', '2026-01-04') $$,
  '42501', 'Only system admins and admins can see water usage.', 'a user is refused');
reset role;

select pg_temp.as_user(4);
set local role authenticated;
select throws_ok(
  $$ select public.water_borehole_matrix('2026-01-01', '2026-01-04') $$,
  '42501', 'Only system admins and admins can see water usage.', 'a viewer is refused');
reset role;

-- ============================================================================
-- asset_usage_limit_check
-- ============================================================================
select throws_ok(
  $$ update public.asset set usage_limit = 10 where id = '30000000-0000-0000-1094-0000000000a4' $$,
  '23514', null, 'a treated meter can''t have a limit');
select throws_ok(
  $$ update public.asset set usage_limit = 10 where id = '30000000-0000-0000-1094-0000000000a5' $$,
  '23514', null, 'nor can a meter without a type');
select throws_ok(
  $$ update public.asset set usage_limit = 0 where id = '30000000-0000-0000-1094-0000000000a1' $$,
  '23514', null, 'a limit of 0 is refused');
select throws_ok(
  $$ update public.asset set usage_limit = -5 where id = '30000000-0000-0000-1094-0000000000a1' $$,
  '23514', null, 'a negative limit is refused');
select throws_ok(
  $$ update public.asset set meter_type = 'treated' where id = '30000000-0000-0000-1094-0000000000a1' $$,
  '23514', null, 'a borehole can''t become a treated meter and keep its limit');
select lives_ok(
  $$ update public.asset set meter_type = 'treated', usage_limit = null where id = '30000000-0000-0000-1094-0000000000a1' $$,
  'it can once the limit is cleared');

select * from finish();
rollback;
