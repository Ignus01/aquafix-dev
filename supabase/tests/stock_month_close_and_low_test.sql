-- Tests for 20261120130000_stock_month_close.sql (month-end lock) and
-- 20261120140000_stock_low_levels.sql (minimum levels, daily email).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
  ('40000000-0000-0000-c105-000000000001', '00000000-0000-0000-c105-000000000000', 'authenticated', 'authenticated', 'c-admin@example.test', '', now(), now(), now()),
  ('40000000-0000-0000-c105-000000000002', '00000000-0000-0000-c105-000000000000', 'authenticated', 'authenticated', 'c-user@example.test', '', now(), now(), now()),
  ('40000000-0000-0000-c105-000000000003', '00000000-0000-0000-c105-000000000000', 'authenticated', 'authenticated', 'C-Sysadmin@Example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('40000000-0000-0000-c105-000000000001', 'admin'),
  ('40000000-0000-0000-c105-000000000002', 'user'),
  ('40000000-0000-0000-c105-000000000003', 'system_admin');

insert into public.unit_of_measure (id, code, name, uom_type) values ('c0000000-0000-0000-c105-000000000001', 'CBAG', 'C Bag', 'NODIM');
insert into public.product_type (id, code, name) values ('c1000000-0000-0000-c105-000000000001', 'CSALT', 'C Salt');
insert into public.product (id, code, name, product_type_id, uom_id) values
  ('c2000000-0000-0000-c105-000000000001', 'CSALT25', 'CSALT25', 'c1000000-0000-0000-c105-000000000001', 'c0000000-0000-0000-c105-000000000001');
insert into public.pack_type (id, name, qty, uom_id) values
  ('c3000000-0000-0000-c105-000000000001', 'C pack', 1, 'c0000000-0000-0000-c105-000000000001');
insert into public.item (id, name, product_id, pack_type_id) values
  ('c7000000-0000-0000-c105-000000000001', 'C Salt 25', 'c2000000-0000-0000-c105-000000000001', 'c3000000-0000-0000-c105-000000000001');
insert into public.region (id, name) values ('c4000000-0000-0000-c105-000000000001', 'C-Region');
insert into public.organisation (id, name, is_supplier) values ('c5000000-0000-0000-c105-000000000001', 'C-ORG', false);
insert into public.location (id, name, region_id, organisation_id) values
  ('c6000000-0000-0000-c105-000000000001', 'C-Base', 'c4000000-0000-0000-c105-000000000001', 'c5000000-0000-0000-c105-000000000001');
insert into public.storage_area (id, code, name, location_id) values
  ('c8000000-0000-0000-c105-000000000001', 'C-WPS', 'C WPS store', 'c6000000-0000-0000-c105-000000000001');

-- Stock in at the start of last month (counted), and usage on its 10th.
create function pg_temp.last_month(p_day int) returns timestamptz language sql as $$
  select ((date_trunc('month', (now() at time zone public.app_time_zone())) - interval '1 month' + make_interval(days => p_day - 1) + interval '12 hours')
          at time zone public.app_time_zone());
$$;
grant execute on function pg_temp.last_month(int) to authenticated;

insert into public.stock_take (id, storage_area_id, take_date) values
  ('e0000000-0000-0000-c105-000000000001', 'c8000000-0000-0000-c105-000000000001', pg_temp.last_month(1));
insert into public.stock_take_item (id, stock_take_id, item_id, counted_qty, unit_cost_exc_vat) values
  ('e1000000-0000-0000-c105-000000000001', 'e0000000-0000-0000-c105-000000000001', 'c7000000-0000-0000-c105-000000000001', 30, 200);
insert into public.work_order (id, storage_area_id, location_id, order_date) values
  ('e2000000-0000-0000-c105-000000000001', 'c8000000-0000-0000-c105-000000000001', 'c6000000-0000-0000-c105-000000000001', pg_temp.last_month(10));
insert into public.work_order_item (id, work_order_id, item_id, qty, transaction_date) values
  ('e3000000-0000-0000-c105-000000000001', 'e2000000-0000-0000-c105-000000000001', 'c7000000-0000-0000-c105-000000000001', 5, pg_temp.last_month(10));

-- ============================================================================
-- Month-end lock
-- ============================================================================
select set_config('request.jwt.claims', '{"sub": "40000000-0000-0000-c105-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.close_stock_month((now() - interval '1 month')::date) $$, '42501', null, 'a user can''t close a month');
reset role;

select set_config('request.jwt.claims', '{"sub": "40000000-0000-0000-c105-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.close_stock_month(now()::date) $$, 'P0001', null, 'the current month can''t be closed');
select lives_ok($$ select public.close_stock_month((pg_temp.last_month(1) at time zone public.app_time_zone())::date) $$, 'admin closes last month');
select is(public.stock_closed_through(),
          ((date_trunc('month', (now() at time zone public.app_time_zone())) - interval '1 day'))::date, 'closed through the end of last month');
select throws_ok($$ select public.close_stock_month((pg_temp.last_month(1) at time zone public.app_time_zone())::date) $$, 'P0001', null, 'closing it again is refused');
reset role;

-- Nothing dated last month can change now.
select throws_like($$ update public.work_order_item set qty = 6 where id = 'e3000000-0000-0000-c105-000000000001' $$,
  'Stock up to the end of % is closed%', 'usage in a closed month can''t be edited');
select throws_like($$ delete from public.work_order where id = 'e2000000-0000-0000-c105-000000000001' $$,
  'Stock up to the end of % is closed%', 'usage in a closed month can''t be deleted');
insert into public.work_order (id, storage_area_id, location_id, order_date) values
  ('e2000000-0000-0000-c105-000000000003', 'c8000000-0000-0000-c105-000000000001', 'c6000000-0000-0000-c105-000000000001', pg_temp.last_month(20));
select throws_like($$ insert into public.work_order_item (work_order_id, item_id, qty, transaction_date) values
  ('e2000000-0000-0000-c105-000000000003', 'c7000000-0000-0000-c105-000000000001', 1, pg_temp.last_month(20)) $$,
  'Stock up to the end of % is closed%', 'new usage dated in a closed month is refused');
select throws_like($$ update public.stock_take_item set unit_cost_exc_vat = 210 where id = 'e1000000-0000-0000-c105-000000000001' $$,
  'Stock up to the end of % is closed%', 'the price behind closed figures can''t change');
select lives_ok($$ update public.work_order set comment = 'note' where id = 'e2000000-0000-0000-c105-000000000001' $$,
  'a comment on a closed document can still be added');
-- Moving usage out of the closed month into this one is a change to the closed month too.
select throws_like($$ update public.work_order_item set transaction_date = now() where id = 'e3000000-0000-0000-c105-000000000001' $$,
  'Stock up to the end of % is closed%', 'usage can''t be moved out of a closed month');

-- This month stays open.
insert into public.work_order (id, storage_area_id, location_id) values
  ('e2000000-0000-0000-c105-000000000002', 'c8000000-0000-0000-c105-000000000001', 'c6000000-0000-0000-c105-000000000001');
select lives_ok($$ insert into public.work_order_item (id, work_order_id, item_id, qty, transaction_date) values
  ('e3000000-0000-0000-c105-000000000002', 'e2000000-0000-0000-c105-000000000002', 'c7000000-0000-0000-c105-000000000001', 7, now()) $$,
  'usage this month is fine');

-- Reopen, fix, close again.
select set_config('request.jwt.claims', '{"sub": "40000000-0000-0000-c105-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.reopen_stock_month() $$, 'admin reopens last month');
reset role;
select lives_ok($$ update public.work_order_item set qty = 6 where id = 'e3000000-0000-0000-c105-000000000001' $$, 'reopened: the usage can be fixed');
select is((select count(*)::int from public.stock_period_log), 2, 'close and reopen are logged');

-- ============================================================================
-- Minimum levels
-- ============================================================================
-- On hand: 30 - 6 - 7 = 17.
insert into public.stock_min_level (item_id, storage_area_id, min_qty, reorder_qty) values
  ('c7000000-0000-0000-c105-000000000001', 'c8000000-0000-0000-c105-000000000001', 20, 40);
select is((select qty from public.stock_low_level), 17::numeric, 'on hand shown against the minimum');
select ok((select is_low from public.stock_low_level), '17 below a minimum of 20 is low');
update public.stock_min_level set min_qty = 17;
select ok(not (select is_low from public.stock_low_level), 'exactly at the minimum is not low');
update public.stock_min_level set min_qty = 20;
select throws_ok($$ insert into public.stock_min_level (item_id, storage_area_id, min_qty) values
  ('c7000000-0000-0000-c105-000000000001', 'c8000000-0000-0000-c105-000000000001', 5) $$, '23505', null, 'one minimum per item and storage area');
select throws_ok($$ update public.stock_min_level set min_qty = -1 $$, '23514', null, 'a negative minimum is refused');

-- Users set minimums; only admins delete them.
select set_config('request.jwt.claims', '{"sub": "40000000-0000-0000-c105-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok($$ update public.stock_min_level set reorder_qty = 50 $$, 'a user can change a minimum');
delete from public.stock_min_level;
select is((select count(*)::int from public.stock_min_level), 1, 'a user can''t delete a minimum');
select throws_ok($$ insert into public.stock_alert_recipient (user_id) values ('40000000-0000-0000-c105-000000000002') $$,
  '42501', null, 'only a system admin edits the alert list');
reset role;

-- ============================================================================
-- Daily email
-- ============================================================================
select is(public.queue_low_stock_alerts(), 0, 'nobody on the list: nothing queued');

select set_config('request.jwt.claims', '{"sub": "40000000-0000-0000-c105-000000000003", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok($$ insert into public.stock_alert_recipient (user_id) values ('40000000-0000-0000-c105-000000000003'),
  ('40000000-0000-0000-c105-000000000001') $$, 'system admin adds two people');
reset role;

update public.system_settings set email_enabled = false where id = 1;
select is(public.queue_low_stock_alerts(), 0, 'email switched off: nothing queued');
select is((select status || '/' || error_reason from public.email_log where tag = 'low-stock' order by id desc limit 1),
          'skipped/email disabled', 'and the skip is logged');

update public.system_settings set email_enabled = true, brevo_secret_id = gen_random_uuid(), sender_email = 'stock@example.test' where id = 1;
select is(public.queue_low_stock_alerts(), 2, 'one email per person');
select is(public.queue_low_stock_alerts(), 0, 'running again the same day queues nothing more');
select is((select recipient_email from public.email_outbox where template = 'low-stock' order by recipient_email limit 1),
          'c-admin@example.test', 'addresses lower-cased');
select is((select payload -> 'lines' -> 0 ->> 'item' from public.email_outbox where template = 'low-stock' limit 1), 'C SALT 25', 'the low item is listed');
select is((select payload -> 'lines' -> 0 ->> 'qty' from public.email_outbox where template = 'low-stock' limit 1), '17', 'with what is on hand');
select is((select payload -> 'lines' -> 0 ->> 'min_qty' from public.email_outbox where template = 'low-stock' limit 1), '20', 'and its minimum');

-- Topped up: nothing low, nothing sent.
delete from public.email_outbox where template = 'low-stock';
update public.stock_min_level set min_qty = 1;
select is(public.queue_low_stock_alerts(), 0, 'nothing low: no email');

select throws_ok($$ insert into public.email_outbox (recipient_email) values ('x@example.test') $$, '23514', null,
  'an incident email still needs its incident');
select ok(exists (select 1 from cron.job where jobname = 'stock-low-daily'), 'the daily check is scheduled');

select * from finish();
rollback;
