-- Tests for the offline field app's commands (Aquafix Capture spec,
-- "Migration drafts" §2 and §3): idempotent resends (client_command),
-- captured_at bounds and dates, the phone's own ids, the today-only rule on
-- capture time, overtaken meter readings, late status taps and
-- save_stock_document. PWA-style calls (no new fields) are covered by the
-- existing inspections / stock tests; a few are repeated here next to their
-- offline counterparts.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup (superuser: no RLS)
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-0ff1-000000000001', '00000000-0000-0000-0ff1-000000000000', 'authenticated', 'authenticated',
   'of-user@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-0ff1-000000000002', '00000000-0000-0000-0ff1-000000000000', 'authenticated', 'authenticated',
   'of-admin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-0ff1-000000000003', '00000000-0000-0000-0ff1-000000000000', 'authenticated', 'authenticated',
   'of-viewer@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-0ff1-000000000004', '00000000-0000-0000-0ff1-000000000000', 'authenticated', 'authenticated',
   'of-sysadmin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-0ff1-000000000005', '00000000-0000-0000-0ff1-000000000000', 'authenticated', 'authenticated',
   'of-norole@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-0ff1-000000000001', 'user'),
  ('10000000-0000-0000-0ff1-000000000002', 'admin'),
  ('10000000-0000-0000-0ff1-000000000003', 'viewer'),
  ('10000000-0000-0000-0ff1-000000000004', 'system_admin');

insert into public.region (id, name) values ('a0000000-0000-0000-0ff1-000000000001', 'OF-North');
insert into public.organisation (id, name) values ('a1000000-0000-0000-0ff1-000000000001', 'OF-ORG');
insert into public.location (id, name, region_id, organisation_id)
values ('a2000000-0000-0000-0ff1-000000000001', 'OF-Plant', 'a0000000-0000-0000-0ff1-000000000001', 'a1000000-0000-0000-0ff1-000000000001');
insert into public.asset_type (id, name) values ('a3000000-0000-0000-0ff1-000000000001', 'OF-Pump');
insert into public.asset (id, name, code, asset_type_id, location_id) values
  ('30000000-0000-0000-0ff1-000000000001', 'OF Pump 1', 'OF-P1', 'a3000000-0000-0000-0ff1-000000000001', 'a2000000-0000-0000-0ff1-000000000001'),
  ('30000000-0000-0000-0ff1-000000000002', 'OF Pump 2', 'OF-P2', 'a3000000-0000-0000-0ff1-000000000001', 'a2000000-0000-0000-0ff1-000000000001');

insert into public.incident_type (id, name) values
  ('60000000-0000-0000-0ff1-000000000001', 'OF-Auto'),
  ('60000000-0000-0000-0ff1-000000000002', 'OF-Leak');

insert into public.inspection (id, name, value_type, is_required, nr_of_images_required) values
  ('40000000-0000-0000-0ff1-000000000001', 'OF Chlorine', 'DECIMAL_VALUE', true, 0),
  ('40000000-0000-0000-0ff1-000000000002', 'OF Meter', 'CUMULATIVE_VALUE', true, 0),
  ('40000000-0000-0000-0ff1-000000000003', 'OF Notes', 'TEXT', true, 0);
-- Chlorine below 1: one retry, then an auto-incident (C5).
insert into public.inspection_rule (id, inspection_id, lower_limit, upper_limit, nr_of_images_required) values
  ('50000000-0000-0000-0ff1-000000000001', '40000000-0000-0000-0ff1-000000000001', 0, 1, 0);
insert into public.feedback (inspection_rule_id, feedback, max_nr_of_retries, auto_create_incident, incident_type_id)
values ('50000000-0000-0000-0ff1-000000000001', 'Low chlorine', 1, true, '60000000-0000-0000-0ff1-000000000001');

-- Pump 1's meter stands at 100; Pump 2 has no reading yet.
insert into public.inspection_cumulative_value (inspection_id, asset_id, latest_value) values
  ('40000000-0000-0000-0ff1-000000000002', '30000000-0000-0000-0ff1-000000000001', 100);

-- Stock master data: one item, two storage areas.
insert into public.unit_of_measure (id, code, name, uom_type) values
  ('c0000000-0000-0000-0ff1-000000000001', 'OF-L', 'OF Litre', 'VOLUME');
insert into public.product_type (id, code, name) values ('c1000000-0000-0000-0ff1-000000000001', 'OFC', 'OF Chem');
insert into public.product (id, code, name, product_type_id, uom_id) values
  ('c2000000-0000-0000-0ff1-000000000001', 'OFCHLOR', 'OFCHLOR', 'c1000000-0000-0000-0ff1-000000000001', 'c0000000-0000-0000-0ff1-000000000001');
insert into public.pack_type (id, name, qty, uom_id) values
  ('c3000000-0000-0000-0ff1-000000000001', 'OF 5 Litre Drum', 5, 'c0000000-0000-0000-0ff1-000000000001'),
  ('c3000000-0000-0000-0ff1-000000000002', 'OF 1 Litre Bottle', 1, 'c0000000-0000-0000-0ff1-000000000001');
insert into public.item (id, name, product_id, pack_type_id) values
  ('c7000000-0000-0000-0ff1-000000000001', 'OF drum', 'c2000000-0000-0000-0ff1-000000000001', 'c3000000-0000-0000-0ff1-000000000001'),
  ('c7000000-0000-0000-0ff1-000000000002', 'OF bottle', 'c2000000-0000-0000-0ff1-000000000001', 'c3000000-0000-0000-0ff1-000000000002');
