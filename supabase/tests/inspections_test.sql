-- Golden tests for inspections: the validation test vectors in
-- spec/inspections/inspection-value-validation.md §8 (T1–T16), plus
-- instruction progress, activity delete and scheduled issuing.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup (validation §8 "Common setup")
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-7e57-000000000001', '00000000-0000-0000-7e57-000000000000', 'authenticated', 'authenticated',
   't-inspector@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-7e57-000000000002', '00000000-0000-0000-7e57-000000000000', 'authenticated', 'authenticated',
   't-admin@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-7e57-000000000001', 'user'),
  ('10000000-0000-0000-7e57-000000000002', 'admin');

insert into public.colour_container (id, name, hex_colour) values ('c0000000-0000-0000-7e57-000000000001', 'Any', '#000');
insert into public.grading (id, name, priority, colour_container_id) values
  ('20000000-0000-0000-7e57-000000000001', 'T-Good', 1, 'c0000000-0000-0000-7e57-000000000001'),
  ('20000000-0000-0000-7e57-000000000002', 'T-Fair', 2, 'c0000000-0000-0000-7e57-000000000001'),
  ('20000000-0000-0000-7e57-000000000003', 'T-Poor', 3, 'c0000000-0000-0000-7e57-000000000001');

insert into public.region (id, name) values ('a0000000-0000-0000-7e57-000000000001', 'T-North');
insert into public.organisation (id, name) values ('a1000000-0000-0000-7e57-000000000001', 'T-ORG');
insert into public.location (id, name, region_id, organisation_id)
values ('a2000000-0000-0000-7e57-000000000001', 'T-Plant A', 'a0000000-0000-0000-7e57-000000000001', 'a1000000-0000-0000-7e57-000000000001');
insert into public.asset_type (id, name) values ('a3000000-0000-0000-7e57-000000000001', 'T-Pump');
insert into public.asset (id, name, code, asset_type_id, location_id) values
  ('30000000-0000-0000-7e57-000000000001', 'Pump 1', 'T-P1', 'a3000000-0000-0000-7e57-000000000001', 'a2000000-0000-0000-7e57-000000000001'),
  ('30000000-0000-0000-7e57-000000000002', 'Pump 2', 'T-P2', 'a3000000-0000-0000-7e57-000000000001', 'a2000000-0000-0000-7e57-000000000001');

insert into public.incident_type (id, name) values ('60000000-0000-0000-7e57-000000000001', 'T-Water quality');

insert into public.inspection (id, name, value_type, is_required, nr_of_images_required) values
  ('40000000-0000-0000-7e57-000000000001', 'Chlorine', 'DECIMAL_VALUE', true, 0),
  ('40000000-0000-0000-7e57-000000000002', 'Meter', 'CUMULATIVE_VALUE', true, 0),
  ('40000000-0000-0000-7e57-000000000003', 'Meter2', 'CUMULATIVE_VALUE', false, 0),
  ('40000000-0000-0000-7e57-000000000004', 'Pump state', 'DROP_DOWN', true, 1),
  ('40000000-0000-0000-7e57-000000000005', 'Notes', 'TEXT', true, 0);

-- Rules in creation order R1, R2, R3.
insert into public.inspection_rule (id, inspection_id, lower_limit, upper_limit, nr_of_images_required, grading_id) values
  ('50000000-0000-0000-7e57-000000000001', '40000000-0000-0000-7e57-000000000001', 0, 1, 2, '20000000-0000-0000-7e57-000000000003');
insert into public.inspection_rule (id, inspection_id, lower_limit, upper_limit, nr_of_images_required, grading_id) values
  ('50000000-0000-0000-7e57-000000000002', '40000000-0000-0000-7e57-000000000001', 1, 3, 0, '20000000-0000-0000-7e57-000000000001');
