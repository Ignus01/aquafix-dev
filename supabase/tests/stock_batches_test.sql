-- Tests for 20261119140000_stock_batches_fefo.sql: batches from receipts,
-- first-to-expire / first-in allocation, batches following transfers, cost,
-- back-dated documents and stock-take differences.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('40000000-0000-0000-ba7c-000000000001', '00000000-0000-0000-ba7c-000000000000', 'authenticated', 'authenticated',
        'b-tech@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values ('40000000-0000-0000-ba7c-000000000001', 'user');

insert into public.unit_of_measure (id, code, name, uom_type) values ('c0000000-0000-0000-ba7c-000000000001', 'BTAB', 'B Tablet', 'NODIM');
insert into public.product_type (id, code, name) values ('c1000000-0000-0000-ba7c-000000000001', 'BREAG', 'B Reagent');
insert into public.product (id, code, name, product_type_id, uom_id) values
  ('c2000000-0000-0000-ba7c-000000000001', 'BDPD1', 'BDPD1', 'c1000000-0000-0000-ba7c-000000000001', 'c0000000-0000-0000-ba7c-000000000001');
insert into public.pack_type (id, name, qty, uom_id) values
  ('c3000000-0000-0000-ba7c-000000000001', 'B pack', 1, 'c0000000-0000-0000-ba7c-000000000001');
insert into public.item (id, name, product_id, pack_type_id) values
  ('c7000000-0000-0000-ba7c-000000000001', 'B DPD1', 'c2000000-0000-0000-ba7c-000000000001', 'c3000000-0000-0000-ba7c-000000000001');
insert into public.region (id, name) values ('c4000000-0000-0000-ba7c-000000000001', 'B-Region');
insert into public.organisation (id, name, is_supplier) values
  ('c5000000-0000-0000-ba7c-000000000001', 'B-ORG', false),
  ('c5000000-0000-0000-ba7c-000000000002', 'B-SUPPLIER', true);
insert into public.location (id, name, region_id, organisation_id) values
  ('c6000000-0000-0000-ba7c-000000000001', 'B-Base', 'c4000000-0000-0000-ba7c-000000000001', 'c5000000-0000-0000-ba7c-000000000001'),
  ('c6000000-0000-0000-ba7c-000000000002', 'B-Selby', 'c4000000-0000-0000-ba7c-000000000001', 'c5000000-0000-0000-ba7c-000000000001');
insert into public.storage_area (id, code, name, location_id) values
  ('c8000000-0000-0000-ba7c-000000000001', 'B-KIT-R', 'B Ryan kit', 'c6000000-0000-0000-ba7c-000000000001'),
  ('c8000000-0000-0000-ba7c-000000000002', 'B-KIT-J', 'B Jonifas kit', 'c6000000-0000-0000-ba7c-000000000001');

-- Three orders at different prices.
insert into public.purchase_order (id, supplier_id) values
  ('d0000000-0000-0000-ba7c-000000000001', 'c5000000-0000-0000-ba7c-000000000002'),
  ('d0000000-0000-0000-ba7c-000000000002', 'c5000000-0000-0000-ba7c-000000000002'),
  ('d0000000-0000-0000-ba7c-000000000003', 'c5000000-0000-0000-ba7c-000000000002');
insert into public.purchase_order_item (id, purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, eta) values
  ('d1000000-0000-0000-ba7c-000000000001', 'd0000000-0000-0000-ba7c-000000000001', 'c7000000-0000-0000-ba7c-000000000001', 3, 100, current_date),
  ('d1000000-0000-0000-ba7c-000000000002', 'd0000000-0000-0000-ba7c-000000000002', 'c7000000-0000-0000-ba7c-000000000001', 3, 120, current_date),
  ('d1000000-0000-0000-ba7c-000000000003', 'd0000000-0000-0000-ba7c-000000000003', 'c7000000-0000-0000-ba7c-000000000001', 2, 150, current_date);

-- Where a ledger row's stock came from: "PO line ×qty @cost" sorted.
create function pg_temp.came_from(p_tx uuid) returns text language sql as $$
  select string_agg(coalesce(right(l.purchase_order_item_id::text, 1), l.source) || '×' || (-a.qty)::text || '@' || coalesce(a.unit_cost_exc_vat::numeric(10,0)::text, '?'),
                    ' + ' order by l.reference)
    from public.stock_allocation a left join public.stock_lot l on l.id = a.lot_id
   where a.item_transaction_id = p_tx;
$$;
create function pg_temp.wo_tx(p_wo text) returns uuid language sql as $$
  select t.id from public.item_transaction t join public.work_order_item wi on wi.id = t.work_order_item_id
   where wi.work_order_id = p_wo::uuid;
$$;
create function pg_temp.lot_qty(p_po_line text, p_area text) returns numeric language sql as $$
  select coalesce(sum(b.qty), 0) from public.stock_lot_balance b join public.stock_lot l on l.id = b.lot_id
   where l.purchase_order_item_id = p_po_line::uuid and b.storage_area_id = p_area::uuid;
$$;
grant execute on function pg_temp.came_from(uuid), pg_temp.wo_tx(text), pg_temp.lot_qty(text, text) to authenticated;

select set_config('request.jwt.claims', '{"sub": "40000000-0000-0000-ba7c-000000000001", "role": "authenticated"}', true);
set local role authenticated;

-- PO 1 (R100) received 5 days ago, expires in 2 months; PO 2 (R120) received
-- 3 days ago, expires next month (sooner); PO 3 (R150) 2 days ago, no expiry.
select lives_ok($$ select public.receive_purchase_order(jsonb_build_object(
  'purchase_order_id', 'd0000000-0000-0000-ba7c-000000000001', 'storage_area_id', 'c8000000-0000-0000-ba7c-000000000001',
  'captured_at', now() - interval '5 days',
  'lines', jsonb_build_array(jsonb_build_object('purchase_order_item_id', 'd1000000-0000-0000-ba7c-000000000001', 'qty', 3,
    'batch_number', 'B-OLD', 'expiry_date', (current_date + 60)::text)))) $$, 'PO 1 received with batch and expiry');
select lives_ok($$ select public.receive_purchase_order(jsonb_build_object(
  'purchase_order_id', 'd0000000-0000-0000-ba7c-000000000002', 'storage_area_id', 'c8000000-0000-0000-ba7c-000000000001',
  'captured_at', now() - interval '3 days',
  'lines', jsonb_build_array(jsonb_build_object('purchase_order_item_id', 'd1000000-0000-0000-ba7c-000000000002', 'qty', 3,
    'batch_number', 'B-SOON', 'expiry_date', (current_date + 30)::text)))) $$, 'PO 2 received');
select throws_ok($$ select public.receive_purchase_order(jsonb_build_object(
  'purchase_order_id', 'd0000000-0000-0000-ba7c-000000000003', 'storage_area_id', 'c8000000-0000-0000-ba7c-000000000001',
  'lines', jsonb_build_array(jsonb_build_object('purchase_order_item_id', 'd1000000-0000-0000-ba7c-000000000003', 'qty', 1,
    'expiry_date', '31/02/2027')))) $$, 'P0001', 'Line 1: the expiry date isn''t a valid date.', 'a bad expiry is refused');
select lives_ok($$ select public.receive_purchase_order(jsonb_build_object(
  'purchase_order_id', 'd0000000-0000-0000-ba7c-000000000003', 'storage_area_id', 'c8000000-0000-0000-ba7c-000000000001',
  'captured_at', now() - interval '2 days',
  'lines', jsonb_build_array(jsonb_build_object('purchase_order_item_id', 'd1000000-0000-0000-ba7c-000000000003', 'qty', 2)))) $$,
  'PO 3 received without batch or expiry');

select is((select count(*) from public.stock_lot where item_id = 'c7000000-0000-0000-ba7c-000000000001'), 3::bigint,
  'one batch per receipt line');
select is((select batch_number || ' ' || unit_cost_exc_vat::numeric(10,0) from public.stock_lot
            where purchase_order_item_id = 'd1000000-0000-0000-ba7c-000000000002'), 'B-SOON 120', 'a batch keeps its number and PO cost');
select is((select next_expiry from public.storage_area_stock where storage_area_id = 'c8000000-0000-0000-ba7c-000000000001'),
  current_date + 30, 'the kit''s next expiry is the soonest batch');

-- Transfer 4 to Jonifas: first to expire first (PO 2's 3), then PO 1 (1).
select lives_ok($$ select public.save_stock_document(jsonb_build_object('kind', 'transfers',
  'captured_at', now() - interval '1 day',
  'header', jsonb_build_object('id', 'e0000000-0000-0000-ba7c-000000000001', 'transfer_type', 'BOTH',
    'from_storage_area_id', 'c8000000-0000-0000-ba7c-000000000001', 'to_storage_area_id', 'c8000000-0000-0000-ba7c-000000000002'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', 'c7000000-0000-0000-ba7c-000000000001', 'qty', 4)))) $$, 'transfer 4');
select is(pg_temp.lot_qty('d1000000-0000-0000-ba7c-000000000002', 'c8000000-0000-0000-ba7c-000000000002'), 3::numeric,
  'Jonifas got all of the batch expiring first');
select is(pg_temp.lot_qty('d1000000-0000-0000-ba7c-000000000001', 'c8000000-0000-0000-ba7c-000000000002'), 1::numeric,
  'and 1 of the next');
select is(pg_temp.lot_qty('d1000000-0000-0000-ba7c-000000000003', 'c8000000-0000-0000-ba7c-000000000001'), 2::numeric,
  'the batch with no expiry stays with Ryan');

-- Jonifas uses 2 at Selby: from the batches he was given, expiring first.
select lives_ok($$ select public.save_stock_document(jsonb_build_object('kind', 'work-orders',
  'header', jsonb_build_object('id', 'e1000000-0000-0000-ba7c-000000000001', 'storage_area_id', 'c8000000-0000-0000-ba7c-000000000002',
    'location_id', 'c6000000-0000-0000-ba7c-000000000002'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', 'c7000000-0000-0000-ba7c-000000000001', 'qty', 2)))) $$, 'usage at Selby');
select is(pg_temp.came_from(pg_temp.wo_tx('e1000000-0000-0000-ba7c-000000000001')), '2×2@120',
  'usage traces to PO 2 at R120');
select is((select sum(value_exc_vat) from public.stock_allocation where item_transaction_id = pg_temp.wo_tx('e1000000-0000-0000-ba7c-000000000001')),
  -240::numeric, 'and is valued at R240');

-- Ryan uses 3 (no expiry date set on what is left except PO 1's 2): PO 1's 2 then PO 3's 1.
select lives_ok($$ select public.save_stock_document(jsonb_build_object('kind', 'work-orders',
  'header', jsonb_build_object('id', 'e1000000-0000-0000-ba7c-000000000002', 'storage_area_id', 'c8000000-0000-0000-ba7c-000000000001'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', 'c7000000-0000-0000-ba7c-000000000001', 'qty', 3)))) $$, 'Ryan uses 3');
select is(pg_temp.came_from(pg_temp.wo_tx('e1000000-0000-0000-ba7c-000000000002')), '1×2@100 + 3×1@150',
  'dated stock first, then the batch with no expiry');

-- A back-dated receipt (before all of the above) of a batch expiring sooner
-- than everything re-allocates the earlier movements.
reset role;
insert into public.purchase_order (id, supplier_id) values ('d0000000-0000-0000-ba7c-000000000004', 'c5000000-0000-0000-ba7c-000000000002');
insert into public.purchase_order_item (id, purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, eta) values
  ('d1000000-0000-0000-ba7c-000000000004', 'd0000000-0000-0000-ba7c-000000000004', 'c7000000-0000-0000-ba7c-000000000001', 4, 90, current_date);
set local role authenticated;
select lives_ok($$ select public.receive_purchase_order(jsonb_build_object(
  'purchase_order_id', 'd0000000-0000-0000-ba7c-000000000004', 'storage_area_id', 'c8000000-0000-0000-ba7c-000000000001',
  'captured_at', now() - interval '6 days',
  'lines', jsonb_build_array(jsonb_build_object('purchase_order_item_id', 'd1000000-0000-0000-ba7c-000000000004', 'qty', 4,
    'expiry_date', (current_date + 10)::text)))) $$, 'a receipt dated before everything else');
select is(pg_temp.lot_qty('d1000000-0000-0000-ba7c-000000000004', 'c8000000-0000-0000-ba7c-000000000002'), 2::numeric,
  'the transfer now sends that batch first (4 sent, 2 since used)');
select is(pg_temp.came_from(pg_temp.wo_tx('e1000000-0000-0000-ba7c-000000000001')), '4×2@90',
  'and Jonifas''s usage now traces to it');

-- Changing an expiry re-orders: PO 4's batch now expires last.
update public.intake_item set expiry_date = current_date + 365
 where purchase_order_item_id = 'd1000000-0000-0000-ba7c-000000000004';
select is(pg_temp.came_from(pg_temp.wo_tx('e1000000-0000-0000-ba7c-000000000001')), '2×2@120',
  'a later expiry hands the first place back');

-- Stock take: a shortfall takes the batch expiring first; a surplus gets its own batch.
select lives_ok($$ select public.save_stock_document(jsonb_build_object('kind', 'stock-takes',
  'header', jsonb_build_object('id', 'e2000000-0000-0000-ba7c-000000000001', 'storage_area_id', 'c8000000-0000-0000-ba7c-000000000002'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', 'c7000000-0000-0000-ba7c-000000000001', 'counted_qty', 1)))) $$,
  'Jonifas counts 1 of 2');
select is((select pg_temp.came_from(t.id) from public.item_transaction t join public.stock_take_item si on si.id = t.stock_take_item_id
            where si.stock_take_id = 'e2000000-0000-0000-ba7c-000000000001'), '2×1@120', 'the shortfall is the batch expiring first');
select lives_ok($$ select public.save_stock_document(jsonb_build_object('kind', 'stock-takes',
  'header', jsonb_build_object('id', 'e2000000-0000-0000-ba7c-000000000002', 'storage_area_id', 'c8000000-0000-0000-ba7c-000000000002'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', 'c7000000-0000-0000-ba7c-000000000001', 'counted_qty', 3)))) $$,
  'then finds 2 more');
select is((select l.source || ' ' || l.unit_cost_exc_vat::numeric(10,0) from public.stock_lot l join public.item_transaction t on t.id = l.item_transaction_id
            join public.stock_take_item si on si.id = t.stock_take_item_id where si.stock_take_id = 'e2000000-0000-0000-ba7c-000000000002'),
  'ADJUSTMENT 150', 'a surplus is its own batch at the latest cost received');

-- Batches always add up to the ledger.
select is((select sum(qty) from public.stock_lot_balance where item_id = 'c7000000-0000-0000-ba7c-000000000001'),
  (select sum(qty) from public.storage_area_stock where item_id = 'c7000000-0000-0000-ba7c-000000000001'),
  'batch balances equal stock on hand');
select is((select count(*) from public.stock_allocation where lot_id is null), 0::bigint, 'nothing untraced');
select throws_ok($$ delete from public.stock_allocation $$, '42501', null, 'nobody writes allocations directly');

-- Deleting the usage puts its batches back.
select is(pg_temp.lot_qty('d1000000-0000-0000-ba7c-000000000001', 'c8000000-0000-0000-ba7c-000000000001'), 0::numeric,
  'Ryan''s usage took PO 1''s batch (expiring before PO 4''s)');
reset role;
delete from public.work_order where id = 'e1000000-0000-0000-ba7c-000000000002';
select is(pg_temp.lot_qty('d1000000-0000-0000-ba7c-000000000001', 'c8000000-0000-0000-ba7c-000000000001'), 2::numeric,
  'deleting a usage returns the batch it had taken');

-- Same minute: a transfer dated 13:09 (forms drop the seconds) saved after a
-- receipt stamped 13:09:30 still takes from that receipt.
reset role;
insert into public.purchase_order (id, supplier_id) values ('d0000000-0000-0000-ba7c-000000000005', 'c5000000-0000-0000-ba7c-000000000002');
insert into public.purchase_order_item (id, purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, eta) values
  ('d1000000-0000-0000-ba7c-000000000005', 'd0000000-0000-0000-ba7c-000000000005', 'c7000000-0000-0000-ba7c-000000000001', 1, 70, current_date);
insert into public.storage_area (id, code, name, location_id) values
  ('c8000000-0000-0000-ba7c-000000000003', 'B-KIT-X', 'B empty kit', 'c6000000-0000-0000-ba7c-000000000001');
set local role authenticated;
select lives_ok($$ select public.receive_purchase_order(jsonb_build_object(
  'purchase_order_id', 'd0000000-0000-0000-ba7c-000000000005', 'storage_area_id', 'c8000000-0000-0000-ba7c-000000000003',
  'captured_at', date_trunc('minute', now() - interval '1 hour') + interval '30 seconds',
  'lines', jsonb_build_array(jsonb_build_object('purchase_order_item_id', 'd1000000-0000-0000-ba7c-000000000005', 'qty', 1)))) $$,
  'received at hh:mm:30');
select lives_ok($$ select public.save_stock_document(jsonb_build_object('kind', 'transfers',
  'header', jsonb_build_object('transfer_type', 'BOTH', 'transfer_date', date_trunc('minute', now() - interval '1 hour'),
    'from_storage_area_id', 'c8000000-0000-0000-ba7c-000000000003', 'to_storage_area_id', 'c8000000-0000-0000-ba7c-000000000002'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', 'c7000000-0000-0000-ba7c-000000000001', 'qty', 1)))) $$,
  'then sent on, dated hh:mm:00');
select is(pg_temp.lot_qty('d1000000-0000-0000-ba7c-000000000005', 'c8000000-0000-0000-ba7c-000000000002'), 1::numeric,
  'the transfer carried that receipt''s batch');

select * from finish();
rollback;