insert into public.storage_area (id, code, name, location_id) values
  ('c8000000-0000-0000-0ff1-000000000001', 'OFA', 'OF Area A', 'a2000000-0000-0000-0ff1-000000000001'),
  ('c8000000-0000-0000-0ff1-000000000002', 'OFB', 'OF Area B', 'a2000000-0000-0000-0ff1-000000000001');

-- ============================================================================
-- Helpers
-- ============================================================================
grant usage on schema extensions to authenticated;

create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub": "10000000-0000-0000-0ff1-%s", "role": "authenticated"}', lpad(p_n::text, 12, '0')), true);
$$;

-- Value payloads.
create function pg_temp.chlorine(p_id text, p_value numeric, p_current boolean) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'inspection_id', '40000000-0000-0000-0ff1-000000000001',
    'is_current', p_current, 'decimal_value', p_value, 'images', '[]'::jsonb);
$$;
create function pg_temp.meter(p_id text, p_value numeric) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'inspection_id', '40000000-0000-0000-0ff1-000000000002',
    'is_current', true, 'decimal_value', p_value, 'images', '[]'::jsonb);
$$;
create function pg_temp.notes(p_id text, p_text text) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'inspection_id', '40000000-0000-0000-0ff1-000000000003',
    'is_current', true, 'text_value', p_text, 'images', '[]'::jsonb);
$$;

create function pg_temp.messages(p_result jsonb) returns text[] language sql as $$
  select coalesce(array_agg(m ->> 'message' order by ord), '{}')
  from jsonb_array_elements(p_result -> 'messages') with ordinality as t(m, ord);
$$;

-- 23:50 yesterday and 23:55 yesterday in the app time zone.
create function pg_temp.yesterday_at(p_time time) returns timestamptz language sql as $$
  select ((public.app_today() - 1)::timestamp + p_time) at time zone public.app_time_zone();
$$;

create temp table r (name text primary key, result jsonb);
grant all on r to authenticated;

select pg_temp.as_user(1);

-- ============================================================================
-- client_command
-- ============================================================================
select is(
  (select relrowsecurity from pg_class where oid = 'public.client_command'::regclass), true,
  'client_command has RLS on');
select is(
  (select count(*)::integer from pg_policies where tablename = 'client_command'), 0,
  'client_command has no policies');
select ok(not has_table_privilege('authenticated', 'public.client_command', 'select'),
  'authenticated cannot read client_command directly');
select ok(not has_table_privilege('authenticated', 'public.client_command', 'insert'),
  'authenticated cannot write client_command directly');
select is((select schedule from cron.job where jobname = 'client-command-cleanup'), '15 3 * * *',
  'cleanup cron job is scheduled');

-- ============================================================================
-- save_inspection_activity: a resent ok:false keeps one auto-incident
-- ============================================================================
create function pg_temp.auto_incidents() returns bigint language sql as $$
  select count(*) from public.incident where incident_type_id = '60000000-0000-0000-0ff1-000000000001';
$$;

insert into r values ('C1 payload', jsonb_build_object(
  'command_id', 'e0000000-0000-0000-0ff1-000000000001',
  'activity_id', 'b0000000-0000-0000-0ff1-000000000001',
  'captured_at', now() - interval '30 minutes',
  'asset_id', '30000000-0000-0000-0ff1-000000000001',
  'values', jsonb_build_array(
    -- the retry already taken (superseded), then a second low reading
    pg_temp.chlorine('90000000-0000-0000-0ff1-000000000001', 0.5, false),
    pg_temp.chlorine('90000000-0000-0000-0ff1-000000000005', 0.4, true),
    pg_temp.notes('90000000-0000-0000-0ff1-000000000002', ''))));
insert into r values ('C1', public.save_inspection_activity((select result from r where name = 'C1 payload')));
select is((select (result ->> 'ok')::boolean from r where name = 'C1'), false, 'C1: invalid (Notes required)');
select is(pg_temp.auto_incidents(), 1::bigint, 'C1: the auto-incident is committed');
select is(
  (select incident_date from public.incident where incident_type_id = '60000000-0000-0000-0ff1-000000000001'),
  now() - interval '30 minutes', 'C1: the auto-incident is dated captured_at');

insert into r values ('C1 resend', public.save_inspection_activity((select result from r where name = 'C1 payload')));
select is((select result from r where name = 'C1 resend'), (select result from r where name = 'C1'),
  'C1 resent: the first result is returned');
select is(pg_temp.auto_incidents(), 1::bigint, 'C1 resent: no second auto-incident');
select is((select count(*)::integer from public.client_command where id = 'e0000000-0000-0000-0ff1-000000000001'), 1,
  'C1: one stored command');
select is((select user_id from public.client_command where id = 'e0000000-0000-0000-0ff1-000000000001'),
  '10000000-0000-0000-0ff1-000000000001'::uuid, 'C1: stored for the caller');

-- The same id under another RPC is refused.
select throws_ok(
  $$select public.save_incident(jsonb_build_object('command_id', 'e0000000-0000-0000-0ff1-000000000001',
    'incident_type_id', '60000000-0000-0000-0ff1-000000000002', 'location_id', 'a2000000-0000-0000-0ff1-000000000001',
    'comment', 'x'))$$,
  'P0001', 'That command id was already used for something else.', 'a command id is tied to its RPC');
-- ... and another user's id is refused too.
select pg_temp.as_user(2);
select throws_ok(
  $$select public.save_inspection_activity((select result from r where name = 'C1 payload'))$$,
  'P0001', 'That command id was already used for something else.', 'a command id is tied to its user');
