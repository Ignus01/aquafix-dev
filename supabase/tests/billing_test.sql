-- Tests for billing (20261109140000_billing.sql): which meters go on an
-- invoice (by asset type classification), the period and readings, the
-- opening reading from the previous approved invoice, approval skipping
-- blocked invoices, void then regenerate, and access.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-1096-000000000001', '00000000-0000-0000-1096-000000000000', 'authenticated', 'authenticated',
   'bil-sysadmin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-1096-000000000003', '00000000-0000-0000-1096-000000000000', 'authenticated', 'authenticated',
   'bil-user@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-1096-000000000001', 'system_admin'),
  ('10000000-0000-0000-1096-000000000003', 'user');

create function pg_temp.as_user(p_n integer) returns void
language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub": "10000000-0000-0000-1096-00000000000%s", "role": "authenticated"}', p_n), true);
$$;

insert into public.region (id, name) values ('a0000000-0000-0000-1096-000000000001', 'BIL-Region');
insert into public.organisation (id, name) values ('a1000000-0000-0000-1096-000000000001', 'BIL-ORG');
-- A: billed on the 25th with a tariff. B: billed on the last day, no tariff.
-- C: not billed.
insert into public.location (id, name, region_id, organisation_id, billing_day) values
  ('a2000000-0000-0000-1096-00000000000a', 'BIL-A', 'a0000000-0000-0000-1096-000000000001', 'a1000000-0000-0000-1096-000000000001', 25),
  ('a2000000-0000-0000-1096-00000000000b', 'BIL-B', 'a0000000-0000-0000-1096-000000000001', 'a1000000-0000-0000-1096-000000000001', 31),
  ('a2000000-0000-0000-1096-00000000000c', 'BIL-C', 'a0000000-0000-0000-1096-000000000001', 'a1000000-0000-0000-1096-000000000001', null);
insert into public.location_tariff (location_id, rate, effective_from) values
  ('a2000000-0000-0000-1096-00000000000a', 8, '2025-01-01'),
  ('a2000000-0000-0000-1096-00000000000a', 10, '2026-02-01');

insert into public.asset_type (id, name, classification) values
  ('a3000000-0000-0000-1096-000000000001', 'BIL-Treated', 'TREATED_METER'),
  ('a3000000-0000-0000-1096-000000000002', 'BIL-Borehole', 'BOREHOLE_METER'),
  ('a3000000-0000-0000-1096-000000000003', 'BIL-Municipal', 'MUNICIPAL_METER'),
  ('a3000000-0000-0000-1096-000000000004', 'BIL-Electrical', 'ELECTRICAL_METER'),
  ('a3000000-0000-0000-1096-000000000005', 'BIL-Pump', 'OTHER');

insert into public.asset (id, name, code, asset_type_id, location_id, active) values
  ('30000000-0000-0000-1096-0000000000a1', 'A Treated', 'BIL-AT', 'a3000000-0000-0000-1096-000000000001', 'a2000000-0000-0000-1096-00000000000a', true),
  ('30000000-0000-0000-1096-0000000000a2', 'A Borehole', 'BIL-AB', 'a3000000-0000-0000-1096-000000000002', 'a2000000-0000-0000-1096-00000000000a', true),
  ('30000000-0000-0000-1096-0000000000a3', 'A Municipal', 'BIL-AM', 'a3000000-0000-0000-1096-000000000003', 'a2000000-0000-0000-1096-00000000000a', true),
  ('30000000-0000-0000-1096-0000000000a4', 'A Electrical', 'BIL-AE', 'a3000000-0000-0000-1096-000000000004', 'a2000000-0000-0000-1096-00000000000a', true),
  ('30000000-0000-0000-1096-0000000000a5', 'A Old Treated', 'BIL-AO', 'a3000000-0000-0000-1096-000000000001', 'a2000000-0000-0000-1096-00000000000a', false),
  ('30000000-0000-0000-1096-0000000000a6', 'A Pump', 'BIL-AP', 'a3000000-0000-0000-1096-000000000005', 'a2000000-0000-0000-1096-00000000000a', true),
  ('30000000-0000-0000-1096-0000000000b1', 'B Treated', 'BIL-BT', 'a3000000-0000-0000-1096-000000000001', 'a2000000-0000-0000-1096-00000000000b', true),
  ('30000000-0000-0000-1096-0000000000c1', 'C Treated', 'BIL-CT', 'a3000000-0000-0000-1096-000000000001', 'a2000000-0000-0000-1096-00000000000c', true);

