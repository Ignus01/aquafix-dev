-- Tests for PowerSync: the sync window flags and sync_user_id copies
-- (20261102120000_powersync_sync_window, windows from
-- 20261104120000_powersync_window_decisions; incidents and stock from
-- 20261104150000_powersync_incidents_stock_services),
-- who may sync at all, and that powersync_role and the
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
-- Incidents, notes and photos
-- ============================================================================
-- Superuser writes from here on, with no signed-in user (like the hourly
-- job): created_by is what the insert sets.
select set_config('request.jwt.claims', '', true);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-7e58-000000000003', '00000000-0000-0000-7e58-000000000000', 'authenticated', 'authenticated',
   'ps-viewer@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-7e58-000000000004', '00000000-0000-0000-7e58-000000000000', 'authenticated', 'authenticated',
   'ps-norole@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-7e58-000000000003', 'viewer');

insert into public.incident_type (id, name) values ('a5000000-0000-0000-7e58-000000000001', 'PS-Leak');

-- I1 open; I2 completed at the first moment of the 7-day window (today and
-- the 6 days before, app time zone); I3 a second before it.
insert into public.incident (id, comment, location_id, incident_type_id, created_by, status, completed_at) values
  ('b0000000-0000-0000-7e58-000000000001', 'PS open', 'a2000000-0000-0000-7e58-000000000001',
   'a5000000-0000-0000-7e58-000000000001', '10000000-0000-0000-7e58-000000000001', 'new', null),
  ('b0000000-0000-0000-7e58-000000000002', 'PS done 6 days ago', 'a2000000-0000-0000-7e58-000000000001',
   'a5000000-0000-0000-7e58-000000000001', '10000000-0000-0000-7e58-000000000001', 'completed',
   (public.app_today() - 6)::timestamp at time zone public.app_time_zone()),
  ('b0000000-0000-0000-7e58-000000000003', 'PS done 7 days ago', 'a2000000-0000-0000-7e58-000000000001',
   'a5000000-0000-0000-7e58-000000000001', '10000000-0000-0000-7e58-000000000001', 'completed',
   ((public.app_today() - 6)::timestamp at time zone public.app_time_zone()) - interval '1 second');
insert into public.incident_note (id, incident_id, body, created_by) values
  ('b1000000-0000-0000-7e58-000000000001', 'b0000000-0000-0000-7e58-000000000001', 'PS note',
   '10000000-0000-0000-7e58-000000000002');
-- A photo on the incident and one on the note.
insert into public.incident_image (id, incident_id, incident_note_id, storage_path, mime_type, size_bytes) values
  ('b2000000-0000-0000-7e58-000000000001', 'b0000000-0000-0000-7e58-000000000001', null, 'ps-7e58/i1.jpg', 'image/jpeg', 10),
  ('b2000000-0000-0000-7e58-000000000002', null, 'b1000000-0000-0000-7e58-000000000001', 'ps-7e58/n1.jpg', 'image/jpeg', 10);

select is(
  (select (incident_open, sync_user_id)::text from public.incident where id = 'b0000000-0000-0000-7e58-000000000001'),
  '(t,10000000-0000-0000-7e58-000000000001)', 'An open incident is open and syncs to its creator');
select is(
  (select (incident_open, sync_user_id)::text from public.incident_note where id = 'b1000000-0000-0000-7e58-000000000001'),
  '(t,10000000-0000-0000-7e58-000000000001)', 'Its notes copy incident_open and sync_user_id (not the note''s author)');
select is(
  (select (incident_open, sync_user_id)::text from public.incident_image where id = 'b2000000-0000-0000-7e58-000000000001'),
  '(t,10000000-0000-0000-7e58-000000000001)', 'Its photos copy them');
select is(
  (select (incident_open, sync_user_id)::text from public.incident_image where id = 'b2000000-0000-0000-7e58-000000000002'),
  '(t,10000000-0000-0000-7e58-000000000001)', 'A photo on a note copies them through the note');
select is(
  (select (incident_open, sync_user_id)::text from public.incident where id = 'b0000000-0000-0000-7e58-000000000002'),
  '(f,10000000-0000-0000-7e58-000000000001)', 'An incident completed 6 days ago (app time zone) still syncs to its creator');
