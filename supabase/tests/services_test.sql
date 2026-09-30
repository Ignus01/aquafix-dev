-- Tests for services (spec: AquaFix Services Spec): save_service validation,
-- the next-service rule, the asset trigger and role permissions.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-5e70-000000000001', '00000000-0000-0000-5e70-000000000000', 'authenticated', 'authenticated',
   's-user@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-5e70-000000000002', '00000000-0000-0000-5e70-000000000000', 'authenticated', 'authenticated',
   's-admin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-5e70-000000000003', '00000000-0000-0000-5e70-000000000000', 'authenticated', 'authenticated',
   's-viewer@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-5e70-000000000001', 'user'),
  ('10000000-0000-0000-5e70-000000000002', 'admin'),
  ('10000000-0000-0000-5e70-000000000003', 'viewer');

insert into public.region (id, name) values ('a0000000-0000-0000-5e70-000000000001', 'S-North');
insert into public.organisation (id, name, is_service_supplier) values
  ('a1000000-0000-0000-5e70-000000000001', 'S-ORG', false),
  ('a1000000-0000-0000-5e70-000000000002', 'S-Supplier', true);
insert into public.location (id, name, region_id, organisation_id)
values ('a2000000-0000-0000-5e70-000000000001', 'S-Plant', 'a0000000-0000-0000-5e70-000000000001', 'a1000000-0000-0000-5e70-000000000001');
insert into public.asset_type (id, name) values ('a3000000-0000-0000-5e70-000000000001', 'S-Pump');
-- Pump 1 has a one-year plan; Pump 2 has none.
insert into public.asset (id, name, code, asset_type_id, location_id, has_service_plan, service_interval) values
  ('30000000-0000-0000-5e70-000000000001', 'Pump 1', 'S-P1', 'a3000000-0000-0000-5e70-000000000001', 'a2000000-0000-0000-5e70-000000000001', false, 0),
  ('30000000-0000-0000-5e70-000000000002', 'Pump 2', 'S-P2', 'a3000000-0000-0000-5e70-000000000001', 'a2000000-0000-0000-5e70-000000000001', false, 0);

create temp table r (name text primary key, result jsonb);

-- Everything below runs as the `authenticated` role so RLS and column grants
-- apply (the claims only set who auth.uid() is).
grant all on r to authenticated;
grant usage on schema extensions to authenticated;
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-5e70-000000000001", "role": "authenticated"}', true);
set local role authenticated;

