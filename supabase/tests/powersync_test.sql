-- Tests for PowerSync: the sync window flags and sync_user_id copies
-- (20261102120000_powersync_sync_window, windows from
-- 20261104120000_powersync_window_decisions), and that powersync_role and the
-- powersync publication cover the same tables, and only those.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-7e58-000000000001', '00000000-0000-0000-7e58-000000000000', 'authenticated', 'authenticated',
   'ps-inspector@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-7e58-000000000002', '00000000-0000-0000-7e58-000000000000', 'authenticated', 'authenticated',
   'ps-inspector2@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-7e58-000000000001', 'user'),
  ('10000000-0000-0000-7e58-000000000002', 'user');

insert into public.region (id, name) values ('a0000000-0000-0000-7e58-000000000001', 'PS-North');
insert into public.organisation (id, name) values ('a1000000-0000-0000-7e58-000000000001', 'PS-ORG');
insert into public.location (id, name, region_id, organisation_id)
values ('a2000000-0000-0000-7e58-000000000001', 'PS-Plant', 'a0000000-0000-0000-7e58-000000000001', 'a1000000-0000-0000-7e58-000000000001');
insert into public.asset_type (id, name) values ('a3000000-0000-0000-7e58-000000000001', 'PS-Pump');
insert into public.asset (id, name, code, asset_type_id, location_id) values
  ('30000000-0000-0000-7e58-000000000001', 'PS Pump 1', 'PS-P1', 'a3000000-0000-0000-7e58-000000000001', 'a2000000-0000-0000-7e58-000000000001'),
  ('30000000-0000-0000-7e58-000000000002', 'PS Pump 2', 'PS-P2', 'a3000000-0000-0000-7e58-000000000001', 'a2000000-0000-0000-7e58-000000000001');
insert into public.inspection (id, name, value_type, is_required, nr_of_images_required) values
  ('40000000-0000-0000-7e58-000000000001', 'PS Notes', 'TEXT', false, 0);

-- Both open: due today, and 30 days overdue. Open instructions sync whatever
-- their due date.
insert into public.instruction (id, name, required_completed_date, account_id) values
  ('80000000-0000-0000-7e58-000000000001', 'PS today', public.app_today(), '10000000-0000-0000-7e58-000000000001'),
  ('80000000-0000-0000-7e58-000000000002', 'PS old', public.app_today() - 30, '10000000-0000-0000-7e58-000000000001');
insert into public.instruction_asset_allocation (id, instruction_id, asset_id) values
  ('81000000-0000-0000-7e58-000000000001', '80000000-0000-0000-7e58-000000000001', '30000000-0000-0000-7e58-000000000001'),
  ('81000000-0000-0000-7e58-000000000002', '80000000-0000-0000-7e58-000000000001', '30000000-0000-0000-7e58-000000000002'),
  ('81000000-0000-0000-7e58-000000000003', '80000000-0000-0000-7e58-000000000002', '30000000-0000-0000-7e58-000000000001');

-- ============================================================================
-- Instructions and allocations
-- ============================================================================
select is(
  (select in_sync_window from public.instruction where id = '80000000-0000-0000-7e58-000000000001'),
  true, 'An open instruction due today is in the window');
select is(
  (select in_sync_window from public.instruction where id = '80000000-0000-0000-7e58-000000000002'),
  true, 'An open instruction 30 days overdue is in the window');
select is(
  (select count(*)::integer from public.instruction_asset_allocation
   where instruction_id = '80000000-0000-0000-7e58-000000000001'
     and sync_user_id = '10000000-0000-0000-7e58-000000000001'),
  2, 'Allocations of an open instruction sync to its assignee');
select is(
  (select sync_user_id from public.instruction_asset_allocation where id = '81000000-0000-0000-7e58-000000000003'),
  '10000000-0000-0000-7e58-000000000001'::uuid, 'Allocations of an overdue open instruction sync too');

-- Reassigning moves the allocations to the new assignee. (now() is fixed
-- within the test transaction, so give one allocation an old updated_at
-- first, past the triggers that would overwrite it.)
alter table public.instruction_asset_allocation disable trigger user;
update public.instruction_asset_allocation set updated_at = '2000-01-01' where id = '81000000-0000-0000-7e58-000000000001';
alter table public.instruction_asset_allocation enable trigger user;
update public.instruction set account_id = '10000000-0000-0000-7e58-000000000002'
where id = '80000000-0000-0000-7e58-000000000001';
select is(
  (select count(*)::integer from public.instruction_asset_allocation
   where instruction_id = '80000000-0000-0000-7e58-000000000001'
     and sync_user_id = '10000000-0000-0000-7e58-000000000002'),
  2, 'Reassigning an instruction moves its allocations to the new assignee');
select is(
  (select updated_at from public.instruction_asset_allocation where id = '81000000-0000-0000-7e58-000000000001'),
  '2000-01-01'::timestamptz, 'Changing only sync_user_id leaves an allocation''s updated_at alone');

-- Completing every allocation completes the instruction and takes it off the phone.
update public.instruction_asset_allocation set is_completed = true
where instruction_id = '80000000-0000-0000-7e58-000000000001';
select is(
  (select (status, in_sync_window)::text from public.instruction where id = '80000000-0000-0000-7e58-000000000001'),
  '(completed,f)', 'A completed instruction leaves the window');
