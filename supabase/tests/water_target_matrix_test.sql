-- Tests for the location volume target: save_location_target() and
-- water_target_matrix() (sums of treated meters, band data, day status,
-- access).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-1093-000000000001', '00000000-0000-0000-1093-000000000000', 'authenticated', 'authenticated',
   'wtm-sysadmin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1093-000000000002', '00000000-0000-0000-1093-000000000000', 'authenticated', 'authenticated',
   'wtm-admin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1093-000000000003', '00000000-0000-0000-1093-000000000000', 'authenticated', 'authenticated',
   'wtm-user@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1093-000000000004', '00000000-0000-0000-1093-000000000000', 'authenticated', 'authenticated',
   'wtm-viewer@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-1093-000000000001', 'system_admin'),
  ('10000000-0000-0000-1093-000000000002', 'admin'),
  ('10000000-0000-0000-1093-000000000003', 'user'),
  ('10000000-0000-0000-1093-000000000004', 'viewer');

create function pg_temp.as_user(p_n integer) returns void
language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub": "10000000-0000-0000-1093-00000000000%s", "role": "authenticated"}', p_n), true);
$$;

insert into public.region (id, name) values
  ('a0000000-0000-0000-1093-000000000001', 'WTM-North'),
  ('a0000000-0000-0000-1093-000000000002', 'WTM-South');
insert into public.organisation (id, name) values ('a1000000-0000-0000-1093-000000000001', 'WTM-ORG');
-- A: target with the default bands. B: no target. C: inactive. D: borehole
-- only. E: its own bands, in the other region.
insert into public.location (id, name, region_id, organisation_id, active, volume_target) values
  ('a2000000-0000-0000-1093-00000000000a', 'WTM-A', 'a0000000-0000-0000-1093-000000000001', 'a1000000-0000-0000-1093-000000000001', true, 120),
  ('a2000000-0000-0000-1093-00000000000b', 'WTM-B', 'a0000000-0000-0000-1093-000000000001', 'a1000000-0000-0000-1093-000000000001', true, null),
  ('a2000000-0000-0000-1093-00000000000c', 'WTM-C', 'a0000000-0000-0000-1093-000000000001', 'a1000000-0000-0000-1093-000000000001', false, 100),
  ('a2000000-0000-0000-1093-00000000000d', 'WTM-D', 'a0000000-0000-0000-1093-000000000001', 'a1000000-0000-0000-1093-000000000001', true, 100),
  ('a2000000-0000-0000-1093-00000000000e', 'WTM-E', 'a0000000-0000-0000-1093-000000000002', 'a1000000-0000-0000-1093-000000000001', true, 80);
insert into public.location_target_band (location_id, from_pct, colour, label) values
  ('a2000000-0000-0000-1093-00000000000a', 110, 'blue', 'Above target'),
  ('a2000000-0000-0000-1093-00000000000a', 90, 'green', 'On target'),
  ('a2000000-0000-0000-1093-00000000000a', 80, 'orange', 'Below target'),
  ('a2000000-0000-0000-1093-00000000000a', 0, 'red', 'Well below target'),
  ('a2000000-0000-0000-1093-00000000000e', 100, 'green', null),
  ('a2000000-0000-0000-1093-00000000000e', 95, 'orange', null),
  ('a2000000-0000-0000-1093-00000000000e', 0, 'red', null);
insert into public.asset_type (id, name) values ('a3000000-0000-0000-1093-000000000001', 'WTM-Meter');