insert into public.inspection (id, name, value_type) values
  ('a4000000-0000-0000-1096-000000000001', 'BIL Meter Reading', 'CUMULATIVE_VALUE');

-- A meter reading at 09:00 local time on a day.
create function pg_temp.reading(p_asset uuid, p_day date, p_value numeric) returns uuid
language plpgsql as $$
declare
  v_activity uuid;
  v_value uuid;
begin
  insert into public.inspection_activity (asset_id, inspection_date)
  values (p_asset, (p_day + time '09:00') at time zone public.app_time_zone())
  returning id into v_activity;
  insert into public.inspection_value (inspection_activity_id, inspection_id, decimal_value)
  values (v_activity, 'a4000000-0000-0000-1096-000000000001', p_value)
  returning id into v_value;
  return v_value;
end;
$$;

select pg_temp.reading('30000000-0000-0000-1096-0000000000a1', '2026-01-25', 1000);
select pg_temp.reading('30000000-0000-0000-1096-0000000000a1', '2026-02-25', 1300);
-- Two days after the March billing day: the closest, flagged.
select pg_temp.reading('30000000-0000-0000-1096-0000000000a1', '2026-03-27', 1700);
select pg_temp.reading('30000000-0000-0000-1096-0000000000a2', '2026-01-25', 500);
-- A day before the billing day: inside the window.
select pg_temp.reading('30000000-0000-0000-1096-0000000000a2', '2026-02-24', 650);
select pg_temp.reading('30000000-0000-0000-1096-0000000000a3', '2026-01-25', 70);
select pg_temp.reading('30000000-0000-0000-1096-0000000000a3', '2026-02-25', 90);
select pg_temp.reading('30000000-0000-0000-1096-0000000000a4', '2026-01-25', 10);
select pg_temp.reading('30000000-0000-0000-1096-0000000000a4', '2026-02-25', 40);
select pg_temp.reading('30000000-0000-0000-1096-0000000000b1', '2026-01-31', 100);
select pg_temp.reading('30000000-0000-0000-1096-0000000000b1', '2026-02-28', 200);

create temp table result (k text primary key, d jsonb);
grant all on result to authenticated;

create temp view inv as
select i.* from public.invoice i
where i.location_id in ('a2000000-0000-0000-1096-00000000000a', 'a2000000-0000-0000-1096-00000000000b');
create temp view lines as
select il.*, i.location_name, i.period_start, i.status
from public.invoice_line il join public.invoice i on i.id = il.invoice_id
where i.location_id = 'a2000000-0000-0000-1096-00000000000a';
grant select on inv, lines to authenticated;

-- ============================================================================
-- Generate February
-- ============================================================================
select pg_temp.as_user(1);
set local role authenticated;
insert into result select 'feb', public.billing_generate('2026-02-15', array[
  'a2000000-0000-0000-1096-00000000000a', 'a2000000-0000-0000-1096-00000000000b',
  'a2000000-0000-0000-1096-00000000000c']::uuid[]);
reset role;

select is((select (d ->> 'created')::int from result where k = 'feb'), 2,
  'two drafts: the billed locations; C has no billing day');
select is(
  (select array_agg(location_name || ' ' || period_start || '..' || period_end order by location_name) from inv),
  array['BIL-A 2026-01-25..2026-02-25', 'BIL-B 2026-01-31..2026-02-28'],
  'the period runs billing day to billing day; day 31 is the month''s last day');