select is(
  (select (incident_open, sync_user_id)::text from public.incident where id = 'b0000000-0000-0000-7e58-000000000003'),
  '(f,)', 'An incident completed 7 days ago syncs to nobody');

-- Completing an incident: off the open list, still the creator's.
update public.incident set status = 'completed', completed_at = now()
where id = 'b0000000-0000-0000-7e58-000000000001';
select is(
  (select (incident_open, sync_user_id)::text from public.incident where id = 'b0000000-0000-0000-7e58-000000000001'),
  '(f,10000000-0000-0000-7e58-000000000001)', 'An incident completed today is closed and still syncs to its creator');
select is(
  (select count(*)::integer from (
     select incident_open, sync_user_id from public.incident_note where id = 'b1000000-0000-0000-7e58-000000000001'
     union all
     select incident_open, sync_user_id from public.incident_image
     where id in ('b2000000-0000-0000-7e58-000000000001', 'b2000000-0000-0000-7e58-000000000002')) x
   where not incident_open and sync_user_id = '10000000-0000-0000-7e58-000000000001'),
  3, 'Completing an incident carries incident_open down to its notes and photos');

-- A week later (moved by hand, past the triggers): the flag is stale until
-- the refresh. updated_at is set old to see that the refresh leaves it.
alter table public.incident disable trigger user;
update public.incident
set completed_at = now() - interval '8 days', updated_at = '2000-01-01'
where id = 'b0000000-0000-0000-7e58-000000000001';
alter table public.incident enable trigger user;
create temporary table ps_counts as
select
  (select count(*) from public.incident_status_change where incident_id = 'b0000000-0000-0000-7e58-000000000001') as history,
  (select count(*) from public.email_log where incident_id = 'b0000000-0000-0000-7e58-000000000001')
  + (select count(*) from public.email_outbox where incident_id = 'b0000000-0000-0000-7e58-000000000001') as emails,
  (select updated_by from public.incident where id = 'b0000000-0000-0000-7e58-000000000001') as updated_by;

select lives_ok($$select public.refresh_powersync_sync_window()$$, 'The refresh runs over incidents');
select is(
  (select sync_user_id from public.incident where id = 'b0000000-0000-0000-7e58-000000000001'),
  null, 'The refresh takes an incident completed 8 days ago off its creator''s phone');
select is(
  (select count(*)::integer from (
     select sync_user_id from public.incident_note where id = 'b1000000-0000-0000-7e58-000000000001'
     union all
     select sync_user_id from public.incident_image
     where id in ('b2000000-0000-0000-7e58-000000000001', 'b2000000-0000-0000-7e58-000000000002')) x
   where sync_user_id is null),
  3, 'and its notes and photos, through the note too');
select is(
  (select (updated_at, updated_by)::text from public.incident where id = 'b0000000-0000-0000-7e58-000000000001'),
  (select ('2000-01-01'::timestamptz, updated_by)::text from ps_counts),
  'The refresh leaves the incident''s updated_at and updated_by alone');
select is(
  (select count(*) from public.incident_status_change where incident_id = 'b0000000-0000-0000-7e58-000000000001'),
  (select history from ps_counts), 'The refresh writes no status history');
select is(
  (select count(*) from public.email_log where incident_id = 'b0000000-0000-0000-7e58-000000000001')
  + (select count(*) from public.email_outbox where incident_id = 'b0000000-0000-0000-7e58-000000000001'),
  (select emails from ps_counts), 'The refresh sends no notifications');
select is(
  (select count(*)::integer from public.incident
   where incident_open is distinct from (status <> 'completed')
      or sync_user_id is distinct from public.powersync_incident_sync_user(status, completed_at, created_by)),
  0, 'No incident is left with a stale flag');

-- ============================================================================
-- Stock documents and lines
-- ============================================================================
insert into public.unit_of_measure (id, code, name, uom_type) values
  ('c0000000-0000-0000-7e58-000000000001', 'PS7E58-L', 'PS Litre', 'VOLUME');
insert into public.product_type (id, code, name) values ('c1000000-0000-0000-7e58-000000000001', 'PS7E58', 'PS Chem');
insert into public.product (id, code, name, product_type_id, uom_id) values
  ('c2000000-0000-0000-7e58-000000000001', 'PS7E58-CL', 'PS Chlorine', 'c1000000-0000-0000-7e58-000000000001',
   'c0000000-0000-0000-7e58-000000000001');