insert into public.inspection_rule (id, inspection_id, lower_limit, upper_limit, nr_of_images_required, grading_id) values
  ('50000000-0000-0000-7e57-000000000003', '40000000-0000-0000-7e57-000000000001', 3, 5, 1, '20000000-0000-0000-7e57-000000000002');
insert into public.feedback (inspection_rule_id, feedback, max_nr_of_retries, auto_create_incident, incident_type_id)
values ('50000000-0000-0000-7e57-000000000001', 'Re-test the sample', 1, true, '60000000-0000-0000-7e57-000000000001');

insert into public.inspection_drop_down_option (id, inspection_id, name, grading_id) values
  ('70000000-0000-0000-7e57-000000000001', '40000000-0000-0000-7e57-000000000004', 'Fail', '20000000-0000-0000-7e57-000000000003');

insert into public.inspection_cumulative_value (inspection_id, asset_id, latest_value) values
  ('40000000-0000-0000-7e57-000000000002', '30000000-0000-0000-7e57-000000000001', 100),
  ('40000000-0000-0000-7e57-000000000003', '30000000-0000-0000-7e57-000000000001', 100);

-- Act as the field user.
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-7e57-000000000001", "role": "authenticated"}', true);

-- A payload value for the Chlorine inspection.
create function pg_temp.chlorine(p_id text, p_value numeric, p_current boolean default true, p_images integer default 0)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id', p_id,
    'inspection_id', '40000000-0000-0000-7e57-000000000001',
    'is_current', p_current,
    'decimal_value', p_value,
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'storage_path', '10000000-0000-0000-7e57-000000000001/' || gen_random_uuid() || '.jpg',
        'thumbnail_path', null,
        'mime_type', 'image/jpeg',
        'size_bytes', 100))
      from generate_series(1, p_images)
    ), '[]'::jsonb));
$$;

create function pg_temp.save(p_values jsonb, p_asset text default '30000000-0000-0000-7e57-000000000001')
returns jsonb
language sql
as $$
  select public.save_inspection_activity(jsonb_build_object('asset_id', p_asset, 'values', p_values));
$$;

create function pg_temp.messages(p_result jsonb)
returns text[]
language sql
as $$
  select coalesce(array_agg(m ->> 'message' order by ord), '{}')
  from jsonb_array_elements(p_result -> 'messages') with ordinality as t(m, ord);
$$;

create function pg_temp.incidents()
returns bigint
language sql
as $$
  select count(*) from public.incident where incident_type_id = '60000000-0000-0000-7e57-000000000001';
$$;

create temp table r (name text primary key, result jsonb);

-- ============================================================================
-- T1–T4: rule matching and grading-driven photos
-- ============================================================================
insert into r values ('T1', pg_temp.save(jsonb_build_array(pg_temp.chlorine('90000000-0000-0000-7e57-000000000001', 2.0))));
select ok((select (result ->> 'ok')::boolean from r where name = 'T1'), 'T1: 2.0 is valid');
select is(
  (select g.name from public.inspection_value v join public.grading g on g.id = v.grading_id
   where v.id = '90000000-0000-0000-7e57-000000000001'),
  'T-Good', 'T1: value graded Good');
select is(
  (select g.name from public.inspection_activity a join public.grading g on g.id = a.grading_id
   where a.id = (select (result ->> 'id')::uuid from r where name = 'T1')),
  'T-Good', 'T1: activity graded Good');
select is(
  (select display_value::text from public.inspection_value where id = '90000000-0000-0000-7e57-000000000001'),
  '2', 'T1: display value "2"');

insert into r values ('T2', pg_temp.save(jsonb_build_array(pg_temp.chlorine('90000000-0000-0000-7e57-000000000002', 3.0))));
select is((select (result ->> 'ok')::boolean from r where name = 'T2'), false, 'T2: 3.0 without a photo is invalid');
select is(pg_temp.messages((select result from r where name = 'T2')),
  array[E'Chlorine Image Required due to Grading!\n0 were taken but 1 are required.'], 'T2: D1 message');

