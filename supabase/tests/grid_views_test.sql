-- Grid views (docs/grid-redesign-plan.md): each `<thing>_grid` view is
-- security_invoker, so every caller sees exactly the rows the base table's
-- RLS gives them, and names resolve only for callers with a role.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-9d1d-000000000001', '00000000-0000-0000-9d1d-000000000000', 'authenticated', 'authenticated',
   'g-field@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-9d1d-000000000002', '00000000-0000-0000-9d1d-000000000000', 'authenticated', 'authenticated',
   'g-admin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-9d1d-000000000003', '00000000-0000-0000-9d1d-000000000000', 'authenticated', 'authenticated',
   'g-viewer@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-9d1d-000000000004', '00000000-0000-0000-9d1d-000000000000', 'authenticated', 'authenticated',
   'g-nobody@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-9d1d-000000000001', 'user'),
  ('10000000-0000-0000-9d1d-000000000002', 'admin'),
  ('10000000-0000-0000-9d1d-000000000003', 'viewer');

-- One instruction for the field user, one for the admin; the second was
-- last changed by the admin, the first by "the system" (updated_by null).
insert into public.instruction (id, name, required_completed_date, account_id, updated_by) values
  ('20000000-0000-0000-9d1d-000000000001', 'G-Field round', current_date, '10000000-0000-0000-9d1d-000000000001', null),
  ('20000000-0000-0000-9d1d-000000000002', 'G-Admin round', current_date, '10000000-0000-0000-9d1d-000000000002',
   '10000000-0000-0000-9d1d-000000000002');

create function pg_temp.act_as(p_user text) returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- ============================================================================
-- instruction_grid
-- ============================================================================
set local role authenticated;

select pg_temp.act_as('10000000-0000-0000-9d1d-000000000003');
select set_eq(
  $$select id from public.instruction_grid where name like 'G-%'$$,
  $$select id from public.instruction where name like 'G-%'$$,
  'a viewer sees the same instructions through the view as through the table');
select is((select count(*)::integer from public.instruction_grid where name like 'G-%'), 2, 'viewers see every instruction');
select is(
  (select changed_by_name from public.instruction_grid where id = '20000000-0000-0000-9d1d-000000000001'),
  'System', 'a system write shows as System');
select is(
  (select changed_by_name from public.instruction_grid where id = '20000000-0000-0000-9d1d-000000000002'),
  'g-admin', 'a user write shows the user''s name');
select is(
  (select account_name from public.instruction_grid where id = '20000000-0000-0000-9d1d-000000000001'),
  'g-field', 'and the assignee''s name');

select pg_temp.act_as('10000000-0000-0000-9d1d-000000000001');
select set_eq(
  $$select id from public.instruction_grid where name like 'G-%'$$,
  $$select id from public.instruction where name like 'G-%'$$,
  'a field user sees the same instructions through the view as through the table');

select pg_temp.act_as('10000000-0000-0000-9d1d-000000000004');
select is((select count(*)::integer from public.instruction_grid), 0, 'a caller without a role sees nothing');
select is(public.grid_user_name('10000000-0000-0000-9d1d-000000000002'), null, 'and no names');

-- ============================================================================
-- The other Inspections grids: same rows as their tables, for a viewer and
-- for a caller without a role (nothing).
-- ============================================================================
reset role;
insert into public.colour_container (id, name, hex_colour) values ('c0000000-0000-0000-9d1d-000000000001', 'G-Any', '#000');
insert into public.grading (id, name, priority, colour_container_id)
values ('a4000000-0000-0000-9d1d-000000000001', 'G-Good', 1, 'c0000000-0000-0000-9d1d-000000000001');
insert into public.region (id, name) values ('a0000000-0000-0000-9d1d-000000000001', 'G-North');
insert into public.organisation (id, name) values ('a1000000-0000-0000-9d1d-000000000001', 'G-ORG');
insert into public.location (id, name, region_id, organisation_id)
values ('a2000000-0000-0000-9d1d-000000000001', 'G-Plant', 'a0000000-0000-0000-9d1d-000000000001', 'a1000000-0000-0000-9d1d-000000000001');
insert into public.asset_type (id, name) values ('a3000000-0000-0000-9d1d-000000000001', 'G-Pump');
insert into public.asset (id, name, code, asset_type_id, location_id)
values ('30000000-0000-0000-9d1d-000000000001', 'G-Pump 1', 'G-P1', 'a3000000-0000-0000-9d1d-000000000001', 'a2000000-0000-0000-9d1d-000000000001');
insert into public.inspection (id, name, value_type, is_required, nr_of_images_required)
values ('40000000-0000-0000-9d1d-000000000001', 'G-Meter', 'CUMULATIVE_VALUE', true, 0);
insert into public.inspection_activity (id, asset_id, instruction_id, grading_id, created_by)
values ('50000000-0000-0000-9d1d-000000000001', '30000000-0000-0000-9d1d-000000000001',
        '20000000-0000-0000-9d1d-000000000001', 'a4000000-0000-0000-9d1d-000000000001', '10000000-0000-0000-9d1d-000000000001');
