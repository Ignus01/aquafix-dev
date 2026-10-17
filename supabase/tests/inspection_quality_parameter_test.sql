-- Tests for water-quality inspections: the is_water_quality_parameter /
-- quality_parameter_id rules in save_inspection() and the table constraint,
-- and the combined lab + site water_quality_reading view.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-1017-000000000001', '00000000-0000-0000-1017-000000000000', 'authenticated', 'authenticated',
   'iq-admin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1017-000000000002', '00000000-0000-0000-1017-000000000000', 'authenticated', 'authenticated',
   'iq-user@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1017-000000000003', '00000000-0000-0000-1017-000000000000', 'authenticated', 'authenticated',
   'iq-viewer@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-1017-000000000001', 'admin'),
  ('10000000-0000-0000-1017-000000000002', 'user'),
  ('10000000-0000-0000-1017-000000000003', 'viewer');

create function pg_temp.as_user(p_n integer) returns void
language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub": "10000000-0000-0000-1017-00000000000%s", "role": "authenticated"}', p_n), true);
$$;

create function pg_temp.param(p_name text) returns uuid
language sql as $$ select id from public.quality_parameter where name = p_name $$;

insert into public.region (id, name) values ('a0000000-0000-0000-1017-000000000001', 'IQ-Region');
insert into public.organisation (id, name) values ('a1000000-0000-0000-1017-000000000001', 'IQ-ORG');
insert into public.location (id, name, region_id, organisation_id) values
  ('a2000000-0000-0000-1017-000000000001', 'IQ Plant', 'a0000000-0000-0000-1017-000000000001', 'a1000000-0000-0000-1017-000000000001');
insert into public.asset_type (id, name) values ('a3000000-0000-0000-1017-000000000001', 'IQ-Reservoir');
insert into public.asset (id, name, code, asset_type_id, location_id) values
  ('30000000-0000-0000-1017-000000000001', 'Reservoir 1', 'IQ-R1', 'a3000000-0000-0000-1017-000000000001',
   'a2000000-0000-0000-1017-000000000001');

-- One lab sample at the plant: pH 7.2 (ok) and Turbidity 2.5 (high, max 1).
insert into public.lab (id, name) values ('b0000000-0000-0000-1017-000000000001', 'IQ Lab');
insert into public.lab_import (id, lab_id, lab_name, file_name, storage_path, parsed)
values ('b1000000-0000-0000-1017-000000000001', 'b0000000-0000-0000-1017-000000000001', 'IQ Lab', 'iq.xlsx',
        '10000000-0000-0000-1017-000000000001/iq.xlsx', '{}');
insert into public.lab_sample (id, import_id, lab_id, location_id, lab_no, sampled_on)
values ('b2000000-0000-0000-1017-000000000001', 'b1000000-0000-0000-1017-000000000001',
        'b0000000-0000-0000-1017-000000000001', 'a2000000-0000-0000-1017-000000000001', 'IQ-001', '2026-10-01');
insert into public.lab_result (sample_id, parameter_id, raw_value, value) values
  ('b2000000-0000-0000-1017-000000000001', pg_temp.param('pH'), 7.2, 7.2),
  ('b2000000-0000-0000-1017-000000000001', pg_temp.param('Turbidity'), 2.5, 2.5);

create function pg_temp.save_insp(p_extra jsonb) returns uuid
language sql as $$
  select public.save_inspection(
    jsonb_build_object('name', 'IQ pH on site', 'value_type', 'DECIMAL_VALUE', 'allocations', '[]'::jsonb)
    || p_extra);
$$;

-- ============================================================================
-- save_inspection
-- ============================================================================
select pg_temp.as_user(1);
set local role authenticated;

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

insert into ids values ('plain', pg_temp.save_insp('{"name": "IQ Plain"}'));
select is(
  (select is_water_quality_parameter from public.inspection where id = (select id from ids where name = 'plain')),
  false, 'the flag defaults to false');

select throws_ok(
  $$select pg_temp.save_insp('{"is_water_quality_parameter": true}')$$,
  'P0001', 'Select the quality parameter this inspection measures.',
  'a water-quality inspection needs a parameter');

select throws_ok(
  format($$select pg_temp.save_insp('{"is_water_quality_parameter": true, "value_type": "TEXT", "quality_parameter_id": "%s"}')$$,
         pg_temp.param('pH')),
  'P0001', 'A water quality parameter must be a DECIMAL_VALUE inspection.',
  'only DECIMAL_VALUE inspections can be linked');

insert into ids values ('ph', pg_temp.save_insp(jsonb_build_object(
  'is_water_quality_parameter', true, 'quality_parameter_id', pg_temp.param('pH'))));

select is(
  (select quality_parameter_id from public.inspection where id = (select id from ids where name = 'ph')),
  pg_temp.param('pH'), 'the parameter is saved');