insert into r values ('T3', pg_temp.save(jsonb_build_array(pg_temp.chlorine('90000000-0000-0000-7e57-000000000003', 3.0, true, 1))));
select ok((select (result ->> 'ok')::boolean from r where name = 'T3'), 'T3: 3.0 with a photo is valid');
select is(
  (select g.name from public.inspection_value v join public.grading g on g.id = v.grading_id
   where v.id = '90000000-0000-0000-7e57-000000000003'),
  'T-Fair', 'T3: 3.0 matches R3 (upper bound exclusive)');
select is(
  (select count(*)::integer from public.inspection_image where inspection_value_id = '90000000-0000-0000-7e57-000000000003'),
  1, 'T3: photo saved');

insert into r values ('T4', pg_temp.save(jsonb_build_array(pg_temp.chlorine('90000000-0000-0000-7e57-000000000004', 5.0))));
select ok((select (result ->> 'ok')::boolean from r where name = 'T4'), 'T4: 5.0 is valid');
select is(
  (select grading_id from public.inspection_value where id = '90000000-0000-0000-7e57-000000000004'),
  null, 'T4: 5.0 matches no rule, no value grading');
select is(
  (select grading_id from public.inspection_activity where id = (select (result ->> 'id')::uuid from r where name = 'T4')),
  null, 'T4: no activity grading');

-- ============================================================================
-- T5–T8: Feedback retries
-- ============================================================================
insert into r values ('T5', pg_temp.save(jsonb_build_array(pg_temp.chlorine('90000000-0000-0000-7e57-000000000005', 0.5))));
select is((select (result ->> 'ok')::boolean from r where name = 'T5'), false, 'T5: first 0.5 is rejected');
select is(pg_temp.messages((select result from r where name = 'T5')), array['Re-test the sample'], 'T5: Feedback text, no photo demand');
select is(
  (select result -> 'retries' -> 0 ->> 'superseded_id' from r where name = 'T5'),
  '90000000-0000-0000-7e57-000000000005', 'T5: row 1 superseded');
select is(jsonb_array_length((select result -> 'retries' from r where name = 'T5')), 1, 'T5: one retry row');
select is(pg_temp.incidents(), 0::bigint, 'T5: no incident');
select is(
  (select count(*)::integer from public.inspection_value where id = '90000000-0000-0000-7e57-000000000005'),
  0, 'T5: nothing saved');

insert into r values ('T6', pg_temp.save(jsonb_build_array(
  pg_temp.chlorine('90000000-0000-0000-7e57-000000000005', 0.5, false),
  pg_temp.chlorine('90000000-0000-0000-7e57-000000000006', 0.6))));
select is((select (result ->> 'ok')::boolean from r where name = 'T6'), false, 'T6: invalid');
select is(pg_temp.messages((select result from r where name = 'T6')),
  array[E'Chlorine Image Required due to Grading!\n0 were taken but 2 are required.'], 'T6: superseded row needs R1 photos');
select is(pg_temp.incidents(), 1::bigint, 'T6: incident committed although the save failed [AS-IS]');
select is(
  (select comment from public.incident where incident_type_id = '60000000-0000-0000-7e57-000000000001' order by reference limit 1),
  'Auto Created Incident: Pump 1 Chlorine is 0.6', 'T6: incident comment');
select is(
  (select location_id from public.incident where incident_type_id = '60000000-0000-0000-7e57-000000000001' order by reference limit 1),
  'a2000000-0000-0000-7e57-000000000001'::uuid, 'T6: incident at the asset location');
select is(
  (select created_by from public.incident where incident_type_id = '60000000-0000-0000-7e57-000000000001' order by reference limit 1),
  '10000000-0000-0000-7e57-000000000001'::uuid, 'T6: incident owned by the inspector');

insert into r values ('T7', pg_temp.save(jsonb_build_array(
  pg_temp.chlorine('90000000-0000-0000-7e57-000000000005', 0.5, false, 2),
  pg_temp.chlorine('90000000-0000-0000-7e57-000000000006', 0.6))));
