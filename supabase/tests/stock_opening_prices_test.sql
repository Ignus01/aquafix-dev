-- Tests for 20261120120000_stock_opening_prices.sql: a counted line's price,
-- batch and expiry become the batch of the stock found (opening stock); and
-- 20261120150000_stock_reports.sql (cost per site, missing stock).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('40000000-0000-0000-0f15-000000000001', '00000000-0000-0000-0f15-000000000000', 'authenticated', 'authenticated',
        'o-office@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values ('40000000-0000-0000-0f15-000000000001', 'user');

insert into public.unit_of_measure (id, code, name, uom_type) values ('c0000000-0000-0000-0f15-000000000001', 'OTAB', 'O Tablet', 'NODIM');
insert into public.product_type (id, code, name) values ('c1000000-0000-0000-0f15-000000000001', 'OREAG', 'O Reagent');
insert into public.product (id, code, name, product_type_id, uom_id) values
  ('c2000000-0000-0000-0f15-000000000001', 'ODPD1', 'ODPD1', 'c1000000-0000-0000-0f15-000000000001', 'c0000000-0000-0000-0f15-000000000001');
insert into public.pack_type (id, name, qty, uom_id) values
  ('c3000000-0000-0000-0f15-000000000001', 'O pack', 1, 'c0000000-0000-0000-0f15-000000000001');
insert into public.item (id, name, product_id, pack_type_id) values
  ('c7000000-0000-0000-0f15-000000000001', 'O DPD1', 'c2000000-0000-0000-0f15-000000000001', 'c3000000-0000-0000-0f15-000000000001');
insert into public.region (id, name) values ('c4000000-0000-0000-0f15-000000000001', 'O-Region');
insert into public.organisation (id, name, is_supplier) values
  ('c5000000-0000-0000-0f15-000000000001', 'O-ORG', false),
  ('c5000000-0000-0000-0f15-000000000002', 'O-SUPPLIER', true);
insert into public.location (id, name, region_id, organisation_id) values
  ('c6000000-0000-0000-0f15-000000000001', 'O-Base', 'c4000000-0000-0000-0f15-000000000001', 'c5000000-0000-0000-0f15-000000000001');
insert into public.storage_area (id, code, name, location_id, technician_user_id) values
  ('c8000000-0000-0000-0f15-000000000001', 'O-KIT', 'O kit', 'c6000000-0000-0000-0f15-000000000001', '40000000-0000-0000-0f15-000000000001');
insert into public.storage_area (id, code, name, location_id) values
  ('c8000000-0000-0000-0f15-000000000002', 'O-STORE', 'O store', 'c6000000-0000-0000-0f15-000000000001');

create function pg_temp.lot_of(p_line text) returns public.stock_lot language sql as $$
  select l.* from public.stock_lot l join public.item_transaction t on t.id = l.item_transaction_id
   where t.stock_take_item_id = p_line::uuid;
$$;

-- Opening stock: an empty kit counted at 10, priced at R50 with a batch and expiry.
insert into public.stock_take (id, storage_area_id, take_date) values
  ('e0000000-0000-0000-0f15-000000000001', 'c8000000-0000-0000-0f15-000000000001', now() - interval '2 days');
insert into public.stock_take_item (id, stock_take_id, item_id, counted_qty, unit_cost_exc_vat, batch_number, expiry_date) values
  ('e1000000-0000-0000-0f15-000000000001', 'e0000000-0000-0000-0f15-000000000001', 'c7000000-0000-0000-0f15-000000000001',
   10, 50, 'OB-1', current_date + 90);

select is((pg_temp.lot_of('e1000000-0000-0000-0f15-000000000001')).unit_cost_exc_vat, 50.0000::numeric(15,4), 'counted price becomes the batch price');
select is((pg_temp.lot_of('e1000000-0000-0000-0f15-000000000001')).batch_number, 'OB-1', 'counted batch number kept');
select is((pg_temp.lot_of('e1000000-0000-0000-0f15-000000000001')).source, 'ADJUSTMENT', 'opening stock is an adjustment batch');
select is((select next_expiry from public.storage_area_stock
            where item_id = 'c7000000-0000-0000-0f15-000000000001' and storage_area_id = 'c8000000-0000-0000-0f15-000000000001'),
          current_date + 90, 'kit shows the counted expiry as next expiry');

-- Stock used afterwards is costed at the counted price.
insert into public.work_order (id, storage_area_id, location_id) values
  ('e2000000-0000-0000-0f15-000000000001', 'c8000000-0000-0000-0f15-000000000001', 'c6000000-0000-0000-0f15-000000000001');
insert into public.work_order_item (id, work_order_id, item_id, qty, transaction_date) values
  ('e3000000-0000-0000-0f15-000000000001', 'e2000000-0000-0000-0f15-000000000001', 'c7000000-0000-0000-0f15-000000000001', 4, now() - interval '1 day');
select is((select sum(-a.qty * l.unit_cost_exc_vat) from public.stock_allocation a join public.stock_lot l on l.id = a.lot_id
            join public.item_transaction t on t.id = a.item_transaction_id
           where t.work_order_item_id = 'e3000000-0000-0000-0f15-000000000001'),
          200.0000::numeric, 'usage of 4 valued at 4 × R50');

-- Correcting the price later re-prices the batch, and the usage follows it.
update public.stock_take_item set unit_cost_exc_vat = 60 where id = 'e1000000-0000-0000-0f15-000000000001';
select is((pg_temp.lot_of('e1000000-0000-0000-0f15-000000000001')).unit_cost_exc_vat, 60.0000::numeric(15,4), 'changed price updates the batch');
select is((select sum(-a.qty * l.unit_cost_exc_vat) from public.stock_allocation a join public.stock_lot l on l.id = a.lot_id
            join public.item_transaction t on t.id = a.item_transaction_id
           where t.work_order_item_id = 'e3000000-0000-0000-0f15-000000000001'),
          240.0000::numeric, 'usage now valued at 4 × R60');
select is((select count(*)::int from public.stock_allocation a join public.item_transaction t on t.id = a.item_transaction_id
           where t.work_order_item_id = 'e3000000-0000-0000-0f15-000000000001' and a.lot_id is null),
          0, 'usage still traced to the batch after the price change');

-- No price given: the latest purchase price received before the count.
insert into public.purchase_order (id, supplier_id) values ('d0000000-0000-0000-0f15-000000000001', 'c5000000-0000-0000-0f15-000000000002');
insert into public.purchase_order_item (id, purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, eta) values
  ('d1000000-0000-0000-0f15-000000000001', 'd0000000-0000-0000-0f15-000000000001', 'c7000000-0000-0000-0f15-000000000001', 2, 100, current_date);
select set_config('request.jwt.claims', '{"sub": "40000000-0000-0000-0f15-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.receive_purchase_order(jsonb_build_object(
  'purchase_order_id', 'd0000000-0000-0000-0f15-000000000001', 'storage_area_id', 'c8000000-0000-0000-0f15-000000000002',
  'captured_at', now() - interval '1 day',
  'lines', jsonb_build_array(jsonb_build_object('purchase_order_item_id', 'd1000000-0000-0000-0f15-000000000001', 'qty', 2)))) $$,
  'store receives 2 at R100');
