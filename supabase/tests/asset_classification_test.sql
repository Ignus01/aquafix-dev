-- Tests for the meter classification on the asset type
-- (20261109120000_asset_classification.sql): the enum, the new meter types,
-- the rule that split Water Meter, the migration log's lock-down, the
-- usage-limit triggers and the water_usage_report meter_type key.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- The enum and the meter types
-- ============================================================================
select is(
  enum_range(null::public.asset_classification)::text[],
  array['TREATED_METER', 'BOREHOLE_METER', 'MUNICIPAL_METER', 'ELECTRICAL_METER', 'OTHER'],
  'asset_classification has the five values, without FLEET');
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'asset_type' and column_name = 'classification'),
  '''OTHER''::asset_classification',
  'new asset types default to OTHER');
select hasnt_type('public', 'asset_classification_new', 'the temporary enum is gone');

select is(
  (select array_agg(name || '=' || classification order by name) from public.asset_type
   where name in ('Treated Meter', 'Borehole Meter', 'Municipal Meter')),
  array['Borehole Meter=BOREHOLE_METER', 'Municipal Meter=MUNICIPAL_METER', 'Treated Meter=TREATED_METER'],
  'the three new meter types exist with their classifications');
select is(
  (select count(*)::int from public.asset_type where name = 'Water Meter'), 0,
  'Water Meter is gone (renamed Other Meter where it existed)');
select is(
  (select count(*)::int from public.asset_type where name = 'Electrical Meter' and classification <> 'ELECTRICAL_METER'), 0,
  'Electrical Meter, where it exists, is ELECTRICAL_METER');

-- ============================================================================
-- The split rule
-- ============================================================================
select is(
  (select array[kind, rule] from public.asset_classification_meter_rule('treated', 'Borehole meter')),
  array['treated', 'meter_type'], 'meter_type wins over the name');
select is(
  (select array[kind, rule] from public.asset_classification_meter_rule('borehole', 'Meter 2')),
  array['borehole', 'meter_type'], 'meter_type borehole → borehole');
select is(
  (select array[kind, rule] from public.asset_classification_meter_rule('other', 'Municipal meter')),
  array['municipal', 'meter_type other, name municipal'], 'meter_type other named municipal → municipal (Kempton)');
select is(
  (select kind from public.asset_classification_meter_rule('other', 'Pump meter')),
  null, 'meter_type other without "municipal" in the name stays');
select is(
  (select array[kind, rule] from public.asset_classification_meter_rule(null, 'Treated water meter')),
  array['treated', 'name'], 'no meter_type: by name, treated');
select is(
  (select kind from public.asset_classification_meter_rule(null, 'BOREHOLE METER 3')),
  'borehole', 'the name match ignores case');
select is(
  (select kind from public.asset_classification_meter_rule(null, 'Municipal check meter')),
  'municipal', 'no meter_type: by name, municipal');
select is(
  (select kind from public.asset_classification_meter_rule(null, 'Treated from borehole')),
  'treated', 'treated is checked before borehole');
select is(
  (select kind from public.asset_classification_meter_rule(null, 'Fire Meter')),
  null, 'a meter that fits none stays on Other Meter');

-- ============================================================================
-- The migration log: system only
-- ============================================================================
select ok(
  (select relrowsecurity from pg_class where oid = 'public.asset_type_migration_log'::regclass),
  'asset_type_migration_log has RLS on');
select ok(
  not has_table_privilege('authenticated', 'public.asset_type_migration_log', 'select')
  and not has_table_privilege('anon', 'public.asset_type_migration_log', 'select'),
  'signed-in and anonymous users can''t read the migration log');

-- ============================================================================
-- Usage limit triggers
-- ============================================================================
insert into public.region (id, name) values ('a0000000-0000-0000-1095-000000000001', 'AC-Region');
insert into public.organisation (id, name) values ('a1000000-0000-0000-1095-000000000001', 'AC-ORG');
insert into public.location (id, name, region_id, organisation_id) values
  ('a2000000-0000-0000-1095-000000000001', 'AC-Site', 'a0000000-0000-0000-1095-000000000001', 'a1000000-0000-0000-1095-000000000001');
insert into public.asset_type (id, name, classification) values
  ('a3000000-0000-0000-1095-000000000001', 'AC-Borehole', 'BOREHOLE_METER'),
  ('a3000000-0000-0000-1095-000000000002', 'AC-Treated', 'TREATED_METER'),
  ('a3000000-0000-0000-1095-000000000003', 'AC-Plain', 'OTHER'),
  ('a3000000-0000-0000-1095-000000000004', 'AC-Borehole-2', 'BOREHOLE_METER');

select lives_ok(
  $$ insert into public.asset (id, name, code, asset_type_id, location_id, usage_limit) values
       ('30000000-0000-0000-1095-000000000001', 'AC BH', 'AC-BH', 'a3000000-0000-0000-1095-000000000001',
        'a2000000-0000-0000-1095-000000000001', 100) $$,
  'a borehole meter can have a usage limit');
select throws_ok(
  $$ insert into public.asset (name, code, asset_type_id, location_id, usage_limit) values
       ('AC T', 'AC-T', 'a3000000-0000-0000-1095-000000000002', 'a2000000-0000-0000-1095-000000000001', 10) $$,
  'P0001', 'A usage limit can only be set on a borehole meter: AC T has an asset type that isn''t one.',
  'a treated meter can''t have a limit');
select throws_ok(
  $$ insert into public.asset (name, code, asset_type_id, location_id, usage_limit) values
       ('AC P', 'AC-P', 'a3000000-0000-0000-1095-000000000003', 'a2000000-0000-0000-1095-000000000001', 10) $$,
  'P0001', null, 'nor can an asset of a non-meter type');
insert into public.asset (id, name, code, asset_type_id, location_id) values
  ('30000000-0000-0000-1095-000000000002', 'AC T2', 'AC-T2', 'a3000000-0000-0000-1095-000000000002', 'a2000000-0000-0000-1095-000000000001');
select throws_ok(
  $$ update public.asset set usage_limit = 10 where id = '30000000-0000-0000-1095-000000000002' $$,
  'P0001', null, 'a limit can''t be added to a treated meter later');
select throws_ok(
  $$ update public.asset set usage_limit = 0 where id = '30000000-0000-0000-1095-000000000001' $$,
  '23514', null, 'a limit of 0 is refused');
select throws_ok(
  $$ update public.asset set usage_limit = -5 where id = '30000000-0000-0000-1095-000000000001' $$,
  '23514', null, 'a negative limit is refused');
select throws_ok(
  $$ update public.asset set asset_type_id = 'a3000000-0000-0000-1095-000000000002'
     where id = '30000000-0000-0000-1095-000000000001' $$,
  'P0001', null, 'a meter with a limit can''t move to a treated type');
select lives_ok(
  $$ update public.asset set asset_type_id = 'a3000000-0000-0000-1095-000000000004'
     where id = '30000000-0000-0000-1095-000000000001' $$,
  'it can move to another borehole type with its limit');
select lives_ok(
  $$ update public.asset set name = 'AC BH renamed' where id = '30000000-0000-0000-1095-000000000001' $$,
  'other changes to a limited meter are fine');

select throws_ok(
  $$ update public.asset_type set classification = 'TREATED_METER' where id = 'a3000000-0000-0000-1095-000000000004' $$,
  'P0001', 'Assets of type AC-Borehole-2 have a usage limit, so it must stay a borehole meter. Clear their limits first.',
  'a borehole type whose assets have limits can''t be reclassified');
select lives_ok(
  $$ update public.asset_type set name = 'AC-Borehole-2b' where id = 'a3000000-0000-0000-1095-000000000004' $$,
  'it can still be renamed');
select lives_ok(
  $$ update public.asset_type set classification = 'TREATED_METER' where id = 'a3000000-0000-0000-1095-000000000001' $$,
  'a borehole type without limited assets can be reclassified');
update public.asset set usage_limit = null where id = '30000000-0000-0000-1095-000000000001';
select lives_ok(
  $$ update public.asset_type set classification = 'OTHER' where id = 'a3000000-0000-0000-1095-000000000004' $$,
  'once the limits are cleared, it can');

-- ============================================================================
-- water_usage_report's meter_type key
-- ============================================================================
select is(
  array[public.water_meter_kind('TREATED_METER'), public.water_meter_kind('BOREHOLE_METER'),
        public.water_meter_kind('MUNICIPAL_METER'), public.water_meter_kind('ELECTRICAL_METER'),
        public.water_meter_kind('OTHER')],
  array['treated', 'borehole', 'other', 'other', null],
  'treated, borehole, other for municipal and electrical meters, none for non-meter types');

select * from finish();
rollback;