select ok((select (result ->> 'ok')::boolean from r where name = 'T7'), 'T7: valid with photos on row 1');
select is(pg_temp.incidents(), 2::bigint, 'T7: a second incident [AS-IS]');
select is(
  (select g.name from public.inspection_activity a join public.grading g on g.id = a.grading_id
   where a.id = (select (result ->> 'id')::uuid from r where name = 'T7')),
  'T-Poor', 'T7: activity graded Poor');
select is(
  (select array_agg(is_current order by sort_order) from public.inspection_value
   where inspection_activity_id = (select (result ->> 'id')::uuid from r where name = 'T7')),
  array[false, true], 'T7: both rows saved, row 1 superseded');

insert into r values ('T8a', pg_temp.save(jsonb_build_array(
  pg_temp.chlorine('90000000-0000-0000-7e57-000000000008', 0.5, false),
  pg_temp.chlorine('90000000-0000-0000-7e57-000000000009', 2.0))));
select is(pg_temp.messages((select result from r where name = 'T8a')),
  array[E'Chlorine Image Required due to Grading!\n0 were taken but 2 are required.'], 'T8: superseded 0.5 still needs 2 photos');
insert into r values ('T8', pg_temp.save(jsonb_build_array(
  pg_temp.chlorine('90000000-0000-0000-7e57-000000000008', 0.5, false, 2),
  pg_temp.chlorine('90000000-0000-0000-7e57-000000000009', 2.0))));
select ok((select (result ->> 'ok')::boolean from r where name = 'T8'), 'T8: valid with photos');
select is(
  (select array_agg(g.name order by v.sort_order) from public.inspection_value v join public.grading g on g.id = v.grading_id
   where v.inspection_activity_id = (select (result ->> 'id')::uuid from r where name = 'T8')),
  array['T-Poor', 'T-Good']::text[], 'T8: row 1 Poor, row 2 Good');
select is(
  (select g.name from public.inspection_activity a join public.grading g on g.id = a.grading_id
   where a.id = (select (result ->> 'id')::uuid from r where name = 'T8')),
  'T-Poor', 'T8: activity graded Poor [AS-IS]');
select is(pg_temp.incidents(), 2::bigint, 'T8: no new incident (2.0 hits no Feedback rule)');

-- V8: a superseded value that no longer matches any rule needs no photos.
insert into r values ('V8', pg_temp.save(jsonb_build_array(
  pg_temp.chlorine('90000000-0000-0000-7e57-000000000010', 7, false),
  pg_temp.chlorine('90000000-0000-0000-7e57-000000000011', 2.0))));
select ok((select (result ->> 'ok')::boolean from r where name = 'V8'), 'V8: superseded value with no rule is accepted');

-- ============================================================================
-- T9–T11: cumulative readings
-- ============================================================================
create function pg_temp.meter(p_id text, p_inspection text, p_value numeric)
returns jsonb
language sql
as $$
  select jsonb_build_object('id', p_id, 'inspection_id', p_inspection, 'is_current', true,
    'decimal_value', p_value, 'images', '[]'::jsonb);
$$;

insert into r values ('T9', pg_temp.save(jsonb_build_array(
  pg_temp.meter('90000000-0000-0000-7e57-000000000020', '40000000-0000-0000-7e57-000000000002', 99))));
select is((select (result ->> 'ok')::boolean from r where name = 'T9'), false, 'T9: 99 < 100 is invalid');
select is(
  (select result -> 'messages' -> 0 from r where name = 'T9'),
  jsonb_build_object('kind', 'field', 'value_id', '90000000-0000-0000-7e57-000000000020',
    'field', 'decimal_value', 'message', 'Must be >= to previous value of 100'),
  'T9: field message on the reading');