reset role;
insert into public.stock_take (id, storage_area_id, take_date) values
  ('e0000000-0000-0000-0f15-000000000002', 'c8000000-0000-0000-0f15-000000000002', now());
insert into public.stock_take_item (id, stock_take_id, item_id, counted_qty) values
  ('e1000000-0000-0000-0f15-000000000002', 'e0000000-0000-0000-0f15-000000000002', 'c7000000-0000-0000-0f15-000000000001', 5);
select is((pg_temp.lot_of('e1000000-0000-0000-0f15-000000000002')).unit_cost_exc_vat, 100.0000::numeric(15,4), 'no price: latest purchase price');

-- Stock received with no price (another facility, no PO) takes the latest real price.
insert into public.load (id) values ('e4000000-0000-0000-0f15-000000000001');
insert into public.intake (id, intake_type, load_id, storage_area_id) values
  ('e5000000-0000-0000-0f15-000000000001', 'FACILITY_TRANSFER', 'e4000000-0000-0000-0f15-000000000001', 'c8000000-0000-0000-0f15-000000000002');
insert into public.intake_item (id, intake_id, item_id, qty) values
  ('e6000000-0000-0000-0f15-000000000001', 'e5000000-0000-0000-0f15-000000000001', 'c7000000-0000-0000-0f15-000000000001', 1);