insert into public.asset (id, name, code, asset_type_id, location_id, active, meter_type) values
  ('30000000-0000-0000-1093-0000000000a1', 'WTM T1', 'WTM-T1', 'a3000000-0000-0000-1093-000000000001', 'a2000000-0000-0000-1093-00000000000a', true, 'treated'),
  ('30000000-0000-0000-1093-0000000000a2', 'WTM T2', 'WTM-T2', 'a3000000-0000-0000-1093-000000000001', 'a2000000-0000-0000-1093-00000000000a', true, 'treated'),
  ('30000000-0000-0000-1093-0000000000a3', 'WTM TI', 'WTM-TI', 'a3000000-0000-0000-1093-000000000001', 'a2000000-0000-0000-1093-00000000000a', false, 'treated'),
  ('30000000-0000-0000-1093-0000000000a4', 'WTM Borehole', 'WTM-BH', 'a3000000-0000-0000-1093-000000000001', 'a2000000-0000-0000-1093-00000000000a', true, 'borehole'),
  ('30000000-0000-0000-1093-0000000000a5', 'WTM Untyped', 'WTM-NT', 'a3000000-0000-0000-1093-000000000001', 'a2000000-0000-0000-1093-00000000000a', true, null),
  ('30000000-0000-0000-1093-0000000000b1', 'WTM T3', 'WTM-T3', 'a3000000-0000-0000-1093-000000000001', 'a2000000-0000-0000-1093-00000000000b', true, 'treated'),
  ('30000000-0000-0000-1093-0000000000c1', 'WTM T4', 'WTM-T4', 'a3000000-0000-0000-1093-000000000001', 'a2000000-0000-0000-1093-00000000000c', true, 'treated'),
  ('30000000-0000-0000-1093-0000000000d1', 'WTM D Borehole', 'WTM-DBH', 'a3000000-0000-0000-1093-000000000001', 'a2000000-0000-0000-1093-00000000000d', true, 'borehole'),
  ('30000000-0000-0000-1093-0000000000e1', 'WTM T5', 'WTM-T5', 'a3000000-0000-0000-1093-000000000001', 'a2000000-0000-0000-1093-00000000000e', true, 'treated');

-- Daily usage, 1–6 Jan 2026.
insert into public.logger_daily_usage (asset_id, day, usage, status)
select a::uuid, d::date, u, s
from (values
  -- T1: 60 a day; estimated on the 3rd, a long gap on the 5th.
  ('30000000-0000-0000-1093-0000000000a1', '2026-01-01', 60, 'ok'),
  ('30000000-0000-0000-1093-0000000000a1', '2026-01-02', 60, 'ok'),
  ('30000000-0000-0000-1093-0000000000a1', '2026-01-03', 60, 'estimated'),
  ('30000000-0000-0000-1093-0000000000a1', '2026-01-04', 60, 'ok'),
  ('30000000-0000-0000-1093-0000000000a1', '2026-01-05', 60, 'long_gap'),
  ('30000000-0000-0000-1093-0000000000a1', '2026-01-06', 60, 'ok'),
  -- T2: reset on the 4th, nothing on the 6th.
  ('30000000-0000-0000-1093-0000000000a2', '2026-01-01', 75, 'ok'),
  ('30000000-0000-0000-1093-0000000000a2', '2026-01-02', 58, 'ok'),
  ('30000000-0000-0000-1093-0000000000a2', '2026-01-03', 40, 'ok'),
  ('30000000-0000-0000-1093-0000000000a2', '2026-01-04', null, 'reset'),
  ('30000000-0000-0000-1093-0000000000a2', '2026-01-05', 30, 'ok'),
  -- TI (inactive): a figure on the 3rd only.
  ('30000000-0000-0000-1093-0000000000a3', '2026-01-03', 5, 'ok'),
  -- Borehole and untyped meters: never counted.
  ('30000000-0000-0000-1093-0000000000a4', '2026-01-01', 500, 'ok'),
  ('30000000-0000-0000-1093-0000000000a4', '2026-01-02', 500, 'ok'),
  ('30000000-0000-0000-1093-0000000000a5', '2026-01-01', 300, 'ok'),
  ('30000000-0000-0000-1093-0000000000a5', '2026-01-02', 300, 'ok'),
  ('30000000-0000-0000-1093-0000000000b1', '2026-01-01', 40, 'ok'),
  ('30000000-0000-0000-1093-0000000000b1', '2026-01-02', 42, 'ok'),
  ('30000000-0000-0000-1093-0000000000b1', '2026-01-03', 38, 'ok'),
  ('30000000-0000-0000-1093-0000000000b1', '2026-01-04', 41, 'ok'),
  ('30000000-0000-0000-1093-0000000000b1', '2026-01-05', 39, 'ok'),
  ('30000000-0000-0000-1093-0000000000b1', '2026-01-06', 44, 'ok'),
  ('30000000-0000-0000-1093-0000000000c1', '2026-01-01', 99, 'ok'),
  ('30000000-0000-0000-1093-0000000000d1', '2026-01-01', 99, 'ok'),
  -- T5: installed mid-period, first figure on the 4th.
  ('30000000-0000-0000-1093-0000000000e1', '2026-01-04', 82, 'ok'),
  ('30000000-0000-0000-1093-0000000000e1', '2026-01-05', 77, 'ok'),
  ('30000000-0000-0000-1093-0000000000e1', '2026-01-06', 60.5, 'ok')
) as x (a, d, u, s);