insert into r values ('T10', pg_temp.save(jsonb_build_array(
  pg_temp.meter('90000000-0000-0000-7e57-000000000021', '40000000-0000-0000-7e57-000000000002', 100))));
select ok((select (result ->> 'ok')::boolean from r where name = 'T10'), 'T10: equal is allowed');
select is(
  (select latest_value from public.inspection_cumulative_value
   where inspection_id = '40000000-0000-0000-7e57-000000000002' and asset_id = '30000000-0000-0000-7e57-000000000001'),
  100::numeric, 'T10: latest stays 100');

insert into r values ('T11', pg_temp.save(jsonb_build_array(
  pg_temp.meter('90000000-0000-0000-7e57-000000000022', '40000000-0000-0000-7e57-000000000003', 50))));
select ok((select (result ->> 'ok')::boolean from r where name = 'T11'), 'T11: not required, a decrease is accepted [AS-IS]');
select is(
  (select latest_value from public.inspection_cumulative_value
   where inspection_id = '40000000-0000-0000-7e57-000000000003' and asset_id = '30000000-0000-0000-7e57-000000000001'),
  50::numeric, 'T11: latest becomes 50');
select is(
  (select source from public.inspection_cumulative_value_change c
   join public.inspection_cumulative_value v on v.id = c.cumulative_value_id
   where v.inspection_id = '40000000-0000-0000-7e57-000000000003'
   order by c.id desc limit 1),
  'inspection', 'T11: change audited as an inspection');

-- ============================================================================
-- T12–T16: drop-down, text, empty type, several failures
-- ============================================================================
create function pg_temp.pump(p_id text, p_images integer)
returns jsonb
language sql
as $$
  select pg_temp.chlorine(p_id, 0, true, p_images)
    || jsonb_build_object('inspection_id', '40000000-0000-0000-7e57-000000000004',
                          'drop_down_option_id', '70000000-0000-0000-7e57-000000000001');
$$;

insert into r values ('T12', pg_temp.save(jsonb_build_array(pg_temp.pump('90000000-0000-0000-7e57-000000000030', 0))));
select is(pg_temp.messages((select result from r where name = 'T12')),
  array[E'Pump state Image Required.\n0 were taken but 1 are required.'], 'T12: B1 only, D1 skipped');

insert into r values ('T13', pg_temp.save(jsonb_build_array(pg_temp.pump('90000000-0000-0000-7e57-000000000031', 1))));
select ok((select (result ->> 'ok')::boolean from r where name = 'T13'), 'T13: valid with a photo');
select is(
  (select g.name || ' / ' || v.display_value from public.inspection_value v join public.grading g on g.id = v.grading_id
   where v.id = '90000000-0000-0000-7e57-000000000031'),
  'T-Poor / Fail', 'T13: graded Poor, display "Fail"');

insert into r values ('T14', pg_temp.save(jsonb_build_array(jsonb_build_object(
  'id', '90000000-0000-0000-7e57-000000000040', 'inspection_id', '40000000-0000-0000-7e57-000000000005',
  'is_current', true, 'text_value', '', 'images', '[]'::jsonb))));
select is(
  (select result -> 'messages' -> 0 from r where name = 'T14'),
  jsonb_build_object('kind', 'field', 'value_id', '90000000-0000-0000-7e57-000000000040',
    'field', 'text_value', 'message', 'Required'),
  'T14: "Required" on the text (V1)');

select throws_ok(
  $$insert into public.inspection (name, value_type) values ('No type', null)$$,
  '23502', null, 'T15: an inspection can''t have an empty value type (V2 can''t occur)');

insert into r values ('T16', pg_temp.save(jsonb_build_array(
  jsonb_build_object('id', '90000000-0000-0000-7e57-000000000041', 'inspection_id', '40000000-0000-0000-7e57-000000000005',
    'is_current', true, 'text_value', '', 'images', '[]'::jsonb),
  pg_temp.meter('90000000-0000-0000-7e57-000000000042', '40000000-0000-0000-7e57-000000000002', 1))));
