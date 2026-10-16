-- Tests for Quality lab results: commit_lab_import() (mappings saved and
-- reused, refusals, duplicates, replace, the below-detection rule, factors),
-- lab_result_status(), the seed and access.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-1016-000000000001', '00000000-0000-0000-1016-000000000000', 'authenticated', 'authenticated',
   'lq-sysadmin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1016-000000000002', '00000000-0000-0000-1016-000000000000', 'authenticated', 'authenticated',
   'lq-admin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1016-000000000003', '00000000-0000-0000-1016-000000000000', 'authenticated', 'authenticated',
   'lq-user@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1016-000000000004', '00000000-0000-0000-1016-000000000000', 'authenticated', 'authenticated',
   'lq-viewer@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-1016-000000000001', 'system_admin'),
  ('10000000-0000-0000-1016-000000000002', 'admin'),
  ('10000000-0000-0000-1016-000000000003', 'user'),
  ('10000000-0000-0000-1016-000000000004', 'viewer');

create function pg_temp.as_user(p_n integer) returns void
language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub": "10000000-0000-0000-1016-00000000000%s", "role": "authenticated"}', p_n), true);
$$;

insert into public.region (id, name) values ('a0000000-0000-0000-1016-000000000001', 'LQ-Region');
insert into public.organisation (id, name) values ('a1000000-0000-0000-1016-000000000001', 'LQ-ORG');
insert into public.location (id, name, region_id, organisation_id) values
  ('a2000000-0000-0000-1016-000000000001', 'LQ Kemtton', 'a0000000-0000-0000-1016-000000000001', 'a1000000-0000-0000-1016-000000000001'),
  ('a2000000-0000-0000-1016-000000000002', 'LQ Selby', 'a0000000-0000-0000-1016-000000000001', 'a1000000-0000-0000-1016-000000000001');

create function pg_temp.param(p_name text) returns uuid
language sql as $$ select id from public.quality_parameter where name = p_name $$;

-- Two staged files from one lab (as the web app stages them), the second
-- repeating a lab no from the first.
create function pg_temp.stage(p_id uuid, p_file text, p_parsed jsonb, p_lab text default 'LQ Water Lab')
returns void language sql as $$
  insert into public.lab_import (id, lab_name, client_name, batch_no, file_name, storage_path, parsed)
  values (p_id, p_lab, 'CP-01', p_parsed ->> 'batch_no', p_file,
          '10000000-0000-0000-1016-000000000002/' || p_id || '-' || p_file, p_parsed);
$$;

select pg_temp.as_user(2);
set local role authenticated;

select lives_ok($$
  select pg_temp.stage('b0000000-0000-0000-1016-000000000001', 'one.xlsx', '{
    "batch_no": "201013",
    "columns": [ {"header": "20 - pH", "unit": "pH"}, {"header": "31 - Al", "unit": "mg/l"},
                 {"header": "26 - LSI - cal", "unit": "LSI"}, {"header": "40 - Ecoli", "unit": "CFU/100ml"},
                 {"header": "06 - TON", "unit": "mg/l"}, {"header": "31 - Mn", "unit": "mg/l"} ],
    "rows": [
      {"row": 7, "lab_no": "155588", "locality": "CP-01 Kemtton", "sample_type": "Water", "sampled_on": "2024-10-30",
       "values": [8.21, -0.002, -0.57, -1, 1.33, null]},
      {"row": 8, "lab_no": "155589", "locality": "CP-01 WAVE", "sample_type": "Water", "sampled_on": "2024-10-30",
       "values": [7.46, 0.01, 0.1, 0, 1.0, 0.1]},
      {"row": 9, "lab_no": "169488", "locality": "cp-01 selby", "sample_type": "Water", "sampled_on": "2024-11-28",
       "values": [8.35, -0.002, 0.23, -1, 0.8, 0.857]}
    ]}'::jsonb)
$$, 'an admin can stage an import');