insert into public.logger_reading (asset_id, logger_type, logger_code, reading_at, value, unit)
values ('30000000-0000-0000-1093-0000000000a1', 'HYDRUS', 'wtm_t1', now(), 1, 'm^3');

create temp table result (d jsonb);
grant all on result to authenticated;

-- ============================================================================
-- The matrix
-- ============================================================================
select pg_temp.as_user(1);
set local role authenticated;
insert into result select public.water_target_matrix('2026-01-01', '2026-01-06');
reset role;

create temp view locs as
select l from result, jsonb_array_elements(d -> 'locations') l;

select is(
  (select d -> 'days' from result),
  '["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"]'::jsonb,
  'one column per day of the period');

select is(
  (select array_agg(l ->> 'name' order by ord) from result, jsonb_array_elements(d -> 'locations') with ordinality x (l, ord)),
  array['WTM-A', 'WTM-B', 'WTM-E'],
  'active locations with a treated meter, by name; inactive and borehole-only locations are left out');

select is(
  (select l -> 'usage' from locs where l ->> 'name' = 'WTM-A'),
  '[135, 118, 105, null, 90, null]'::jsonb,
  'A: the sum of its treated meters; borehole and untyped meters are not counted');
select is(
  (select l ->> 'status' from locs where l ->> 'name' = 'WTM-A'),
  'ooerg-',
  'A: estimated and long gap carry over; a reset or a missing meter leaves the day without a figure');
select is(
  (select (l -> 'meters')::int from locs where l ->> 'name' = 'WTM-A'), 3,
  'A: the inactive meter counts, on the day it has a figure');
select is(
  (select l -> 'meter_ids' from locs where l ->> 'name' = 'WTM-A'),
  '["30000000-0000-0000-1093-0000000000a1", "30000000-0000-0000-1093-0000000000a2", "30000000-0000-0000-1093-0000000000a3"]'::jsonb,
  'A: its treated meters, by name');
select is(
  (select l -> 'target' from locs where l ->> 'name' = 'WTM-A'), '120.00'::jsonb, 'A: the target');
select is(
  (select l -> 'bands' from locs where l ->> 'name' = 'WTM-A'),
  '[{"from_pct": 110, "colour": "blue", "label": "Above target"},
    {"from_pct": 90, "colour": "green", "label": "On target"},
    {"from_pct": 80, "colour": "orange", "label": "Below target"},
    {"from_pct": 0, "colour": "red", "label": "Well below target"}]'::jsonb,
  'A: its bands, highest first');

select is(
  (select l - 'id' - 'meter_ids' from locs where l ->> 'name' = 'WTM-B'),
  jsonb_build_object('name', 'WTM-B', 'region', 'WTM-North', 'target', null, 'bands', '[]'::jsonb, 'meters', 1,
    'usage', '[40, 42, 38, 41, 39, 44]'::jsonb, 'status', 'oooooo'),
  'B: figures without a target or bands');

select is(
  (select array[l -> 'usage', to_jsonb(l ->> 'status')] from locs where l ->> 'name' = 'WTM-E'),
  array['[null, null, null, 82, 77, 60.5]'::jsonb, '"---ooo"'::jsonb],
  'E: no figure before its meter''s first day');