select is(jsonb_array_length((select result -> 'messages' from r where name = 'T16')), 2, 'T16: both values report in one save');

-- A text-only activity has no grading (§4 note).
insert into r values ('TEXT', pg_temp.save(jsonb_build_array(jsonb_build_object(
  'id', '90000000-0000-0000-7e57-000000000043', 'inspection_id', '40000000-0000-0000-7e57-000000000005',
  'is_current', true, 'text_value', 'All fine', 'images', '[]'::jsonb))));
select is(
  (select grading_id from public.inspection_activity where id = (select (result ->> 'id')::uuid from r where name = 'TEXT')),
  null, 'Text-only activity has no grading');

-- ============================================================================
-- Guards
-- ============================================================================
select throws_ok(
  $$select pg_temp.save(jsonb_build_array(pg_temp.chlorine('90000000-0000-0000-7e57-000000000001', 2.0)))$$,
  'P0001', 'A value on this form belongs to another inspection.', 'A saved value can''t be claimed by a new activity');

select throws_ok(
  $$select pg_temp.save(jsonb_build_array(
      pg_temp.chlorine('90000000-0000-0000-7e57-000000000050', 2.0)
        || '{"images": [{"storage_path": "someone-else/x.jpg", "mime_type": "image/jpeg", "size_bytes": 1}]}'::jsonb))$$,
  '42501', 'You can only attach photos you uploaded yourself.', 'Photos must come from the caller''s own folder');

-- Edit (IAC-R06): an existing superseded value stays superseded.
select ok((public.save_inspection_activity(jsonb_build_object(
  'id', (select result ->> 'id' from r where name = 'T7'),
  'values', jsonb_build_array(
    pg_temp.chlorine('90000000-0000-0000-7e57-000000000005', 9, true)
      || jsonb_build_object('images', (select jsonb_agg(jsonb_build_object('id', id)) from public.inspection_image
                                       where inspection_value_id = '90000000-0000-0000-7e57-000000000005')),
    pg_temp.chlorine('90000000-0000-0000-7e57-000000000006', 2.0))
)) ->> 'ok')::boolean, 'Edit of own activity from today saves');
select is(
  (select is_current::text || ' ' || decimal_value::text from public.inspection_value where id = '90000000-0000-0000-7e57-000000000005'),
  'false 0.5', 'Edit: superseded value keeps its reading and state');

-- Another user can't edit it.
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-7e57-000000000002", "role": "authenticated"}', true);
select throws_ok(
  format($$select public.save_inspection_activity('{"id": "%s", "values": []}'::jsonb)$$,
    (select result ->> 'id' from r where name = 'T7')),
  '42501', 'You can only edit your own inspections from today.', 'Only the inspector can edit');

-- ============================================================================
-- Instructions: allocation set, progress, delete fix
-- ============================================================================
-- As the admin.
select lives_ok(
  $$select public.save_instruction(jsonb_build_object(
      'name', 'Weekly check', 'account_id', '10000000-0000-0000-7e57-000000000001',
      'required_completed_date', public.app_today(),
      'asset_ids', jsonb_build_array('30000000-0000-0000-7e57-000000000001', '30000000-0000-0000-7e57-000000000002',
                                     '30000000-0000-0000-7e57-000000000001')))$$,
  'save_instruction with a duplicate asset');
select is(
  (select nr_of_allocations::text || ' ' || status::text from public.instruction where name = 'Weekly check'),
  '2 new', 'Duplicate asset allocated once; status New');

select throws_ok(
  $$select public.save_instruction(jsonb_build_object(
      'name', 'Late', 'account_id', '10000000-0000-0000-7e57-000000000001',
      'required_completed_date', public.app_today() - 1, 'asset_ids', '[]'::jsonb))$$,
  'P0001', 'Must be today or in the future.', 'INS-R02: date in the past');