select pg_temp.as_user(1);

-- ============================================================================
-- save_inspection_activity: activity_id create then edit, captured_at
-- ============================================================================
insert into r values ('C2 payload', jsonb_build_object(
  'command_id', 'e0000000-0000-0000-0ff1-000000000002',
  'activity_id', 'b0000000-0000-0000-0ff1-000000000002',
  'captured_at', now() - interval '1 minute',
  'asset_id', '30000000-0000-0000-0ff1-000000000001',
  'values', jsonb_build_array(pg_temp.meter('90000000-0000-0000-0ff1-000000000003', 150))));
insert into r values ('C2', public.save_inspection_activity((select result from r where name = 'C2 payload')));
select is((select (result ->> 'ok')::boolean from r where name = 'C2'), true, 'C2: saved');
select is((select result ->> 'id' from r where name = 'C2'), 'b0000000-0000-0000-0ff1-000000000002',
  'C2: the activity has the phone''s id');
select is((select inspection_date from public.inspection_activity where id = 'b0000000-0000-0000-0ff1-000000000002'),
  now() - interval '1 minute', 'C2: inspection_date = captured_at');
select is((select latest_value from public.inspection_cumulative_value
           where inspection_id = '40000000-0000-0000-0ff1-000000000002' and asset_id = '30000000-0000-0000-0ff1-000000000001'),
  150::numeric, 'C2: cumulative store moves to 150');
select is((select last_inspection_date from public.asset where id = '30000000-0000-0000-0ff1-000000000001'),
  now() - interval '1 minute', 'C2: asset last_inspection_date = captured_at');

insert into r values ('C2 resend', public.save_inspection_activity((select result from r where name = 'C2 payload')));
select is((select result from r where name = 'C2 resend'), (select result from r where name = 'C2'),
  'C2 resent: the first result is returned');
select is((select count(*)::integer from public.inspection_value
           where inspection_activity_id = 'b0000000-0000-0000-0ff1-000000000002'), 1, 'C2 resent: one value');

-- A resend is answered from the store even once captured_at is out of bounds.
insert into r values ('C2 late resend', public.save_inspection_activity(
  (select result from r where name = 'C2 payload') || jsonb_build_object('captured_at', now() - interval '8 days')));
select is((select result from r where name = 'C2 late resend'), (select result from r where name = 'C2'),
  'C2 resent 8 days later: the stored result, no bounds check');

-- Edit through activity_id.
insert into r values ('C3', public.save_inspection_activity(jsonb_build_object(
  'command_id', 'e0000000-0000-0000-0ff1-000000000003',
  'activity_id', 'b0000000-0000-0000-0ff1-000000000002',
  'captured_at', now(),
  'values', jsonb_build_array(pg_temp.meter('90000000-0000-0000-0ff1-000000000003', 160)))));
select is((select (result ->> 'ok')::boolean from r where name = 'C3'), true, 'C3: edit saved');
select is((select result ->> 'id' from r where name = 'C3'), 'b0000000-0000-0000-0ff1-000000000002', 'C3: same activity');
select is((select count(*)::integer from public.inspection_activity where id = 'b0000000-0000-0000-0ff1-000000000002'), 1,
  'C3: no second activity');
select is((select decimal_value from public.inspection_value where id = '90000000-0000-0000-0ff1-000000000003'),
  160::numeric, 'C3: the value is edited');
select is((select inspection_date from public.inspection_activity where id = 'b0000000-0000-0000-0ff1-000000000002'),
  now(), 'C3: an edit with captured_at takes it as inspection_date');

-- Bounds.
select throws_ok(
  $$select public.save_inspection_activity(jsonb_build_object('captured_at', now() + interval '10 minutes',
    'asset_id', '30000000-0000-0000-0ff1-000000000001',
    'values', jsonb_build_array(pg_temp.notes('90000000-0000-0000-0ff1-000000000098', 'x'))))$$,
  'P0001', 'The capture time is in the future. Check the phone''s clock.', 'activity: future captured_at refused');
select throws_ok(
  $$select public.save_inspection_activity(jsonb_build_object('captured_at', now() - interval '8 days',
    'asset_id', '30000000-0000-0000-0ff1-000000000001',
    'values', jsonb_build_array(pg_temp.notes('90000000-0000-0000-0ff1-000000000098', 'x'))))$$,
  'P0001', 'This was captured more than 7 days ago and can''t be saved.', 'activity: captured_at > 7 days refused');
select lives_ok(
  $$select public.save_inspection_activity(jsonb_build_object('captured_at', now() + interval '4 minutes',
    'asset_id', '30000000-0000-0000-0ff1-000000000002',
    'values', jsonb_build_array(pg_temp.notes('90000000-0000-0000-0ff1-000000000099', 'x'))))$$,
  'activity: a clock 4 minutes fast is accepted');

-- ============================================================================
-- Today-only rule (IAC-R06) judged on captured_at
-- ============================================================================
insert into r values ('AY', public.save_inspection_activity(jsonb_build_object(
  'activity_id', 'b0000000-0000-0000-0ff1-000000000003',
  'captured_at', pg_temp.yesterday_at('23:50'),
  'asset_id', '30000000-0000-0000-0ff1-000000000001',
  'values', jsonb_build_array(pg_temp.notes('90000000-0000-0000-0ff1-000000000004', 'late night')))));
select is((select (result ->> 'ok')::boolean from r where name = 'AY'), true, 'AY: captured 23:50 yesterday, saved today');