insert into public.pack_type (id, name, qty, uom_id) values
  ('c3000000-0000-0000-7e58-000000000001', 'PS 5 Litre Drum', 5, 'c0000000-0000-0000-7e58-000000000001');
insert into public.item (id, name, product_id, pack_type_id) values
  ('c7000000-0000-0000-7e58-000000000001', 'PS drum', 'c2000000-0000-0000-7e58-000000000001',
   'c3000000-0000-0000-7e58-000000000001');
insert into public.storage_area (id, code, name, location_id) values
  ('c8000000-0000-0000-7e58-000000000001', 'PS7E58A', 'PS Area A', 'a2000000-0000-0000-7e58-000000000001');

-- T1 today, T2 10 days ago; a work order and a stock take today; loads
-- dated at the edge of the window and just outside it.
insert into public.transfer_main (id, transfer_type, to_storage_area_id, transfer_date, created_by) values
  ('d0000000-0000-0000-7e58-000000000001', 'RECEIVE', 'c8000000-0000-0000-7e58-000000000001', now(),
   '10000000-0000-0000-7e58-000000000001'),
  ('d0000000-0000-0000-7e58-000000000002', 'RECEIVE', 'c8000000-0000-0000-7e58-000000000001', now() - interval '10 days',
   '10000000-0000-0000-7e58-000000000001');
insert into public.transfer_item (id, transfer_id, item_id, qty) values
  ('d1000000-0000-0000-7e58-000000000001', 'd0000000-0000-0000-7e58-000000000001', 'c7000000-0000-0000-7e58-000000000001', 3),
  ('d1000000-0000-0000-7e58-000000000002', 'd0000000-0000-0000-7e58-000000000002', 'c7000000-0000-0000-7e58-000000000001', 1);
insert into public.work_order (id, storage_area_id, created_by) values
  ('d2000000-0000-0000-7e58-000000000001', 'c8000000-0000-0000-7e58-000000000001', '10000000-0000-0000-7e58-000000000001');
insert into public.work_order_item (id, work_order_id, item_id, qty, is_return, transaction_date) values
  ('d3000000-0000-0000-7e58-000000000001', 'd2000000-0000-0000-7e58-000000000001', 'c7000000-0000-0000-7e58-000000000001',
   2, true, now() - interval '1 hour');
insert into public.stock_take (id, storage_area_id, created_by) values
  ('d4000000-0000-0000-7e58-000000000001', 'c8000000-0000-0000-7e58-000000000001', '10000000-0000-0000-7e58-000000000001');
insert into public.stock_take_item (id, stock_take_id, item_id, counted_qty) values
  ('d5000000-0000-0000-7e58-000000000001', 'd4000000-0000-0000-7e58-000000000001', 'c7000000-0000-0000-7e58-000000000001', 20);
insert into public.load (id, load_date, created_by) values
  ('d6000000-0000-0000-7e58-000000000001', public.app_today() - 6, '10000000-0000-0000-7e58-000000000001'),
  ('d6000000-0000-0000-7e58-000000000002', public.app_today() - 7, '10000000-0000-0000-7e58-000000000001');

select is(
  (select array_agg(coalesce(sync_user_id::text, 'null') order by n) from (
     select 1 as n, sync_user_id from public.transfer_main where id = 'd0000000-0000-0000-7e58-000000000001'
     union all select 2, sync_user_id from public.transfer_item where id = 'd1000000-0000-0000-7e58-000000000001'
     union all select 3, sync_user_id from public.work_order where id = 'd2000000-0000-0000-7e58-000000000001'
     union all select 4, sync_user_id from public.work_order_item where id = 'd3000000-0000-0000-7e58-000000000001'
     union all select 5, sync_user_id from public.stock_take where id = 'd4000000-0000-0000-7e58-000000000001'
     union all select 6, sync_user_id from public.stock_take_item where id = 'd5000000-0000-0000-7e58-000000000001'
     union all select 7, sync_user_id from public.load where id = 'd6000000-0000-0000-7e58-000000000001') x),
  array_fill('10000000-0000-0000-7e58-000000000001'::text, array[7]),
  'Stock documents dated in the last 7 days, and their lines, sync to their creator');