-- Inspect Pump 2 through the instruction, as the field user.
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-7e57-000000000001", "role": "authenticated"}', true);
insert into r values ('INS', public.save_inspection_activity(jsonb_build_object(
  'asset_id', '30000000-0000-0000-7e57-000000000002',
  'instruction_id', (select id from public.instruction where name = 'Weekly check'),
  'values', jsonb_build_array(pg_temp.chlorine('90000000-0000-0000-7e57-000000000060', 2.0)))));
select ok((select (result ->> 'ok')::boolean from r where name = 'INS'), 'Instruction inspection saves');
select is(
  (select nr_completed::text || '/' || nr_of_allocations::text || ' ' || status::text
   from public.instruction where name = 'Weekly check'),
  '1/2 in_progress', 'INS-R05: 1/2, In Progress');
select ok(
  (select last_inspection_date is not null from public.asset where id = '30000000-0000-0000-7e57-000000000002'),
  '§5.4: asset last-inspection date stamped');

select throws_ok(
  format($$select public.save_inspection_activity(jsonb_build_object(
      'asset_id', '30000000-0000-0000-7e57-000000000002', 'instruction_id', '%s',
      'values', '[]'::jsonb))$$, (select id from public.instruction where name = 'Weekly check')),
  'P0001', 'Pump 2 has already been Inspected.', 'INS-R07: a completed allocation can''t be inspected again');

-- Removing an inspected asset from the instruction is refused.
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-7e57-000000000002", "role": "authenticated"}', true);
select throws_ok(
  format($$select public.save_instruction(jsonb_build_object(
      'id', '%s', 'name', 'Weekly check', 'account_id', '10000000-0000-0000-7e57-000000000001',
      'required_completed_date', public.app_today(),
      'asset_ids', jsonb_build_array('30000000-0000-0000-7e57-000000000001')))$$,
    (select id from public.instruction where name = 'Weekly check')),
  'P0001', 'Pump 2 has already been Inspected.', 'INS-R04 fix: an inspected asset can''t be removed');

select throws_ok(
  format($$delete from public.instruction where id = '%s'$$, (select id from public.instruction where name = 'Weekly check')),
  '23503', null, 'Instruction delete blocked while activities exist');

-- Delete the activity (admin): the allocation and the asset date are reset.
select lives_ok(
  format($$select public.delete_inspection_activity('%s')$$, (select result ->> 'id' from r where name = 'INS')),
  'Admin deletes the activity');
select is(
  (select nr_completed::text || ' ' || status::text from public.instruction where name = 'Weekly check'),
  '0 new', 'IAC-R05 fix: allocation un-ticked, status New');
select is(
  (select last_inspection_date from public.asset where id = '30000000-0000-0000-7e57-000000000002'),
  null, 'IAC-R05 fix: last-inspection date recomputed');

-- INS-R06: deleting the last allocation deletes the instruction.
select is(
  (public.delete_instruction_allocation(
    (select ia.id from public.instruction_asset_allocation ia join public.instruction i on i.id = ia.instruction_id
     where i.name = 'Weekly check' and ia.asset_id = '30000000-0000-0000-7e57-000000000001')) ->> 'instruction_deleted')::boolean,
  false, 'First allocation deleted, instruction kept');
select is(
  (public.delete_instruction_allocation(
    (select ia.id from public.instruction_asset_allocation ia join public.instruction i on i.id = ia.instruction_id
     where i.name = 'Weekly check')) ->> 'instruction_deleted')::boolean,
  true, 'Last allocation deleted, instruction deleted');

-- ============================================================================
-- Scheduled issuing (SCH-R09/R10, §5)
-- ============================================================================
select lives_ok(
  $$select public.save_scheduled_instruction(jsonb_build_object(
      'name', 'Daily round', 'schedule_type', 'daily', 'days_to_complete', 2,
      'account_id', '10000000-0000-0000-7e57-000000000001',
      'asset_ids', jsonb_build_array('30000000-0000-0000-7e57-000000000001', '30000000-0000-0000-7e57-000000000002')))$$,
  'Daily schedule saved');
