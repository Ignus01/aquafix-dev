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

reset role;

select * from finish();
rollback;