select is(
  (select array_agg(asset_name || '=' || meter order by sort_order) from lines),
  array['A Treated=treated', 'A Borehole=borehole', 'A Municipal=municipal', 'A Electrical=electrical'],
  'treated, borehole, municipal and electrical meters by classification; inactive and non-meter assets left off');
select is(
  (select array[prev_value, curr_value, usage] from lines where asset_name = 'A Municipal'),
  array[70, 90, 20]::numeric[], 'the municipal meter is read like the others');

select is(
  (select array[prev_value, curr_value, usage] from lines where asset_name = 'A Treated'),
  array[1000, 1300, 300]::numeric[], 'A treated: readings on both billing days');
select is(
  (select array[prev_source, curr_source] from lines where asset_name = 'A Treated'),
  array['window', 'window'], 'both inside the ±1 day window');
select is(
  (select array[curr_value::text, curr_source] from lines where asset_name = 'A Borehole'),
  array['650', 'window'], 'a reading a day early is inside the window');
select is(
  (select array[tariff_rate, treated_usage, amount] from inv where location_name = 'BIL-A'),
  array[10, 300, 3000]::numeric[], 'amount = treated usage × the tariff in effect on the billing day; municipal usage is not invoiced');
select is(
  (select public.billing_blocking_issues(issues) from inv where location_name = 'BIL-A'),
  '{}'::text[], 'A has no blocking issue (missing photos are warnings)');
select ok(
  (select 'no_tariff' = any (issues) and amount is null from inv where location_name = 'BIL-B'),
  'B has no tariff, so no amount');

-- ============================================================================
-- Review: a typed closing reading
-- ============================================================================
select pg_temp.as_user(1);
set local role authenticated;
select throws_ok(
  $$ select public.billing_set_reading((select id from lines where asset_name = 'A Treated'), 'curr', null, 1310, null) $$,
  'P0001', 'Give a reason for a typed reading.', 'a typed reading needs a reason');
select lives_ok(
  $$ select public.billing_set_reading((select id from lines where asset_name = 'A Treated'), 'curr', null, 1310,
                                       'Photo shows 1310') $$,
  'a typed reading with a reason is kept');
reset role;
select is(
  (select array[treated_usage, amount] from inv where location_name = 'BIL-A'),
  array[310, 3100]::numeric[], 'the invoice is recalculated');

-- ============================================================================
-- Approve: blocked invoices are skipped
-- ============================================================================
select pg_temp.as_user(1);
set local role authenticated;
insert into result select 'approve', public.billing_approve(array(select id from inv));
reset role;

select is((select (d ->> 'approved')::int from result where k = 'approve'), 1, 'one invoice approved');
select is(
  (select jsonb_agg(s ->> 'location') from result, jsonb_array_elements(d -> 'skipped') s where k = 'approve'),
  '["BIL-B"]'::jsonb, 'B is skipped');
select ok(
  (select (d -> 'skipped' -> 0 ->> 'reason') like '%no_tariff%' from result where k = 'approve'),
  'with its blocking issue as the reason');
select ok(
  (select status = 'approved' and invoice_no ~ '^INV-[0-9]{6}$' and approved_by = '10000000-0000-0000-1096-000000000001'
   from inv where location_name = 'BIL-A'),
  'A is approved, numbered and stamped');
select is((select status::text from inv where location_name = 'BIL-B'), 'draft', 'B stays a draft');

select pg_temp.as_user(1);
set local role authenticated;
select throws_ok(
  $$ select public.billing_set_reading((select id from lines where asset_name = 'A Treated'), 'curr', null, 1, 'x') $$,
  'P0001', 'Only draft invoices can be changed.', 'an approved invoice can''t be changed');
insert into result select 'feb2', public.billing_generate('2026-02-01', array[
  'a2000000-0000-0000-1096-00000000000a', 'a2000000-0000-0000-1096-00000000000b']::uuid[]);
reset role;
select is(
  (select array[(d ->> 'created')::int, (d ->> 'skipped_approved')::int] from result where k = 'feb2'),
  array[1, 1], 'generating again rebuilds B''s draft and leaves approved A alone');