select lives_ok($$
  select pg_temp.stage('b0000000-0000-0000-1016-000000000002', 'two.xlsx', '{
    "batch_no": "203909",
    "columns": [ {"header": "20 - pH ", "unit": "pH"} ],
    "rows": [
      {"row": 7, "lab_no": "169488", "locality": "CP-01 Selby", "sample_type": "Water", "sampled_on": "2024-11-28",
       "values": [9.9]}
    ]}'::jsonb)
$$, 'and a second one');

-- ============================================================================
-- Refusals
-- ============================================================================
select throws_ok($$
  select public.commit_lab_import(array['b0000000-0000-0000-1016-000000000001']::uuid[])
$$, 'P0001', 'Column "20 - pH" in one.xlsx has no mapping. Map it to a parameter or ignore it.',
  'an unmapped column is refused');

select throws_ok(format($$
  select public.commit_lab_import(array['b0000000-0000-0000-1016-000000000001']::uuid[], '{}',
    '[{"lab_name": "LQ Water Lab", "lab_parameter": "20 - pH", "lab_unit": "pH", "parameter_id": "%1$s"},
      {"lab_name": "LQ Water Lab", "lab_parameter": "31 - Al", "lab_unit": "mg/l", "parameter_id": "%2$s"},
      {"lab_name": "LQ Water Lab", "lab_parameter": "26 - LSI - cal", "lab_unit": "LSI", "parameter_id": "%3$s"},
      {"lab_name": "LQ Water Lab", "lab_parameter": "40 - Ecoli", "lab_unit": "CFU/100ml", "parameter_id": "%4$s"},
      {"lab_name": "LQ Water Lab", "lab_parameter": "06 - TON", "lab_unit": "mg/l", "parameter_id": null},
      {"lab_name": "LQ Water Lab", "lab_parameter": "31 - Mn", "lab_unit": "mg/l", "parameter_id": "%5$s"}]')
$$, pg_temp.param('pH'), pg_temp.param('Aluminium'), pg_temp.param('Langelier saturation index'),
    pg_temp.param('E. coli'), pg_temp.param('Manganese')),
  'P0001', 'Locality "CP-01 Kemtton" in one.xlsx has no mapping. Map it to a location or ignore it.',
  'an unmapped locality is refused');
select is((select count(*) from public.lab_parameter_map)::integer, 0, 'and nothing was saved');
select is((select count(*) from public.lab)::integer, 0, 'not even the lab');

select throws_ok(format($$
  select public.commit_lab_import(array['b0000000-0000-0000-1016-000000000001']::uuid[], '{}',
    '[{"lab_name": "LQ Water Lab", "lab_parameter": "20 - pH", "lab_unit": "pH", "parameter_id": "%1$s"},
      {"lab_name": "LQ Water Lab", "lab_parameter": "31 - Al", "lab_unit": "mg/l", "parameter_id": "%2$s"},
      {"lab_name": "LQ Water Lab", "lab_parameter": "26 - LSI - cal", "lab_unit": "LSI", "parameter_id": "%3$s"},
      {"lab_name": "LQ Water Lab", "lab_parameter": "40 - Ecoli", "lab_unit": "CFU/100ml", "parameter_id": "%4$s"},
      {"lab_name": "LQ Water Lab", "lab_parameter": "06 - TON", "lab_unit": "mg/l", "parameter_id": "%2$s"},
      {"lab_name": "LQ Water Lab", "lab_parameter": "31 - Mn", "lab_unit": "mg/l", "parameter_id": "%5$s"}]',
    '[{"lab_name": "LQ Water Lab", "lab_locality": "CP-01 Kemtton", "location_id": "a2000000-0000-0000-1016-000000000001"},
      {"lab_name": "LQ Water Lab", "lab_locality": "CP-01 WAVE", "location_id": null},
      {"lab_name": "LQ Water Lab", "lab_locality": "CP-01 Selby", "location_id": "a2000000-0000-0000-1016-000000000002"}]')
$$, pg_temp.param('pH'), pg_temp.param('Aluminium'), pg_temp.param('Langelier saturation index'),
    pg_temp.param('E. coli'), pg_temp.param('Manganese')),
  'P0001', '"31 - Al" and "06 - TON" both map to Aluminium. Ignore one of them.',
  'two columns mapped to one parameter are refused');