select is(
  (select (h.sync_user_id, l.sync_user_id)::text
   from public.transfer_main h join public.transfer_item l on l.transfer_id = h.id
   where h.id = 'd0000000-0000-0000-7e58-000000000002'),
  '(,)', 'A transfer dated 10 days ago and its lines sync to nobody');
select is(
  (select sync_user_id from public.load where id = 'd6000000-0000-0000-7e58-000000000002'),
  null, 'A load dated 7 days ago syncs to nobody');

-- Sync-only updates of lines post nothing to the ledger and don't recount.
-- Set up so that they would show: remove T1's ledger row, and add a return
-- before the stock take so a recount would change its adjustment.
delete from public.item_transaction where transfer_item_id = 'd1000000-0000-0000-7e58-000000000001';
insert into public.work_order (id, storage_area_id) values
  ('d2000000-0000-0000-7e58-000000000002', 'c8000000-0000-0000-7e58-000000000001');
insert into public.work_order_item (id, work_order_id, item_id, qty, is_return, transaction_date) values
  ('d3000000-0000-0000-7e58-000000000002', 'd2000000-0000-0000-7e58-000000000002', 'c7000000-0000-0000-7e58-000000000001',
   5, true, now() - interval '2 hours');
create temporary table ps_stock as
select (select adjustment_qty from public.stock_take_item where id = 'd5000000-0000-0000-7e58-000000000001') as adjustment;

-- Stale headers (moved past their own trigger): the lines follow.
alter table public.transfer_main disable trigger transfer_main_sync_user;
alter table public.stock_take disable trigger stock_take_sync_user;
update public.transfer_main set sync_user_id = null where id = 'd0000000-0000-0000-7e58-000000000001';
update public.stock_take set sync_user_id = null where id = 'd4000000-0000-0000-7e58-000000000001';
alter table public.transfer_main enable trigger transfer_main_sync_user;
alter table public.stock_take enable trigger stock_take_sync_user;
alter table public.transfer_main disable trigger user;
alter table public.stock_take disable trigger user;
update public.transfer_main set updated_at = '2000-01-01' where id = 'd0000000-0000-0000-7e58-000000000001';
update public.stock_take set updated_at = '2000-01-01' where id = 'd4000000-0000-0000-7e58-000000000001';
alter table public.transfer_main enable trigger user;
alter table public.stock_take enable trigger user;
select is(
  (select (t.sync_user_id, s.sync_user_id)::text
   from public.transfer_item t, public.stock_take_item s
   where t.id = 'd1000000-0000-0000-7e58-000000000001' and s.id = 'd5000000-0000-0000-7e58-000000000001'),
  '(,)', 'Setup: the stale headers unsynced their lines');

select lives_ok($$select public.refresh_powersync_sync_window()$$, 'The refresh runs over stock documents');
select is(
  (select (t.sync_user_id, s.sync_user_id)::text
   from public.transfer_item t, public.stock_take_item s
   where t.id = 'd1000000-0000-0000-7e58-000000000001' and s.id = 'd5000000-0000-0000-7e58-000000000001'),
  '(10000000-0000-0000-7e58-000000000001,10000000-0000-0000-7e58-000000000001)',
  'The refresh moves the headers and carries the change down to the lines');
select is(
  (select (t.updated_at, s.updated_at)::text
   from public.transfer_main t, public.stock_take s
   where t.id = 'd0000000-0000-0000-7e58-000000000001' and s.id = 'd4000000-0000-0000-7e58-000000000001'),
  ('2000-01-01'::timestamptz, '2000-01-01'::timestamptz)::text, 'The refresh leaves the headers'' updated_at alone');
select is(
  (select count(*)::integer from public.item_transaction where transfer_item_id = 'd1000000-0000-0000-7e58-000000000001'),
  0, 'Sync-only updates of transfer lines post nothing to the ledger');
select is(
  (select adjustment_qty from public.stock_take_item where id = 'd5000000-0000-0000-7e58-000000000001'),
  (select adjustment from ps_stock), 'Sync-only updates of stock take lines don''t recount them');
select is(
  (select count(*)::integer from (
     select sync_user_id, case when public.powersync_in_recent_window(transfer_date) then created_by end as want from public.transfer_main
     union all select sync_user_id, case when public.powersync_in_recent_window(order_date) then created_by end from public.work_order
     union all select sync_user_id, case when public.powersync_in_recent_window(take_date) then created_by end from public.stock_take
     union all select sync_user_id, case when public.powersync_in_recent_window(load_date) then created_by end from public.load) x
   where sync_user_id is distinct from want),
  0, 'No stock document is left with a stale sync_user_id');