select is(
  (select l -> 'bands' from locs where l ->> 'name' = 'WTM-E'),
  '[{"from_pct": 100, "colour": "green", "label": null},
    {"from_pct": 95, "colour": "orange", "label": null},
    {"from_pct": 0, "colour": "red", "label": null}]'::jsonb,
  'E: its own bands');

-- Filters.
select pg_temp.as_user(1);
set local role authenticated;
select is(
  (select array_agg(l ->> 'name') from jsonb_array_elements(
    public.water_target_matrix('2026-01-01', '2026-01-06', 'a0000000-0000-0000-1093-000000000002') -> 'locations') l),
  array['WTM-E'], 'the region filter applies');
select is(
  (select array_agg(l ->> 'name') from jsonb_array_elements(
    public.water_target_matrix('2026-01-01', '2026-01-06', null, null, 'a2000000-0000-0000-1093-00000000000b') -> 'locations') l),
  array['WTM-B'], 'the site filter applies');
select throws_ok(
  $$ select public.water_target_matrix('2026-01-06', '2026-01-01') $$,
  '22023', null, 'the period must not end before it starts');
reset role;

-- Today is never shown.
insert into public.logger_daily_usage (asset_id, day, usage, status)
select '30000000-0000-0000-1093-0000000000b1', public.app_today() - k, 50, 'ok' from generate_series(0, 2) k;

select pg_temp.as_user(1);
set local role authenticated;
select is(
  public.water_target_matrix(public.app_today() - 2, public.app_today() + 3, null, null, 'a2000000-0000-0000-1093-00000000000b')
    -> 'days',
  jsonb_build_array(public.app_today() - 2, public.app_today() - 1),
  'a period that includes today ends yesterday');
select is(
  public.water_target_matrix(public.app_today(), public.app_today() + 3) -> 'days', '[]'::jsonb,
  'a period of today and later has no days');
reset role;

-- ============================================================================
-- Access
-- ============================================================================
select pg_temp.as_user(2);
set local role authenticated;
select is(
  public.water_target_matrix('2026-01-01', '2026-01-06') -> 'locations',
  (select d -> 'locations' from result),
  'an admin sees the same matrix');
select ok((select count(*) from public.logger_daily_usage) > 0, 'an admin can read the daily usage');
select is((select count(*) from public.logger_reading), 0::bigint, 'but not the raw readings');
reset role;

select pg_temp.as_user(3);
set local role authenticated;
select throws_ok(
  $$ select public.water_target_matrix('2026-01-01', '2026-01-06') $$,
  '42501', 'Only system admins and admins can see water usage.', 'a user is refused');
select is((select count(*) from public.logger_daily_usage), 0::bigint, 'a user cannot read the daily usage');
reset role;

select pg_temp.as_user(4);
set local role authenticated;
select throws_ok(
  $$ select public.water_target_matrix('2026-01-01', '2026-01-06') $$,
  '42501', 'Only system admins and admins can see water usage.', 'a viewer is refused');
reset role;

-- ============================================================================
-- save_location_target
-- ============================================================================
create function pg_temp.bands_of(p_location uuid) returns text
language sql as $$
  select string_agg(format('%s %s %s', from_pct, colour, coalesce(label, '-')), ', ' order by from_pct desc)
  from public.location_target_band where location_id = p_location;
$$;

select pg_temp.as_user(3);
set local role authenticated;
select lives_ok(
  $$ select public.save_location_target('a2000000-0000-0000-1093-00000000000b', 50,
       '[{"from_pct": 110, "colour": "blue", "label": "Above target"},
         {"from_pct": 90, "colour": "green", "label": " On target "},
         {"from_pct": 0, "colour": "red", "label": ""}]') $$,
  'a user can set a target with its bands');
reset role;
select is((select volume_target from public.location where id = 'a2000000-0000-0000-1093-00000000000b'), 50.00,
  'the target is saved');