insert into public.inspection_value (id, inspection_activity_id, inspection_id, decimal_value, display_value)
values ('60000000-0000-0000-9d1d-000000000001', '50000000-0000-0000-9d1d-000000000001', '40000000-0000-0000-9d1d-000000000001', 7, '7');
insert into public.inspection_cumulative_value (id, inspection_id, asset_id, latest_value)
values ('70000000-0000-0000-9d1d-000000000001', '40000000-0000-0000-9d1d-000000000001', '30000000-0000-0000-9d1d-000000000001', 7);
insert into public.scheduled_instruction (id, name, schedule_type, account_id)
values ('80000000-0000-0000-9d1d-000000000001', 'G-Daily', 'daily', '10000000-0000-0000-9d1d-000000000001');

set local role authenticated;
select pg_temp.act_as('10000000-0000-0000-9d1d-000000000003');
select set_eq('select id from public.inspection_activity_grid', 'select id from public.inspection_activity',
  'activities: the view shows the table''s rows');
select set_eq('select id from public.inspection_value_grid', 'select id from public.inspection_value',
  'values: the view shows the table''s rows');
select set_eq('select id from public.inspection_cumulative_value_grid', 'select id from public.inspection_cumulative_value',
  'cumulative values: the view shows the table''s rows');
select set_eq('select id from public.scheduled_instruction_grid', 'select id from public.scheduled_instruction',
  'scheduled instructions: the view shows the table''s rows');
select results_eq(
  $$select asset_name, location_name, instruction_name, grading_name, inspected_by_name
    from public.inspection_activity_grid where id = '50000000-0000-0000-9d1d-000000000001'$$,
  $$values ('G-Pump 1', 'G-Plant', 'G-Field round', 'G-Good', 'g-field')$$,
  'an activity row carries its names');
select results_eq(
  $$select activity_uid is not null, inspection_name, image_count from public.inspection_value_grid
    where id = '60000000-0000-0000-9d1d-000000000001'$$,
  $$values (true, 'G-Meter', 0)$$,
  'a value row carries its activity, inspection and image count');
select is((select asset_count from public.scheduled_instruction_grid where id = '80000000-0000-0000-9d1d-000000000001'),
  0, 'a schedule row counts its assets');

select pg_temp.act_as('10000000-0000-0000-9d1d-000000000004');
select is((select count(*)::integer from public.inspection_activity_grid), 0, 'no role: no activities');
select is((select count(*)::integer from public.inspection_value_grid), 0, 'no role: no values');
select is((select count(*)::integer from public.inspection_cumulative_value_grid), 0, 'no role: no cumulative values');
select is((select count(*)::integer from public.scheduled_instruction_grid), 0, 'no role: no schedules');

-- ============================================================================
-- incident_grid (phase 3.1)
-- ============================================================================
reset role;
-- Writes below are "the system's" unless they name a user.
select set_config('request.jwt.claims', '', true);
insert into public.incident_type (id, name, disables_location)
values ('a5000000-0000-0000-9d1d-000000000001', 'G-Pump down', true);
insert into public.incident (id, comment, location_id, incident_type_id, created_by)
values ('90000000-0000-0000-9d1d-000000000001', 'G-No flow', 'a2000000-0000-0000-9d1d-000000000001',
        'a5000000-0000-0000-9d1d-000000000001', '10000000-0000-0000-9d1d-000000000001');