-- Switching the flag off clears the parameter, even if the payload still sends it.
select pg_temp.save_insp(jsonb_build_object(
  'id', (select id from ids where name = 'ph'),
  'is_water_quality_parameter', false, 'quality_parameter_id', pg_temp.param('pH')));
select is(
  (select quality_parameter_id from public.inspection where id = (select id from ids where name = 'ph')),
  null, 'switching the flag off clears the parameter');

select pg_temp.save_insp(jsonb_build_object(
  'id', (select id from ids where name = 'ph'),
  'is_water_quality_parameter', true, 'quality_parameter_id', pg_temp.param('pH')));

insert into ids values ('turb', pg_temp.save_insp(jsonb_build_object(
  'name', 'IQ Turbidity on site',
  'is_water_quality_parameter', true, 'quality_parameter_id', pg_temp.param('Turbidity'))));
-- An unflagged decimal inspection, which must not show up in the report.
insert into ids values ('other', pg_temp.save_insp('{"name": "IQ Pressure"}'));

-- The constraint backs the function up for direct writes.
select throws_ok(
  format($$update public.inspection set is_water_quality_parameter = true, quality_parameter_id = null where id = '%s'$$,
         (select id from ids where name = 'other')),
  '23514', null, 'the table rejects a flag without a parameter');
select throws_ok(
  format($$update public.inspection set quality_parameter_id = '%s' where id = '%s'$$,
         pg_temp.param('pH'), (select id from ids where name = 'other')),
  '23514', null, 'the table rejects a parameter without the flag');
select throws_ok(
  format($$update public.inspection set value_type = 'TEXT' where id = '%s'$$,
         (select id from ids where name = 'ph')),
  '23514', null, 'a linked inspection can''t change to another value type');

-- A linked parameter can't be deleted (quality admin, so RLS allows it).
select throws_ok(
  format($$delete from public.quality_parameter where id = '%s'$$, pg_temp.param('pH')),
  '23503', null, 'a parameter an inspection measures can''t be deleted');

-- ============================================================================
-- water_quality_reading
-- ============================================================================
-- A field user captures pH 6.8 (ok), Turbidity 0.4 (ok) and a pressure.
reset role;
select pg_temp.as_user(2);
set local role authenticated;

select lives_ok(
  format($$select public.save_inspection_activity(jsonb_build_object(
    'asset_id', '30000000-0000-0000-1017-000000000001',
    'values', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'inspection_id', '%s', 'is_current', true, 'decimal_value', 6.8, 'images', '[]'::jsonb),
      jsonb_build_object('id', gen_random_uuid(), 'inspection_id', '%s', 'is_current', true, 'decimal_value', 0.4, 'images', '[]'::jsonb),
      jsonb_build_object('id', gen_random_uuid(), 'inspection_id', '%s', 'is_current', true, 'decimal_value', 3, 'images', '[]'::jsonb))))$$,
    (select id from ids where name = 'ph'), (select id from ids where name = 'turb'),
    (select id from ids where name = 'other')),
  'a field user saves an inspection with quality readings');

reset role;
select pg_temp.as_user(3);
set local role authenticated;

select results_eq(
  $$select source, parameter_name, value, status, location_name, asset_name
    from public.water_quality_reading
    where location_id = 'a2000000-0000-0000-1017-000000000001'
    order by sort_order, source$$,
  $$values ('lab'::text, 'pH'::text, 7.2::numeric, 'ok'::text, 'IQ Plant'::text, null::text),
           ('site', 'pH', 6.8, 'ok', 'IQ Plant', 'Reservoir 1'),
           ('lab', 'Turbidity', 2.5, 'high', 'IQ Plant', null),
           ('site', 'Turbidity', 0.4, 'ok', 'IQ Plant', 'Reservoir 1')$$,
  'a viewer sees lab and site readings side by side, checked against the same limits; unflagged inspections are left out');

select is(
  (select reference from public.water_quality_reading
   where location_id = 'a2000000-0000-0000-1017-000000000001' and source = 'lab' limit 1),
  'IQ-001', 'a lab reading references its lab no');

select ok(
  (select bool_and(inspection_activity_id is not null and sampled_at is not null)
   from public.water_quality_reading
   where location_id = 'a2000000-0000-0000-1017-000000000001' and source = 'site'),
  'a site reading links its inspection activity and time');

-- Unlinking the inspection takes its readings out of the report.
reset role;
select pg_temp.as_user(1);
set local role authenticated;
select pg_temp.save_insp(jsonb_build_object(
  'id', (select id from ids where name = 'turb'), 'name', 'IQ Turbidity on site',
  'is_water_quality_parameter', false));
select is(
  (select count(*)::integer from public.water_quality_reading
   where location_id = 'a2000000-0000-0000-1017-000000000001' and source = 'site'),
  1, 'unlinking an inspection removes its readings from the report');

select * from finish();
rollback;