-- ============================================================================
-- First import: maps saved, samples and results written
-- ============================================================================
select is(
  public.commit_lab_import(array['b0000000-0000-0000-1016-000000000001']::uuid[], '{}',
    format('[{"lab_name": "lq water lab", "lab_parameter": "20 - pH", "lab_unit": "pH", "parameter_id": "%1$s"},
      {"lab_name": "LQ Water Lab", "lab_parameter": "31 - Al", "lab_unit": "mg/l", "parameter_id": "%2$s"},
      {"lab_name": "LQ Water Lab", "lab_parameter": "26 - LSI - cal", "lab_unit": "LSI", "parameter_id": "%3$s"},
      {"lab_name": "LQ Water Lab", "lab_parameter": "40 - Ecoli", "lab_unit": "CFU/100ml", "parameter_id": "%4$s"},
      {"lab_name": "LQ Water Lab", "lab_parameter": "06 - TON", "lab_unit": "mg/l", "parameter_id": null},
      {"lab_name": "LQ Water Lab", "lab_parameter": "31 - Mn", "lab_unit": "mg/l", "parameter_id": "%5$s", "factor": 2}]',
      pg_temp.param('pH'), pg_temp.param('Aluminium'), pg_temp.param('Langelier saturation index'),
      pg_temp.param('E. coli'), pg_temp.param('Manganese'))::jsonb,
    '[{"lab_name": "LQ Water Lab", "lab_locality": "CP-01 Kemtton", "location_id": "a2000000-0000-0000-1016-000000000001"},
      {"lab_name": "LQ Water Lab", "lab_locality": "CP-01 WAVE", "location_id": null},
      {"lab_name": "LQ Water Lab", "lab_locality": "CP-01 Selby", "location_id": "a2000000-0000-0000-1016-000000000002"}]'),
  '{"files": 1, "imported": 2, "skipped": 1, "replaced": 0}'::jsonb,
  'the first import saves 2 samples and skips the ignored locality');

select is((select count(*) from public.lab where name = 'LQ Water Lab')::integer, 1, 'the lab was added');
select is((select count(*) from public.lab_parameter_map)::integer, 6, 'the parameter mappings were saved');
select is((select count(*) from public.lab_location_map)::integer, 3, 'and the location mappings');
select is(
  (select row(status, samples_imported, samples_skipped, imported_by is not null, lab_id is not null)::text
   from public.lab_import where id = 'b0000000-0000-0000-1016-000000000001'),
  '(imported,2,1,t,t)', 'the import is marked imported with its counts');

select is(
  (select row(r.raw_value, r.value, r.below_detection)::text from public.lab_result r
   join public.lab_sample s on s.id = r.sample_id
   where s.lab_no = '155588' and r.parameter_id = pg_temp.param('Aluminium')),
  '(-0.002,0.002,t)', '-0.002 is below detection with value 0.002');
select is(
  (select row(r.raw_value, r.value, r.below_detection)::text from public.lab_result r
   join public.lab_sample s on s.id = r.sample_id
   where s.lab_no = '155588' and r.parameter_id = pg_temp.param('Langelier saturation index')),
  '(-0.57,-0.57,f)', 'LSI -0.57 stays -0.57');
select is(
  (select r.value from public.lab_result r join public.lab_sample s on s.id = r.sample_id
   where s.lab_no = '169488' and r.parameter_id = pg_temp.param('Manganese')),
  1.714, 'the factor is applied');
select is(
  (select count(*) from public.lab_result r join public.lab_sample s on s.id = r.sample_id
   where s.lab_no = '155588')::integer,
  4, 'blank cells and ignored columns give no result');