select throws_ok(
  $$select public.save_inspection_activity(jsonb_build_object('id', 'b0000000-0000-0000-0ff1-000000000003',
    'values', jsonb_build_array(pg_temp.notes('90000000-0000-0000-0ff1-000000000004', 'edit'))))$$,
  '42501', 'You can only edit your own inspections from today.', 'AY: a PWA edit today is refused (as before)');
select lives_ok(
  $$select public.save_inspection_activity(jsonb_build_object('activity_id', 'b0000000-0000-0000-0ff1-000000000003',
    'captured_at', pg_temp.yesterday_at('23:55'),
    'values', jsonb_build_array(pg_temp.notes('90000000-0000-0000-0ff1-000000000004', 'edit'))))$$,
  'AY: an edit captured the same day (23:55 yesterday) passes');
select is((select text_value from public.inspection_value where id = '90000000-0000-0000-0ff1-000000000004'), 'edit',
  'AY: the edit is saved');
select throws_ok(
  $$select public.save_inspection_activity(jsonb_build_object('activity_id', 'b0000000-0000-0000-0ff1-000000000003',
    'captured_at', now(),
    'values', jsonb_build_array(pg_temp.notes('90000000-0000-0000-0ff1-000000000004', 'edit 2'))))$$,
  '42501', 'You can only edit your own inspections from today.', 'AY: an edit captured another day is refused');
select is((select last_inspection_date from public.asset where id = '30000000-0000-0000-0ff1-000000000001'),
  now(), 'AY: a late older capture never moves last_inspection_date back');

-- ============================================================================
-- Overtaken meter reading (Pump 2, no store row yet)
-- ============================================================================
create function pg_temp.read_meter(p_activity text, p_value text, p_value_n numeric, p_ago interval) returns jsonb
language sql as $$
  select public.save_inspection_activity(jsonb_build_object(
    'activity_id', p_activity,
    'captured_at', now() - p_ago,
    'asset_id', '30000000-0000-0000-0ff1-000000000002',
    'values', jsonb_build_array(pg_temp.meter(p_value, p_value_n))));
$$;
create function pg_temp.store2() returns numeric language sql as $$
  select latest_value from public.inspection_cumulative_value
  where inspection_id = '40000000-0000-0000-0ff1-000000000002' and asset_id = '30000000-0000-0000-0ff1-000000000002';
$$;

insert into r values ('X', pg_temp.read_meter('b0000000-0000-0000-0ff1-000000000011', '90000000-0000-0000-0ff1-000000000011', 500, '3 hours'));
insert into r values ('Y', pg_temp.read_meter('b0000000-0000-0000-0ff1-000000000012', '90000000-0000-0000-0ff1-000000000012', 600, '2 hours'));
select is((select (result ->> 'ok')::boolean from r where name = 'Y'), true, 'Y: 600 after 500');
select is(pg_temp.store2(), 600::numeric, 'Y: store at 600');

insert into r values ('Z', pg_temp.read_meter('b0000000-0000-0000-0ff1-000000000013', '90000000-0000-0000-0ff1-000000000013', 550, '150 minutes'));
select is((select (result ->> 'ok')::boolean from r where name = 'Z'), true,
  'Z: 550 captured between 500 and 600 is accepted (overtaken reading)');
select is((select decimal_value from public.inspection_value where id = '90000000-0000-0000-0ff1-000000000013'),
  550::numeric, 'Z: the value is saved as captured');
select is(pg_temp.store2(), 600::numeric, 'Z: the store keeps the higher 600');

insert into r values ('W', pg_temp.read_meter('b0000000-0000-0000-0ff1-000000000014', '90000000-0000-0000-0ff1-000000000014', 450, '160 minutes'));
select is((select (result ->> 'ok')::boolean from r where name = 'W'), false, 'W: 450 after 500 is refused');
select is(pg_temp.messages((select result from r where name = 'W')),
  array['Must be >= to previous value of 500'], 'W: A5 compares with the earlier reading');

insert into r values ('Q', pg_temp.read_meter('b0000000-0000-0000-0ff1-000000000015', '90000000-0000-0000-0ff1-000000000015', 10, '4 hours'));
select is(pg_temp.messages((select result from r where name = 'Q')),
  array['Must be >= to previous value of 600'], 'Q: no earlier reading falls back to the store');

insert into r values ('P', public.save_inspection_activity(jsonb_build_object(
  'asset_id', '30000000-0000-0000-0ff1-000000000002',
  'values', jsonb_build_array(pg_temp.meter('90000000-0000-0000-0ff1-000000000016', 580)))));
select is(pg_temp.messages((select result from r where name = 'P')),
  array['Must be >= to previous value of 600'], 'P: without captured_at A5 checks the store, as before');

insert into r values ('P2', public.save_inspection_activity(jsonb_build_object(
  'asset_id', '30000000-0000-0000-0ff1-000000000002',
  'values', jsonb_build_array(pg_temp.meter('90000000-0000-0000-0ff1-000000000017', 700)))));
select is((select (result ->> 'ok')::boolean from r where name = 'P2'), true, 'P2: PWA save still works');
select is((select inspection_date from public.inspection_activity where id = (select (result ->> 'id')::uuid from r where name = 'P2')),
  now(), 'P2: PWA inspection_date = now()');
select is(pg_temp.store2(), 700::numeric, 'P2: store moves to 700');