select is(
  (select count(*)::integer from public.instruction_asset_allocation
   where instruction_id = '80000000-0000-0000-7e58-000000000001' and sync_user_id is not null),
  0, 'Allocations stop syncing when their instruction is completed');

-- ============================================================================
-- Activities, values and photos, through the real save
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-7e58-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select is(
  (public.save_inspection_activity(jsonb_build_object(
    'asset_id', '30000000-0000-0000-7e58-000000000001',
    'values', jsonb_build_array(jsonb_build_object(
      'id', '90000000-0000-0000-7e58-000000000001',
      'inspection_id', '40000000-0000-0000-7e58-000000000001',
      'text_value', 'ok',
      'images', jsonb_build_array(jsonb_build_object(
        'storage_path', '10000000-0000-0000-7e58-000000000001/ps-photo.jpg',
        'mime_type', 'image/jpeg',
        'size_bytes', 10)))))) ->> 'ok'),
  'true', 'An inspector saves an ad-hoc inspection');

reset role;

select is(
  (select in_sync_window from public.inspection_activity a
   join public.inspection_value v on v.inspection_activity_id = a.id
   where v.id = '90000000-0000-0000-7e58-000000000001'),
  true, 'A new activity is in the window');
select is(
  (select sync_user_id from public.inspection_value where id = '90000000-0000-0000-7e58-000000000001'),
  '10000000-0000-0000-7e58-000000000001'::uuid, 'Its values sync to the inspector who captured it');
select is(
  (select sync_user_id from public.inspection_image where inspection_value_id = '90000000-0000-0000-7e58-000000000001'),
  '10000000-0000-0000-7e58-000000000001'::uuid, 'Its photos sync to the inspector who captured it');

-- The next day (moved by hand): out of the window, values and photos too.
alter table public.inspection_value disable trigger user;
update public.inspection_value set updated_at = '2000-01-01' where id = '90000000-0000-0000-7e58-000000000001';
alter table public.inspection_value enable trigger user;
update public.inspection_activity a set inspection_date = now() - interval '1 day'
from public.inspection_value v
where v.inspection_activity_id = a.id and v.id = '90000000-0000-0000-7e58-000000000001';
select is(
  (select sync_user_id from public.inspection_value where id = '90000000-0000-0000-7e58-000000000001'),
  null, 'Values stop syncing when their activity leaves the window');
select is(
  (select sync_user_id from public.inspection_image where inspection_value_id = '90000000-0000-0000-7e58-000000000001'),
  null, 'Photos stop syncing when their activity leaves the window');
select is(
  (select updated_at from public.inspection_value where id = '90000000-0000-0000-7e58-000000000001'),
  '2000-01-01'::timestamptz, 'Changing only sync_user_id leaves a value''s updated_at alone');

-- ============================================================================
-- The hourly refresh
-- ============================================================================
-- A flag left stale: an open instruction marked outside the window.
alter table public.instruction disable trigger instruction_sync_window;
update public.instruction set in_sync_window = false where id = '80000000-0000-0000-7e58-000000000002';
alter table public.instruction enable trigger instruction_sync_window;
select is(
  (select sync_user_id from public.instruction_asset_allocation where id = '81000000-0000-0000-7e58-000000000003'),
  null, 'Setup: the stale flag unsynced the allocation');

select lives_ok($$select public.refresh_powersync_sync_window()$$, 'The refresh runs');
select is(
  (select in_sync_window from public.instruction where id = '80000000-0000-0000-7e58-000000000002'),
  true, 'The refresh moves the window');
select is(
  (select sync_user_id from public.instruction_asset_allocation where id = '81000000-0000-0000-7e58-000000000003'),
  '10000000-0000-0000-7e58-000000000001'::uuid, 'The refresh carries the change down to the allocations');
select is(
  (select count(*)::integer from public.instruction
   where in_sync_window is distinct from public.powersync_instruction_in_window(status)),
  0, 'No instruction is left with a stale flag');
select is(
  (select count(*)::integer from public.inspection_activity
   where in_sync_window is distinct from public.powersync_activity_in_window(inspection_date)),
  0, 'No activity is left with a stale flag');

-- ============================================================================
-- powersync_role and the publication
-- ============================================================================
select is(
  (select (rolreplication, rolbypassrls, rolsuper)::text from pg_roles where rolname = 'powersync_role'),
  '(t,t,f)', 'powersync_role can replicate and bypass RLS, and is not a superuser');
select set_eq(
  $$select tablename::text from pg_publication_tables where pubname = 'powersync'$$,
  $$select table_name::text from information_schema.role_table_grants
    where grantee = 'powersync_role' and privilege_type = 'SELECT'$$,
  'powersync_role can read exactly the published tables');
select is(
  (select count(*)::integer from information_schema.role_table_grants
   where grantee = 'powersync_role' and privilege_type <> 'SELECT'),
  0, 'powersync_role can only SELECT');
select is(
  (select puballtables from pg_publication where pubname = 'powersync'),
  false, 'The publication lists its tables (not FOR ALL TABLES)');
select ok(
  not has_table_privilege('powersync_role', 'public.system_settings', 'SELECT')
  and not has_table_privilege('powersync_role', 'public.incident', 'SELECT')
  and not has_table_privilege('powersync_role', 'public.profiles', 'SELECT'),
  'powersync_role can''t read tables outside the sync config');

select * from finish();
rollback;