select lives_ok(
  $$select public.save_scheduled_instruction(jsonb_build_object(
      'name', 'Mon/Wed', 'schedule_type', 'weekly', 'week_days', jsonb_build_array(1, 3),
      'account_id', '10000000-0000-0000-7e57-000000000001',
      'asset_ids', jsonb_build_array('30000000-0000-0000-7e57-000000000001')))$$,
  'Weekly schedule saved');
select lives_ok(
  $$select public.save_scheduled_instruction(jsonb_build_object(
      'name', 'Monthly 15th', 'schedule_type', 'monthly', 'day_of_month', 15,
      'account_id', '10000000-0000-0000-7e57-000000000001',
      'asset_ids', jsonb_build_array('30000000-0000-0000-7e57-000000000001')))$$,
  'Monthly schedule saved');

select throws_ok(
  $$select public.save_scheduled_instruction(jsonb_build_object(
      'name', 'x', 'schedule_type', 'daily', 'account_id', '10000000-0000-0000-7e57-000000000001', 'asset_ids', '[]'::jsonb))$$,
  'P0001', 'Please assign Assets.', 'SCH-R03');
select throws_ok(
  $$select public.save_scheduled_instruction(jsonb_build_object(
      'name', 'x', 'schedule_type', 'monthly', 'day_of_month', 31,
      'account_id', '10000000-0000-0000-7e57-000000000001',
      'asset_ids', jsonb_build_array('30000000-0000-0000-7e57-000000000001')))$$,
  'P0001', 'Day of month must be between 1 and 30.', 'SCH-R05: 31 rejected');
select throws_ok(
  $$select public.save_scheduled_instruction(jsonb_build_object(
      'name', 'x', 'schedule_type', 'weekly',
      'account_id', '10000000-0000-0000-7e57-000000000001',
      'asset_ids', jsonb_build_array('30000000-0000-0000-7e57-000000000001')))$$,
  'P0001', 'Choose at least one day.', 'SCH-R06');

-- Wednesday 2026-09-30.
select is(
  (public.issue_scheduled_instructions('2026-09-30', 'manual') ->> 'issued')::integer,
  2, 'Wednesday: daily and Mon/Wed issue');
select is(
  (public.issue_scheduled_instructions('2026-09-30', 'manual') ->> 'issued')::integer,
  0, 'Running again the same day issues nothing (idempotent)');
select is(
  (select required_completed_date::text || ' ' || nr_of_allocations::text || ' ' || is_scheduled::text
   from public.instruction where name = 'Daily round' and issue_date = '2026-09-30'),
  '2026-10-02 2 true', 'Due date = issue day + days to complete; 2 assets');
-- Saturday 2026-10-03: daily without weekends is skipped.
select is(
  (public.issue_scheduled_instructions('2026-10-03', 'manual') ->> 'issued')::integer,
  0, 'Saturday: daily without weekends skipped');
-- A public holiday on Thursday 2026-10-01.
insert into public.public_holiday (holiday_date, name) values ('2026-10-01', 'Test holiday');
select is(
  (public.issue_scheduled_instructions('2026-10-01', 'manual') ->> 'issued')::integer,
  0, 'Public holiday: daily without holidays skipped');
select is(
  (public.issue_scheduled_instructions('2026-10-15', 'manual') ->> 'issued')::integer,
  2, 'The 15th (Thursday): daily and monthly issue');

update public.scheduled_instruction set active = false where name = 'Daily round';
select is(
  (public.issue_scheduled_instructions('2026-10-16', 'manual') ->> 'issued')::integer,
  0, 'Inactive schedule doesn''t issue');

select is(
  (select count(*)::integer from public.instruction_schedule_run where status = 'success' and trigger = 'manual' and triggered_by is null),
  6, 'Every run is logged');

select * from finish();
rollback;