select is((select unit_cost_exc_vat from public.stock_lot where intake_item_id = 'e6000000-0000-0000-0f15-000000000001'),
          100.0000::numeric(15,4), 'a receipt with no price takes the latest purchase price');

-- A shortfall is a loss, not a new batch, whatever price is typed.
insert into public.stock_take (id, storage_area_id, take_date) values
  ('e0000000-0000-0000-0f15-000000000003', 'c8000000-0000-0000-0f15-000000000001', now());
insert into public.stock_take_item (id, stock_take_id, item_id, counted_qty, unit_cost_exc_vat) values
  ('e1000000-0000-0000-0f15-000000000003', 'e0000000-0000-0000-0f15-000000000003', 'c7000000-0000-0000-0f15-000000000001', 4, 999);
select is((select adjustment_qty from public.stock_take_item where id = 'e1000000-0000-0000-0f15-000000000003'), -2::numeric, 'kit short by 2');
select ok((pg_temp.lot_of('e1000000-0000-0000-0f15-000000000003')).id is null, 'a shortfall makes no batch');
select is((select sum(-a.qty * l.unit_cost_exc_vat) from public.stock_allocation a join public.stock_lot l on l.id = a.lot_id
            join public.item_transaction t on t.id = a.item_transaction_id
           where t.stock_take_item_id = 'e1000000-0000-0000-0f15-000000000003'),
          120.0000::numeric, 'shortfall valued at the batch it came from (2 × R60)');

-- Negative prices are refused.
select throws_ok($$ update public.stock_take_item set unit_cost_exc_vat = -1 where id = 'e1000000-0000-0000-0f15-000000000001' $$,
  '23514', null, 'a negative price is refused');

-- Office staff can enter the price (column grants).
select ok(has_column_privilege('authenticated', 'public.stock_take_item', 'unit_cost_exc_vat', 'UPDATE'), 'price can be edited');
select ok(has_column_privilege('authenticated', 'public.stock_take_item', 'expiry_date', 'INSERT'), 'expiry can be entered');

-- Reports, as an office user.
select set_config('request.jwt.claims', '{"sub": "40000000-0000-0000-0f15-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select results_eq($$ select site, item, qty, value_exc_vat, untraced_qty from public.stock_cost_per_site(current_date - 40, current_date + 1) $$,
  $$ values ('O-Base'::text, 'O DPD1'::text, 4::numeric, 240.00::numeric, 0::numeric) $$,
  'cost per site: 4 used at O-Base, R240 at the batch price');
select results_eq($$ select storage_area, technician_user_id, qty, value_exc_vat from public.stock_missing_by_technician(current_date - 40, current_date + 1) $$,
  $$ values ('O KIT'::text, '40000000-0000-0000-0f15-000000000001'::uuid, 2::numeric, 120.00::numeric) $$,
  'missing stock: 2 short in the technician''s kit, R120');
select is((select count(*)::int from public.stock_cost_per_site(current_date + 2, current_date + 30)), 0, 'nothing outside the dates');
reset role;

select * from finish();
rollback;