select is(
  (select location_id from public.lab_sample where lab_no = '169488'),
  'a2000000-0000-0000-1016-000000000002'::uuid, 'localities match case-insensitively');

select is(
  (select row(out_of_spec, out_of_spec_names)::text from public.lab_sample_overview where lab_no = '169488'),
  '(1,{Mn})', 'the overview counts results out of spec');

-- ============================================================================
-- Second import: saved mappings reused, duplicates skipped or replaced
-- ============================================================================
select is(
  public.commit_lab_import(array['b0000000-0000-0000-1016-000000000002']::uuid[]),
  '{"files": 1, "imported": 0, "skipped": 1, "replaced": 0}'::jsonb,
  'a second import reuses the saved mappings and skips an imported lab no');
select throws_ok($$
  select public.commit_lab_import(array['b0000000-0000-0000-1016-000000000002']::uuid[])
$$, 'P0001', 'One of these files was already imported or cancelled. Start the import again.',
  'an import can''t be committed twice');

select lives_ok($$
  select pg_temp.stage('b0000000-0000-0000-1016-000000000003', 'three.xlsx', '{
    "batch_no": "203910",
    "columns": [ {"header": "20 - pH", "unit": "pH"} ],
    "rows": [
      {"row": 7, "lab_no": "169488", "locality": "CP-01 Selby", "sample_type": "Water", "sampled_on": "2024-11-28",
       "values": [9.9]}
    ]}'::jsonb)
$$, 'a third file repeats a lab no');
select is(
  public.commit_lab_import(array['b0000000-0000-0000-1016-000000000003']::uuid[], p_replace => true),
  '{"files": 1, "imported": 1, "skipped": 0, "replaced": 1}'::jsonb,
  'with replace, the existing sample is re-imported');
select is(
  (select row(s.import_id, (select count(*) from public.lab_result r where r.sample_id = s.id))::text
   from public.lab_sample s where s.lab_no = '169488'),
  '(b0000000-0000-0000-1016-000000000003,1)', 'the old sample and its results are gone');

-- Same lab no twice in one upload: the first file wins.
select lives_ok($$
  select pg_temp.stage('b0000000-0000-0000-1016-000000000004', 'four.xlsx', '{
    "columns": [ {"header": "20 - pH", "unit": "pH"} ],
    "rows": [ {"row": 7, "lab_no": "300001", "locality": "CP-01 Selby", "sampled_on": "2024-12-01", "values": [7]},
              {"row": 8, "lab_no": "300001", "locality": "CP-01 Selby", "sampled_on": "2024-12-01", "values": [8]} ]}'::jsonb);
$$, 'a file with a repeated lab no');
select is(
  public.commit_lab_import(array['b0000000-0000-0000-1016-000000000004']::uuid[]),
  '{"files": 1, "imported": 1, "skipped": 1, "replaced": 0}'::jsonb,
  'the first row wins');
select is(
  (select r.value from public.lab_result r join public.lab_sample s on s.id = r.sample_id where s.lab_no = '300001'),
  7::numeric, 'with the first row''s value');

-- A unit change needs re-confirming.
select lives_ok($$
  select pg_temp.stage('b0000000-0000-0000-1016-000000000005', 'five.xlsx', '{
    "columns": [ {"header": "31 - Mn", "unit": "µg/l"} ],
    "rows": [ {"row": 7, "lab_no": "300002", "locality": "CP-01 Selby", "sampled_on": "2024-12-02", "values": [500]} ]}'::jsonb);
$$, 'a file with a changed unit');
select throws_ok($$
  select public.commit_lab_import(array['b0000000-0000-0000-1016-000000000005']::uuid[])
$$, 'P0001', '"31 - Mn" was mapped with unit mg/l; five.xlsx says µg/l. Confirm its mapping.',
  'is refused until the mapping is confirmed');