-- Real updates still post and recount.
update public.stock_take_item set counted_qty = counted_qty where id = 'd5000000-0000-0000-7e58-000000000001';
select is(
  (select adjustment_qty from public.stock_take_item where id = 'd5000000-0000-0000-7e58-000000000001'),
  (select 20 - sum(t.qty) from public.item_transaction t
   where t.item_id = 'c7000000-0000-0000-7e58-000000000001'
     and t.storage_area_id = 'c8000000-0000-0000-7e58-000000000001'
     and t.stock_take_item_id is null
     and t.transaction_date <= now()),
  'An update that changes nothing still recounts a stock take line');
select isnt(
  (select adjustment_qty from public.stock_take_item where id = 'd5000000-0000-0000-7e58-000000000001'),
  (select adjustment from ps_stock), 'Setup check: that recount gave a new adjustment');
update public.transfer_main set transfer_date = now() - interval '8 days' where id = 'd0000000-0000-0000-7e58-000000000001';
select is(
  (select (h.sync_user_id, l.sync_user_id)::text
   from public.transfer_main h join public.transfer_item l on l.transfer_id = h.id
   where h.id = 'd0000000-0000-0000-7e58-000000000001'),
  '(,)', 'Re-dating a transfer 8 days back takes it and its lines off the phone');
select is(
  (select count(*)::integer from public.item_transaction where transfer_item_id = 'd1000000-0000-0000-7e58-000000000001'),
  1, 'and re-posts its lines, as before');

-- ============================================================================
-- Who may sync at all (capture_users in every stream)
-- ============================================================================
-- A viewer's own incident carries their id, but the role check keeps it off
-- their phone: every stream requires a role other than viewer.
insert into public.incident (id, comment, location_id, incident_type_id, created_by) values
  ('b0000000-0000-0000-7e58-000000000004', 'PS viewer''s', 'a2000000-0000-0000-7e58-000000000001',
   'a5000000-0000-0000-7e58-000000000001', '10000000-0000-0000-7e58-000000000003');
select is(
  (select sync_user_id from public.incident where id = 'b0000000-0000-0000-7e58-000000000004'),
  '10000000-0000-0000-7e58-000000000003'::uuid, 'Setup: the viewer''s incident carries their id');
select is(
  (select array_agg(u.id order by u.id) from (values
     ('10000000-0000-0000-7e58-000000000001'::uuid), ('10000000-0000-0000-7e58-000000000003'::uuid),
     ('10000000-0000-0000-7e58-000000000004'::uuid)) as u (id)
   where u.id in (select user_id from public.user_masterdata_roles where role <> 'viewer')),
  array['10000000-0000-0000-7e58-000000000001'::uuid],
  'capture_users holds a user, not a viewer or a user with no role, so those two receive nothing');

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
select set_eq(
  $$select tablename::text from pg_publication_tables where pubname = 'powersync'$$,
  array[
    'instruction', 'instruction_asset_allocation',
    'inspection_activity', 'inspection_value', 'inspection_image',
    'asset', 'asset_type', 'location', 'grading', 'colour_container', 'inspection',
    'inspection_drop_down_option', 'inspection_rule', 'feedback', 'inspection_allocation',
    'quality_parameter', 'inspection_cumulative_value', 'user_masterdata_roles',
    'incident', 'incident_note', 'incident_image', 'incident_type', 'profiles',
    'service', 'organisation', 'storage_area', 'item',
    'transfer_main', 'transfer_item', 'work_order', 'work_order_item',
    'stock_take', 'stock_take_item', 'load'
  ],
  'The publication holds exactly the tables sync-config.yaml reads');
select ok(
  not has_table_privilege('powersync_role', 'public.system_settings', 'SELECT'),
  'powersync_role can''t read tables outside the sync config');
select ok(
  has_table_privilege('powersync_role', 'public.incident', 'SELECT')
  and has_table_privilege('powersync_role', 'public.profiles', 'SELECT'),
  'powersync_role can read incidents and names');

select * from finish();
rollback;