create function pg_temp.svc(p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
as $$
  select public.save_service(jsonb_build_object(
    'asset_id', '30000000-0000-0000-5e70-000000000001',
    'service_type', 'scheduled_maintenance',
    'due_date', '2026-10-01T08:00:00Z'
  ) || p_extra);
$$;

-- Number of service_file rows the caller's RLS lets them delete.
create function pg_temp.delete_files()
returns bigint
language plpgsql
as $$
declare n bigint;
begin
  delete from public.service_file;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ============================================================================
-- Validation
-- ============================================================================
select throws_ok(
  $$ select public.save_service('{"asset_id":"30000000-0000-0000-5e70-000000000001","due_date":"2026-10-01T08:00:00Z"}') $$,
  'P0001', 'Service type is required.', 'service type required');
select throws_ok(
  $$ select public.save_service('{"asset_id":"30000000-0000-0000-5e70-000000000001","service_type":"repair"}') $$,
  'P0001', 'Due date is required.', 'due date required');
select throws_ok(
  $$ select public.save_service('{"service_type":"repair","due_date":"2026-10-01T08:00:00Z"}') $$,
  'P0001', 'Asset is required.', 'asset required');
select throws_ok(
  $$ select pg_temp.svc('{"is_completed": true, "supplier_id": "a1000000-0000-0000-5e70-000000000002"}') $$,
  'P0001', 'Completed date is required.', 'completed needs a date');
select throws_ok(
  $$ select pg_temp.svc('{"is_completed": true, "completed_date": "2026-10-02T08:00:00Z"}') $$,
  'P0001', 'Service supplier is required.', 'completed needs a supplier');
select throws_ok(
  $$ select pg_temp.svc('{"is_completed": true, "completed_date": "2026-10-02T08:00:00Z", "supplier_id": "a1000000-0000-0000-5e70-000000000001"}') $$,
  'P0001', 'That organisation isn''t an active service supplier.', 'supplier must be a service supplier');

-- ============================================================================
-- Open services: one per asset, whatever the type (rule 5)
-- ============================================================================
insert into r values ('open', pg_temp.svc());
select is((select reference from public.service where id = (select (result ->> 'id')::uuid from r where name = 'open')),
  (select (result ->> 'reference')::bigint from r where name = 'open'), 'open service saved');
select is((select performed_by from public.service where id = (select (result ->> 'id')::uuid from r where name = 'open')),
  null, 'performed by is empty until completed');
select throws_ok(
  $$ select pg_temp.svc('{"service_type": "repair"}') $$,
  'P0001', null, 'a second open service on the asset is blocked');
select throws_like(
  $$ select pg_temp.svc('{"service_type": "repair"}') $$,
  'An incomplete service for S-P1 already exists. Service UID = %', 'block message names asset and UID');

-- Editing the open service itself isn't a clash.
select lives_ok(
  $$ select pg_temp.svc(jsonb_build_object('id', (select result ->> 'id' from r where name = 'open'), 'comment', 'hello')) $$,
  'an open service can be edited');

-- ============================================================================
-- Completion: costs, PerformedBy, and no next service without a plan
-- ============================================================================
insert into r values ('done', pg_temp.svc(jsonb_build_object(
  'id', (select result ->> 'id' from r where name = 'open'),
  'is_completed', true, 'completed_date', '2026-10-02T08:00:00Z',
  'supplier_id', 'a1000000-0000-0000-5e70-000000000002',
  'invoice_nr', 'INV-1', 'total_part_cost', 100.5, 'total_labour_cost', 49.5)));
select is((select total_cost from public.service where id = (select (result ->> 'id')::uuid from r where name = 'done')),
  150.00::numeric, 'total cost = parts + labour');
select is((select performed_by from public.service where id = (select (result ->> 'id')::uuid from r where name = 'done')),
  's-user', 'performed by stamped with the user''s name');
select is((select result -> 'next_service' from r where name = 'done'), 'null'::jsonb,
  'no next service for an asset without a plan');

-- ============================================================================
-- Next service (asset with a plan): created after the completed one is written
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-5e70-000000000002", "role": "authenticated"}', true);
update public.asset set has_service_plan = true, service_interval = 0.5
where id = '30000000-0000-0000-5e70-000000000002';
select is((select count(*) from public.service
           where asset_id = '30000000-0000-0000-5e70-000000000002' and not is_completed
             and service_type = 'scheduled_maintenance'), 1::bigint,
  'switching on a service plan opens the first service');
select is((select round(extract(epoch from due_date - now()) / 86400) from public.service
           where asset_id = '30000000-0000-0000-5e70-000000000002'),
  round(0.5 * 365), 'first due date = today + interval (years × 365 days)');
update public.asset set name = 'Pump 2b' where id = '30000000-0000-0000-5e70-000000000002';
select is((select count(*) from public.service where asset_id = '30000000-0000-0000-5e70-000000000002'), 1::bigint,
  'an unrelated asset update does not open another');

insert into r values ('p2', public.save_service(jsonb_build_object(
  'id', (select id::text from public.service where asset_id = '30000000-0000-0000-5e70-000000000002'),
  'asset_id', '30000000-0000-0000-5e70-000000000002',
  'service_type', 'scheduled_maintenance', 'due_date', '2026-10-01T08:00:00Z',
  'is_completed', true, 'completed_date', '2026-10-02T08:00:00Z',
  'supplier_id', 'a1000000-0000-0000-5e70-000000000002')));
select isnt((select result -> 'next_service' from r where name = 'p2'), 'null'::jsonb,
  'completing a scheduled service on a planned asset creates the next one');
select is((select count(*) from public.service where asset_id = '30000000-0000-0000-5e70-000000000002' and not is_completed),
  1::bigint, 'exactly one open service afterwards');
select is((select count(*) from public.service where asset_id = '30000000-0000-0000-5e70-000000000002' and is_completed),
  1::bigint, 'the completed service stays completed');

-- Re-saving the completed service does not open another.
select lives_ok(
  $$ select public.save_service(jsonb_build_object(
       'id', (select id::text from public.service where asset_id = '30000000-0000-0000-5e70-000000000002' and is_completed),
       'asset_id', '30000000-0000-0000-5e70-000000000002',
       'service_type', 'scheduled_maintenance', 'due_date', '2026-10-01T08:00:00Z', 'comment', 'edited',
       'is_completed', true, 'completed_date', '2026-10-02T08:00:00Z',
       'supplier_id', 'a1000000-0000-0000-5e70-000000000002')) $$,
  'editing a completed service works');
select is((select count(*) from public.service where asset_id = '30000000-0000-0000-5e70-000000000002'), 2::bigint,
  'editing a completed service does not create another');

-- ============================================================================
-- Permissions
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-5e70-000000000003", "role": "authenticated"}', true);
select ok((select count(*) from public.service) > 0, 'viewer can read services');
select throws_ok(
  $$ select pg_temp.svc('{"service_type": "repair"}') $$,
  null, null, 'viewer cannot save a service');

select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-5e70-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ update public.service set performed_by = 'someone else' $$,
  '42501', null, 'performed_by is not writable by clients');
select throws_ok(
  $$ update public.service set total_cost = 1 $$,
  null, null, 'total_cost is not writable by clients');

-- User role can attach a file but not delete one.
insert into public.service_file (service_id, name, storage_path, size_bytes)
select id, 'report.pdf', '10000000-0000-0000-5e70-000000000001/' || gen_random_uuid() || '-report.pdf', 100
from public.service where asset_id = '30000000-0000-0000-5e70-000000000001' and is_completed;
select is((select count(*) from public.service_file), 1::bigint, 'user can add a file');
select is(pg_temp.delete_files(), 0::bigint,
  'user cannot delete a file');

select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-5e70-000000000002", "role": "authenticated"}', true);
select is(pg_temp.delete_files(), 1::bigint,
  'admin can delete a file');

select * from finish();
rollback;