select is((select count(*)::int from inv where location_name = 'BIL-A'), 1, 'A still has one February invoice');

-- ============================================================================
-- March: the opening reading is February's closing reading
-- ============================================================================
select pg_temp.as_user(1);
set local role authenticated;
select public.billing_generate('2026-03-01', array['a2000000-0000-0000-1096-00000000000a']::uuid[]);
reset role;

select is(
  (select array[prev_value::text, prev_source, curr_value::text, curr_source]
   from lines where asset_name = 'A Treated' and period_start = '2026-02-25'),
  array['1310', 'previous_invoice', '1700', 'closest'],
  'opening = the approved invoice''s typed closing reading, not the meter''s 1300; closing is the closest reading');
select ok(
  (select 'curr_outside_window' = any (issues) from lines where asset_name = 'A Treated' and period_start = '2026-02-25'),
  'a closing reading two days off is flagged');
select is(
  (select array[treated_usage, amount] from inv where location_name = 'BIL-A' and period_start = '2026-02-25'),
  array[390, 3900]::numeric[], 'March usage runs on from February: no water billed twice or missed');

-- ============================================================================
-- Void, then regenerate
-- ============================================================================
select pg_temp.as_user(1);
set local role authenticated;
select throws_ok(
  $$ select public.billing_void((select id from inv where location_name = 'BIL-A' and period_start = '2026-01-25'), ' ') $$,
  'P0001', 'Give a reason for voiding the invoice.', 'voiding needs a reason');
select throws_ok(
  $$ select public.billing_void((select id from inv where location_name = 'BIL-B'), 'Wrong') $$,
  'P0001', 'Only approved invoices can be voided.', 'a draft can''t be voided');
select lives_ok(
  $$ select public.billing_void((select id from inv where location_name = 'BIL-A' and period_start = '2026-01-25'),
                                'Typed reading was wrong') $$,
  'an approved invoice is voided with a reason');
insert into result select 'feb3', public.billing_generate('2026-02-01', array['a2000000-0000-0000-1096-00000000000a']::uuid[]);
select public.billing_generate('2026-03-01', array['a2000000-0000-0000-1096-00000000000a']::uuid[]);
reset role;

select is((select (d ->> 'created')::int from result where k = 'feb3'), 1, 'February is generated again for A');
select is(
  (select array_agg(status::text order by status) from inv where location_name = 'BIL-A' and period_start = '2026-01-25'),
  array['draft', 'void'], 'the voided invoice stays beside the new draft');
select is(
  (select array[curr_value::text, curr_source] from lines
   where asset_name = 'A Treated' and period_start = '2026-01-25' and status = 'draft'),
  array['1300', 'window'], 'the new draft reads the meter again');
select is(
  (select array[prev_value::text, prev_source] from lines where asset_name = 'A Treated' and period_start = '2026-02-25'),
  array['1300', 'window'], 'March no longer opens from the voided invoice');

-- ============================================================================
-- Classification drives the meters
-- ============================================================================
update public.asset_type set classification = 'TREATED_METER' where id = 'a3000000-0000-0000-1096-000000000003';
select pg_temp.as_user(1);
set local role authenticated;
select public.billing_generate('2026-02-01', array['a2000000-0000-0000-1096-00000000000a']::uuid[]);
reset role;
select is(
  (select treated_usage from inv where location_name = 'BIL-A' and period_start = '2026-01-25' and status = 'draft'),
  320::numeric, 'reclassifying the municipal type as treated makes its meter count in the amount (300 + 20)');

-- ============================================================================
-- Access
-- ============================================================================
select pg_temp.as_user(3);
set local role authenticated;
select throws_ok(
  $$ select public.billing_generate('2026-02-01') $$,
  '42501', 'Only system admins and admins can manage billing.', 'a user can''t generate invoices');
select is((select count(*)::int from public.invoice), 0, 'nor read them');
reset role;

select * from finish();
rollback;