-- ============================================================================
-- Incidents (SECURITY INVOKER: run as the authenticated role)
-- ============================================================================
create function pg_temp.incident_payload(p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object('incident_type_id', '60000000-0000-0000-0ff1-000000000002',
    'location_id', 'a2000000-0000-0000-0ff1-000000000001', 'comment', 'OF leak') || p_extra;
$$;
grant execute on function pg_temp.incident_payload(jsonb) to authenticated;
grant execute on function pg_temp.as_user(integer) to authenticated;

insert into r values ('I1 payload', pg_temp.incident_payload(jsonb_build_object(
  'command_id', 'e0000000-0000-0000-0ff1-000000000021',
  'client_id', 'd0000000-0000-0000-0ff1-000000000001',
  'captured_at', now() - interval '1 hour')));

set local role authenticated;
insert into r values ('I1', public.save_incident((select result from r where name = 'I1 payload')));
insert into r values ('I1 resend', public.save_incident((select result from r where name = 'I1 payload')));
select throws_ok(
  $$select public.save_incident(pg_temp.incident_payload(jsonb_build_object('captured_at', now() + interval '6 minutes')))$$,
  'P0001', 'The capture time is in the future. Check the phone''s clock.', 'incident: future captured_at refused');
select throws_ok(
  $$select public.save_incident(pg_temp.incident_payload(jsonb_build_object('captured_at', now() - interval '7 days 1 minute')))$$,
  'P0001', 'This was captured more than 7 days ago and can''t be saved.', 'incident: captured_at > 7 days refused');
-- client_id that exists: an edit.
insert into r values ('I1 edit', public.save_incident(pg_temp.incident_payload(jsonb_build_object(
  'client_id', 'd0000000-0000-0000-0ff1-000000000001', 'comment', 'OF leak, worse',
  'captured_at', now()))));
-- PWA-style create.
insert into r values ('I2', public.save_incident(pg_temp.incident_payload('{"comment": "OF PWA leak"}')));
reset role;

select is((select result ->> 'id' from r where name = 'I1'), 'd0000000-0000-0000-0ff1-000000000001',
  'I1: the incident has the phone''s id');
select is((select incident_date from public.incident where id = 'd0000000-0000-0000-0ff1-000000000001'),
  now() - interval '1 hour', 'I1: incident_date = captured_at');
select is((select created_by from public.incident where id = 'd0000000-0000-0000-0ff1-000000000001'),
  '10000000-0000-0000-0ff1-000000000001'::uuid, 'I1: created_by from the session');
select is((select result from r where name = 'I1 resend'), (select result from r where name = 'I1'),
  'I1 resent: the first result is returned');
select is((select count(*)::integer from public.incident where comment like 'OF leak%'), 1, 'I1 resent: one incident');
select is((select comment from public.incident where id = 'd0000000-0000-0000-0ff1-000000000001'), 'OF leak, worse',
  'I1 edit: an existing client_id edits the incident');
select is((select incident_date from public.incident where id = 'd0000000-0000-0000-0ff1-000000000001'),
  now() - interval '1 hour', 'I1 edit: incident_date unchanged by an edit');
select is((select incident_date from public.incident where id = (select (result ->> 'id')::uuid from r where name = 'I2')),
  now(), 'I2: PWA incident_date = now()');
select ok(not has_column_privilege('authenticated', 'public.incident', 'incident_date', 'insert'),
  'incident_date is still not insertable by clients');

-- Notes.
set local role authenticated;
select is(public.add_incident_note('d0000000-0000-0000-0ff1-000000000001', 'OF note', '[]'::jsonb,
  'd1000000-0000-0000-0ff1-000000000001', 'e0000000-0000-0000-0ff1-000000000022', now() - interval '20 minutes'),
  'd1000000-0000-0000-0ff1-000000000001'::uuid, 'N1: the note has the phone''s id');
select is(public.add_incident_note('d0000000-0000-0000-0ff1-000000000001', 'OF note', '[]'::jsonb,
  'd1000000-0000-0000-0ff1-000000000001', 'e0000000-0000-0000-0ff1-000000000022', now() - interval '20 minutes'),
  'd1000000-0000-0000-0ff1-000000000001'::uuid, 'N1 resent: the first note id is returned');
select throws_ok(
  $$select public.add_incident_note(p_incident_id => 'd0000000-0000-0000-0ff1-000000000001', p_body => 'x',
    p_captured_at => now() + interval '6 minutes')$$,
  'P0001', 'The capture time is in the future. Check the phone''s clock.', 'note: future captured_at refused');
select throws_ok(
  $$select public.add_incident_note(p_incident_id => 'd0000000-0000-0000-0ff1-000000000001', p_body => 'x',
    p_captured_at => now() - interval '8 days')$$,
  'P0001', 'This was captured more than 7 days ago and can''t be saved.', 'note: captured_at > 7 days refused');
-- PWA-style named call.
insert into r values ('N2', to_jsonb(public.add_incident_note(p_incident_id => 'd0000000-0000-0000-0ff1-000000000001',
  p_body => 'OF PWA note', p_images => '[]'::jsonb)));
reset role;

select is((select created_at from public.incident_note where id = 'd1000000-0000-0000-0ff1-000000000001'),
  now() - interval '20 minutes', 'N1: created_at = captured_at');
select is((select count(*)::integer from public.incident_note where body = 'OF note'), 1, 'N1 resent: one note');
select is((select created_at from public.incident_note where id = (select (result #>> '{}')::uuid from r where name = 'N2')),
  now(), 'N2: a PWA note after an offline one gets now() (setting cleared)');
select is((select count(*)::integer from pg_proc where proname = 'add_incident_note'), 1, 'add_incident_note has one overload');
select is((select count(*)::integer from pg_proc where proname = 'advance_incident_status'), 1,
  'advance_incident_status has one overload');

-- Status taps.
set local role authenticated;
select is(public.advance_incident_status('d0000000-0000-0000-0ff1-000000000001', 'new', 'e0000000-0000-0000-0ff1-000000000023'),
  'in_progress'::public.incident_status, 'S1: Start');
select is(public.advance_incident_status('d0000000-0000-0000-0ff1-000000000001', 'new', 'e0000000-0000-0000-0ff1-000000000023'),
  'in_progress'::public.incident_status, 'S1 resent: the first result');
select is(public.advance_incident_status('d0000000-0000-0000-0ff1-000000000001', 'new', 'e0000000-0000-0000-0ff1-000000000024'),
  'in_progress'::public.incident_status, 'S2: a second Start (already at the target) succeeds');
select is(public.advance_incident_status('d0000000-0000-0000-0ff1-000000000001', 'in_progress', 'e0000000-0000-0000-0ff1-000000000025'),
  'completed'::public.incident_status, 'S3: Complete');
select is(public.advance_incident_status('d0000000-0000-0000-0ff1-000000000001', 'new'),
  'completed'::public.incident_status, 'S4: a late Start past the target succeeds (PWA call)');
reset role;
select is((select count(*)::integer from public.incident_status_change
           where incident_id = 'd0000000-0000-0000-0ff1-000000000001'), 3,
  'status history: created, in progress, completed (nothing twice)');

-- An admin moves it back to New; a late Complete is now below its target.
select pg_temp.as_user(2);
select public.set_incident_status('d0000000-0000-0000-0ff1-000000000001', 'new');
select pg_temp.as_user(1);
set local role authenticated;
select throws_ok(
  $$select public.advance_incident_status('d0000000-0000-0000-0ff1-000000000001', 'in_progress', 'e0000000-0000-0000-0ff1-000000000026')$$,
  'P0001', 'That incident has changed; reload and try again.', 'S5: below the target raises');
reset role;
select is((select count(*)::integer from public.client_command where id = 'e0000000-0000-0000-0ff1-000000000026'), 0,
  'S5: a raised rejection is not stored');

-- ============================================================================
-- save_stock_document (SECURITY INVOKER: run as the authenticated role)
-- ============================================================================
create function pg_temp.stock(p_area text) returns numeric language sql as $$
  select coalesce((select qty from public.storage_area_item_stock
                    where item_id = 'c7000000-0000-0000-0ff1-000000000001' and storage_area_id = p_area::uuid), 0);
$$;

set local role authenticated;
-- Stock take: count 10 in area A.
insert into r values ('ST', public.save_stock_document(jsonb_build_object(
  'command_id', 'e0000000-0000-0000-0ff1-000000000031',
  'captured_at', now() - interval '1 hour',
  'kind', 'stock-takes',
  'header', jsonb_build_object('id', 'f0000000-0000-0000-0ff1-000000000001',
    'storage_area_id', 'c8000000-0000-0000-0ff1-000000000001', 'comment', '  '),
  'lines', jsonb_build_array(jsonb_build_object('id', 'f1000000-0000-0000-0ff1-000000000001',
    'item_id', 'c7000000-0000-0000-0ff1-000000000001', 'counted_qty', '10')))));
-- Transfer 3 from A to B, twice (resend).
insert into r values ('TR payload', jsonb_build_object(
  'command_id', 'e0000000-0000-0000-0ff1-000000000032',
  'captured_at', now() - interval '30 minutes',
  'kind', 'transfers',
  'header', jsonb_build_object('id', 'f0000000-0000-0000-0ff1-000000000002', 'transfer_type', 'BOTH',
    'from_storage_area_id', 'c8000000-0000-0000-0ff1-000000000001',
    'to_storage_area_id', 'c8000000-0000-0000-0ff1-000000000002', 'comment', 'OF move'),
  'lines', jsonb_build_array(jsonb_build_object('id', 'f1000000-0000-0000-0ff1-000000000002',
    'item_id', 'c7000000-0000-0000-0ff1-000000000001', 'qty', 3))));
insert into r values ('TR', public.save_stock_document((select result from r where name = 'TR payload')));
insert into r values ('TR resend', public.save_stock_document((select result from r where name = 'TR payload')));
-- Work order in A: use 2 drums, return 1 bottle (line date given).
insert into r values ('WO', public.save_stock_document(jsonb_build_object(
  'command_id', 'e0000000-0000-0000-0ff1-000000000033',
  'captured_at', now() - interval '10 minutes',
  'kind', 'work-orders',
  'header', jsonb_build_object('id', 'f0000000-0000-0000-0ff1-000000000003',
    'storage_area_id', 'c8000000-0000-0000-0ff1-000000000001'),
  'lines', jsonb_build_array(
    jsonb_build_object('id', 'f1000000-0000-0000-0ff1-000000000003', 'item_id', 'c7000000-0000-0000-0ff1-000000000001', 'qty', 2),
    jsonb_build_object('id', 'f1000000-0000-0000-0ff1-000000000004', 'item_id', 'c7000000-0000-0000-0ff1-000000000002', 'qty', 1,
      'is_return', true, 'transaction_date', now() - interval '5 minutes')))));
-- A header date wins over captured_at.
insert into r values ('TR2', public.save_stock_document(jsonb_build_object(
  'captured_at', now() - interval '30 minutes',
  'kind', 'transfers',
  'header', jsonb_build_object('transfer_type', 'RECEIVE', 'transfer_date', now() - interval '2 days',
    'from_storage_area_id', 'c8000000-0000-0000-0ff1-000000000001',
    'to_storage_area_id', 'c8000000-0000-0000-0ff1-000000000002'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', 'c7000000-0000-0000-0ff1-000000000001', 'qty', 1)))));

-- Refusals.
select throws_ok(
  $$select public.save_stock_document(jsonb_build_object('kind', 'transfers', 'captured_at', now() + interval '6 minutes',
    'header', jsonb_build_object('transfer_type', 'SEND', 'from_storage_area_id', 'c8000000-0000-0000-0ff1-000000000001'),
    'lines', jsonb_build_array(jsonb_build_object('item_id', 'c7000000-0000-0000-0ff1-000000000001', 'qty', 1))))$$,
  'P0001', 'The capture time is in the future. Check the phone''s clock.', 'stock: future captured_at refused');
select throws_ok(
  $$select public.save_stock_document(jsonb_build_object('kind', 'transfers', 'captured_at', now() - interval '8 days',
    'header', jsonb_build_object('transfer_type', 'SEND', 'from_storage_area_id', 'c8000000-0000-0000-0ff1-000000000001'),
    'lines', jsonb_build_array(jsonb_build_object('item_id', 'c7000000-0000-0000-0ff1-000000000001', 'qty', 1))))$$,
  'P0001', 'This was captured more than 7 days ago and can''t be saved.', 'stock: captured_at > 7 days refused');
select throws_ok(
  $$select public.save_stock_document('{"kind": "purchase-orders", "header": {}, "lines": []}')$$,
  'P0001', 'That kind of stock document can''t be saved here.', 'stock: unknown kind refused');
select throws_ok(
  $$select public.save_stock_document('{"kind": "stock-takes", "header": {"storage_area_id": "c8000000-0000-0000-0ff1-000000000001"}, "lines": []}')$$,
  'P0001', 'Add at least one item.', 'stock: a document with lines needs one');
select throws_ok(
  $$select public.save_stock_document('{"kind": "work-orders", "header": {"storage_area_id": "c8000000-0000-0000-0ff1-000000000001"},
    "lines": [{"item_id": "c7000000-0000-0000-0ff1-000000000001", "qty": "two"}]}')$$,
  'P0001', 'Line 1: Qty must be a number.', 'stock: a bad quantity is reported by line');
select throws_ok(
  $$select public.save_stock_document('{"kind": "transfers", "header": {"transfer_type": "SEND"},
    "lines": [{"item_id": "c7000000-0000-0000-0ff1-000000000001", "qty": 1}]}')$$,
  'P0001', 'From storage area is required.', 'stock: a SEND needs a from-area');
select throws_ok(
  $$select public.save_stock_document('{"kind": "stock-takes", "header": {"storage_area_id": "c8000000-0000-0000-0ff1-000000000001"},
    "lines": [{"item_id": "c7000000-0000-0000-0ff1-000000000001", "counted_qty": 1},
              {"item_id": "c7000000-0000-0000-0ff1-000000000001", "counted_qty": 2}]}')$$,
  'P0001', 'Each item can only be on a document once.', 'stock: an item twice on one document is refused');
select throws_ok(
  $$select public.save_stock_document(jsonb_build_object('kind', 'stock-takes',
    'header', jsonb_build_object('id', 'f0000000-0000-0000-0ff1-000000000001', 'storage_area_id', 'c8000000-0000-0000-0ff1-000000000001'),
    'lines', jsonb_build_array(jsonb_build_object('item_id', 'c7000000-0000-0000-0ff1-000000000001', 'counted_qty', 1))))$$,
  'P0001', 'This document, or one of its lines, was already saved.', 'stock: a reused document id (no command id) is refused');
-- A bad line after the header was written rolls the header back.
select throws_ok(
  $$select public.save_stock_document(jsonb_build_object('kind', 'transfers',
    'header', jsonb_build_object('id', 'f0000000-0000-0000-0ff1-000000000009', 'transfer_type', 'SEND',
      'from_storage_area_id', 'c8000000-0000-0000-0ff1-000000000001'),
    'lines', jsonb_build_array(
      jsonb_build_object('item_id', 'c7000000-0000-0000-0ff1-000000000001', 'qty', 1),
      jsonb_build_object('item_id', 'c7000000-0000-0000-0ff1-0000000000ff', 'qty', 1))))$$,
  'P0001', 'A storage area or item on this form no longer exists — reload and try again.', 'stock: a missing item is refused');
select throws_like(
  $$select public.save_stock_document(jsonb_build_object('kind', 'transfers',
    'header', jsonb_build_object('id', 'f0000000-0000-0000-0ff1-000000000010', 'transfer_type', 'SEND',
      'from_storage_area_id', 'c8000000-0000-0000-0ff1-000000000001'),
    'lines', jsonb_build_array(jsonb_build_object('item_id', 'c7000000-0000-0000-0ff1-000000000001', 'qty', 1000))))$$,
  'Not enough stock:%', 'stock: negative stock is raised by the call itself');
select throws_ok(
  $$select public.save_stock_document('{"kind": "loads", "header": {"load_date": "2026-11-01"}, "lines": []}')$$,
  '42501', 'You don''t have permission to save this document.', 'stock: a user cannot save a load (RLS)');

select pg_temp.as_user(3);
select throws_ok(
  $$select public.save_stock_document('{"kind": "transfers", "header": {"transfer_type": "SEND", "from_storage_area_id": "c8000000-0000-0000-0ff1-000000000001"},
    "lines": [{"item_id": "c7000000-0000-0000-0ff1-000000000001", "qty": 1}]}')$$,
  '42501', 'You don''t have permission to save this document.', 'stock: a viewer is refused (RLS)');
select pg_temp.as_user(5);
select throws_ok(
  $$select public.save_stock_document('{"kind": "work-orders", "header": {"storage_area_id": "c8000000-0000-0000-0ff1-000000000001"},
    "lines": [{"item_id": "c7000000-0000-0000-0ff1-000000000001", "qty": 1}]}')$$,
  '42501', 'You don''t have permission to save this document.', 'stock: a user without a role is refused (RLS)');

-- Loads: system_admin.
select pg_temp.as_user(4);
insert into r values ('LD', public.save_stock_document(jsonb_build_object(
  'command_id', 'e0000000-0000-0000-0ff1-000000000034',
  'captured_at', now() - interval '1 hour',
  'kind', 'loads',
  'header', jsonb_build_object('id', 'f0000000-0000-0000-0ff1-000000000004', 'driver', 'OF Driver', 'vehicle_reg_nr', 'OF 123'))));
insert into r values ('LD2', public.save_stock_document(jsonb_build_object(
  'kind', 'loads', 'header', jsonb_build_object('load_date', '2026-11-01'))));
select throws_ok(
  $$select public.save_stock_document('{"kind": "loads", "header": {}, "lines": [{"item_id": "c7000000-0000-0000-0ff1-000000000001", "qty": 1}]}')$$,
  'P0001', 'A load has no lines.', 'stock: a load with lines is refused');
select pg_temp.as_user(1);
reset role;

select is((select result ->> 'id' from r where name = 'ST'), 'f0000000-0000-0000-0ff1-000000000001', 'ST: the phone''s id');
select ok((select (result ->> 'reference') is not null from r where name = 'ST'), 'ST: a reference is returned');
select is((select take_date from public.stock_take where id = 'f0000000-0000-0000-0ff1-000000000001'),
  now() - interval '1 hour', 'ST: take_date = captured_at');
select is((select comment from public.stock_take where id = 'f0000000-0000-0000-0ff1-000000000001'), null,
  'ST: a blank comment is stored as null');
select is((select stock_take_id from public.stock_take_item where id = 'f1000000-0000-0000-0ff1-000000000001'),
  'f0000000-0000-0000-0ff1-000000000001'::uuid, 'ST: the line has the phone''s id');

select is((select result from r where name = 'TR resend'), (select result from r where name = 'TR'),
  'TR resent: the first result is returned');
select is((select count(*)::integer from public.transfer_main where comment = 'OF move'), 1, 'TR resent: one transfer');
select is((select count(*)::integer from public.transfer_item where transfer_id = 'f0000000-0000-0000-0ff1-000000000002'), 1,
  'TR resent: one line');
select is((select transfer_date from public.transfer_main where id = 'f0000000-0000-0000-0ff1-000000000002'),
  now() - interval '30 minutes', 'TR: transfer_date = captured_at');
select is((select created_by from public.transfer_main where id = 'f0000000-0000-0000-0ff1-000000000002'),
  '10000000-0000-0000-0ff1-000000000001'::uuid, 'TR: created_by from the session');
select is((select transfer_date from public.transfer_main where id = (select (result ->> 'id')::uuid from r where name = 'TR2')),
  now() - interval '2 days', 'TR2: the header''s own date wins');
select is((select from_storage_area_id from public.transfer_main where id = (select (result ->> 'id')::uuid from r where name = 'TR2')),
  null, 'TR2: a RECEIVE''s from-area is cleared, as on the PWA');

select is((select order_date from public.work_order where id = 'f0000000-0000-0000-0ff1-000000000003'),
  now() - interval '10 minutes', 'WO: order_date = captured_at');
select is((select transaction_date from public.work_order_item where id = 'f1000000-0000-0000-0ff1-000000000003'),
  now() - interval '10 minutes', 'WO: a line without a date takes captured_at');
select is((select transaction_date from public.work_order_item where id = 'f1000000-0000-0000-0ff1-000000000004'),
  now() - interval '5 minutes', 'WO: a line''s own date wins');

-- Ledger (drums): 10 counted, 3 moved to B, 2 used, then 1 received into B.
select is(pg_temp.stock('c8000000-0000-0000-0ff1-000000000001'), 5::numeric, 'stock in A: 10 - 3 - 2');
select is(pg_temp.stock('c8000000-0000-0000-0ff1-000000000002'), 4::numeric, 'stock in B: 3 + 1');

select is((select count(*)::integer from public.transfer_main
           where id in ('f0000000-0000-0000-0ff1-000000000009', 'f0000000-0000-0000-0ff1-000000000010')), 0,
  'refused transfers left no header behind');

select is((select load_date from public.load where id = 'f0000000-0000-0000-0ff1-000000000004'),
  ((now() - interval '1 hour') at time zone public.app_time_zone())::date, 'LD: load_date = captured_at''s day');
select is((select driver || ' / ' || vehicle_reg_nr from public.load where id = 'f0000000-0000-0000-0ff1-000000000004'),
  'OF Driver / OF 123', 'LD: driver and vehicle saved');
select is((select load_date from public.load where id = (select (result ->> 'id')::uuid from r where name = 'LD2')),
  '2026-11-01'::date, 'LD2: the header''s own date wins');

select * from finish();
rollback;