insert into public.incident_note (incident_id, body) values ('90000000-0000-0000-9d1d-000000000001', 'G-On it');

set local role authenticated;
select pg_temp.act_as('10000000-0000-0000-9d1d-000000000003');
select set_eq('select id from public.incident_grid', 'select id from public.incident',
  'incidents: the view shows the table''s rows');
select results_eq(
  $$select incident_type_name, disables_location, location_name, image_count, note_count, created_by_name, changed_by_name
    from public.incident_grid where id = '90000000-0000-0000-9d1d-000000000001'$$,
  $$values ('G-Pump down', true, 'G-Plant', 0, 1, 'g-field', 'System')$$,
  'an incident row carries its names and counts');

select pg_temp.act_as('10000000-0000-0000-9d1d-000000000004');
select is((select count(*)::integer from public.incident_grid), 0, 'no role: no incidents');

-- ============================================================================
-- service_grid (phase 3.2)
-- ============================================================================
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.service (id, service_type, due_date, asset_id, total_part_cost, total_labour_cost)
values ('91000000-0000-0000-9d1d-000000000001', 'repair', now(), '30000000-0000-0000-9d1d-000000000001', 10, 5);

set local role authenticated;
select pg_temp.act_as('10000000-0000-0000-9d1d-000000000003');
select set_eq('select id from public.service_grid', 'select id from public.service',
  'services: the view shows the table''s rows');
select results_eq(
  $$select asset_code, asset_name, is_completed, total_cost, changed_by_name
    from public.service_grid where id = '91000000-0000-0000-9d1d-000000000001'$$,
  $$values ('G-P1', 'G-Pump 1', false, 15.00::numeric, 'System')$$,
  'a service row carries its asset, costs and editor');

select pg_temp.act_as('10000000-0000-0000-9d1d-000000000004');
select is((select count(*)::integer from public.service_grid), 0, 'no role: no services');

-- ============================================================================
-- logger_reading_grid and logger_pull_run_grid (phase 3.3): system admins
-- only, like the tables.
-- ============================================================================
reset role;
select set_config('request.jwt.claims', '', true);
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('10000000-0000-0000-9d1d-000000000005', '00000000-0000-0000-9d1d-000000000000', 'authenticated', 'authenticated',
        'g-sysadmin@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values ('10000000-0000-0000-9d1d-000000000005', 'system_admin');
insert into public.logger_pull_run (id, trigger, range_start, range_end, requested_by)
overriding system value
values (-9001, 'manual', now() - interval '1 day', now(), '10000000-0000-0000-9d1d-000000000005');
insert into public.logger_reading (asset_id, logger_type, logger_code, reading_at, value, unit, run_id)
values ('30000000-0000-0000-9d1d-000000000001', 'HYDRUS', 'G-LOG1', now(), 12.5, 'm3', -9001);

set local role authenticated;
select pg_temp.act_as('10000000-0000-0000-9d1d-000000000005');
select set_eq('select id from public.logger_reading_grid', 'select id from public.logger_reading',
  'readings: the view shows the table''s rows');
select results_eq(
  $$select asset_name, asset_code, location_name, value from public.logger_reading_grid where logger_code = 'G-LOG1'$$,
  $$values ('G-Pump 1', 'G-P1', 'G-Plant', 12.5::numeric)$$,
  'a reading row carries its asset and location');
select set_eq('select id from public.logger_pull_run_grid', 'select id from public.logger_pull_run',
  'runs: the view shows the table''s rows');
select results_eq(
  $$select status, changed_by_name, changed_at = created_at from public.logger_pull_run_grid where id = -9001$$,
  $$values ('no_loggers', 'g-sysadmin', true)$$,
  'a run row carries its status and who asked for it');

select pg_temp.act_as('10000000-0000-0000-9d1d-000000000003');
select is((select count(*)::integer from public.logger_reading_grid), 0, 'a viewer sees no readings');
select is((select count(*)::integer from public.logger_pull_run_grid), 0, 'or runs');

reset role;

select * from finish();
rollback;