select is(
  public.commit_lab_import(array['b0000000-0000-0000-1016-000000000005']::uuid[], '{}',
    format('[{"lab_name": "LQ Water Lab", "lab_parameter": "31 - Mn", "lab_unit": "µg/l", "parameter_id": "%s", "factor": 0.001}]',
           pg_temp.param('Manganese'))::jsonb),
  '{"files": 1, "imported": 1, "skipped": 0, "replaced": 0}'::jsonb,
  'and imports once it is');
select is(
  (select r.value from public.lab_result r join public.lab_sample s on s.id = r.sample_id where s.lab_no = '300002'),
  0.500, 'with the new factor');

-- ============================================================================
-- lab_result_status
-- ============================================================================
select is(public.lab_result_status(5, false, null, null), 'no_limit', 'no min and no max: no limit');
select is(public.lab_result_status(7, false, 5, 9.7), 'ok', 'within min and max: ok');
select is(public.lab_result_status(0.857, false, null, 0.4), 'high', 'above max: high');
select is(public.lab_result_status(4, false, 5, 9.7), 'low', 'below min: low');
select is(public.lab_result_status(0.004, true, null, 0.01), 'ok', 'below detection under the max: ok');
select is(public.lab_result_status(1, true, null, 0), 'ok', 'E. coli < 1 against max 0: ok');
select is(public.lab_result_status(0.02, true, null, 0.01), 'inconclusive', 'detection limit above the max: inconclusive');
select is(public.lab_result_status(0.1, true, 5, 9.7), 'low', 'below detection with a min above 0: low');
select is(public.lab_result_status(1, false, null, 0), 'high', 'E. coli 1 against max 0: high');

-- ============================================================================
-- Seed
-- ============================================================================
reset role;
select is((select max_acceptable from public.quality_parameter where name = 'Nitrate'), 48.7, 'Nitrate max is 48.7');
select is((select max_acceptable from public.quality_parameter where name = 'E. coli'), 0::numeric, 'E. coli max is 0');
select ok((select can_be_negative from public.quality_parameter where name = 'Langelier saturation index'), 'LSI can be negative');

-- ============================================================================
-- Access
-- ============================================================================
select pg_temp.as_user(3);
set local role authenticated;
select ok((select count(*) from public.lab_sample) > 0, 'a user can read samples');
select ok((select count(*) from public.lab_result_view) > 0, 'and results');
select throws_ok($$
  select public.commit_lab_import(array['b0000000-0000-0000-1016-000000000005']::uuid[])
$$, '42501', 'Only system admins and admins can import lab results.', 'a user can''t import');
update public.quality_parameter set max_acceptable = 1 where name = 'Nitrate';
select is((select max_acceptable from public.quality_parameter where name = 'Nitrate'), 48.7, 'nor edit a parameter');
update public.lab_parameter_map set factor = 5;
select is((select count(*) from public.lab_parameter_map where factor = 5)::integer, 0, 'nor a mapping');
select throws_ok($$ insert into public.quality_parameter (name, unit) values ('LQ x', 'mg/l') $$,
  '42501', null, 'nor add a parameter');
reset role;

select pg_temp.as_user(4);
set local role authenticated;
select ok((select count(*) from public.lab_import) > 0, 'a viewer can read imports');
select throws_ok($$ insert into public.lab_location_map (lab_id, lab_locality) select id, 'x' from public.lab limit 1 $$,
  '42501', null, 'but not add a mapping');
delete from public.lab_sample;
select ok((select count(*) from public.lab_sample) > 0, 'nor delete samples');
reset role;

select pg_temp.as_user(1);
set local role authenticated;
select lives_ok($$ update public.quality_parameter set max_acceptable = 0.5 where name = 'Manganese' $$,
  'a system admin can change a limit');
select is(
  (select out_of_spec from public.lab_sample_overview where lab_no = '300002'), 0,
  'and past results are re-evaluated');
select lives_ok($$ delete from public.lab_import where id = 'b0000000-0000-0000-1016-000000000001' $$,
  'and delete an import');
select is((select count(*) from public.lab_sample where lab_no = '155588')::integer, 0, 'with its samples');
reset role;

select * from finish();
rollback;