select is(pg_temp.bands_of('a2000000-0000-0000-1093-00000000000b'),
  '110.00 blue Above target, 90.00 green On target, 0.00 red -', 'the bands are saved, labels trimmed');

select pg_temp.as_user(3);
set local role authenticated;
select throws_ok(
  $$ select public.save_location_target('a2000000-0000-0000-1093-00000000000b', 0,
       '[{"from_pct": 0, "colour": "red"}]') $$,
  '22023', 'The daily volume target must be more than 0 m³.', 'a target of 0 is refused');
select throws_ok(
  $$ select public.save_location_target('a2000000-0000-0000-1093-00000000000b', -5,
       '[{"from_pct": 0, "colour": "red"}]') $$,
  '22023', null, 'a negative target is refused');
select throws_ok(
  $$ select public.save_location_target('a2000000-0000-0000-1093-00000000000b', 60, '[]') $$,
  '22023', 'Add colour bands for the target.', 'a target needs bands');
select throws_ok(
  $$ select public.save_location_target('a2000000-0000-0000-1093-00000000000b', 60,
       '[{"from_pct": 90, "colour": "green"}, {"from_pct": 50, "colour": "red"}]') $$,
  '22023', 'Add a colour band from 0%, so every value has a colour.', 'the bands need one at 0%');
select throws_ok(
  $$ select public.save_location_target('a2000000-0000-0000-1093-00000000000b', 60,
       '[{"from_pct": 90, "colour": "green"}, {"from_pct": 90.00, "colour": "blue"}, {"from_pct": 0, "colour": "red"}]') $$,
  '22023', 'Two colour bands start at the same %.', 'no two bands with the same From');
select throws_ok(
  $$ select public.save_location_target('a2000000-0000-0000-1093-00000000000b', 60,
       '[{"from_pct": 0, "colour": "red"}, {"from_pct": 10, "colour": "red"}, {"from_pct": 20, "colour": "red"},
         {"from_pct": 30, "colour": "red"}, {"from_pct": 40, "colour": "red"}, {"from_pct": 50, "colour": "red"},
         {"from_pct": 60, "colour": "red"}]') $$,
  '22023', 'A location can have at most 6 colour bands.', 'at most 6 bands');
select throws_ok(
  $$ select public.save_location_target('a2000000-0000-0000-1093-00000000000b', 60,
       '[{"from_pct": 0, "colour": "purple"}]') $$,
  '22023', null, 'only the five colours');
select throws_ok(
  $$ update public.location set volume_target = 0 where id = 'a2000000-0000-0000-1093-00000000000b' $$,
  '23514', null, 'the table refuses a target of 0 too');
reset role;
select is(
  array[(select volume_target from public.location where id = 'a2000000-0000-0000-1093-00000000000b')::text,
        pg_temp.bands_of('a2000000-0000-0000-1093-00000000000b')],
  array['50.00', '110.00 blue Above target, 90.00 green On target, 0.00 red -'],
  'a refused save changes neither the target nor the bands');

select pg_temp.as_user(3);
set local role authenticated;
select lives_ok(
  $$ select public.save_location_target('a2000000-0000-0000-1093-00000000000b', null, null) $$,
  'the target can be cleared');
reset role;
select is(
  array[(select volume_target from public.location where id = 'a2000000-0000-0000-1093-00000000000b')::text,
        pg_temp.bands_of('a2000000-0000-0000-1093-00000000000b')],
  array[null, '110.00 blue Above target, 90.00 green On target, 0.00 red -'],
  'clearing the target keeps the bands');

select pg_temp.as_user(4);
set local role authenticated;
select throws_ok(
  $$ select public.save_location_target('a2000000-0000-0000-1093-00000000000b', 60,
       '[{"from_pct": 0, "colour": "red"}]') $$,
  '42501', null, 'a viewer cannot set a target');
reset role;
select is((select volume_target from public.location where id = 'a2000000-0000-0000-1093-00000000000b'), null,
  'so it stays cleared');

select * from finish();
rollback;
