-- Tests for the stock manager (spec: AquaFix Stock Management Spec): the
-- ledger postings of every document, the three spec bugs (transfer receive
-- link, work-order sign, stock-take recalculation), PO status, the negative
-- stock guard and roles.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup (superuser: no RLS)
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-57d0-000000000001', '00000000-0000-0000-57d0-000000000000', 'authenticated', 'authenticated',
   'm-user@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-57d0-000000000002', '00000000-0000-0000-57d0-000000000000', 'authenticated', 'authenticated',
   'm-admin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-57d0-000000000003', '00000000-0000-0000-57d0-000000000000', 'authenticated', 'authenticated',
   'm-viewer@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-57d0-000000000004', '00000000-0000-0000-57d0-000000000000', 'authenticated', 'authenticated',
   'm-sysadmin@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-57d0-000000000001', 'user'),
  ('10000000-0000-0000-57d0-000000000002', 'admin'),
  ('10000000-0000-0000-57d0-000000000003', 'viewer'),
  ('10000000-0000-0000-57d0-000000000004', 'system_admin');

insert into public.unit_of_measure (id, code, name, uom_type) values
  ('c0000000-0000-0000-57d0-000000000001', 'ML-L', 'M Litre', 'VOLUME');
insert into public.product_type (id, code, name) values ('c1000000-0000-0000-57d0-000000000001', 'MCH', 'M Chem');
insert into public.product (id, code, name, product_type_id, uom_id) values
  ('c2000000-0000-0000-57d0-000000000001', 'MCHLOR', 'MCHLOR', 'c1000000-0000-0000-57d0-000000000001', 'c0000000-0000-0000-57d0-000000000001');
insert into public.pack_type (id, name, qty, uom_id) values
  ('c3000000-0000-0000-57d0-000000000001', 'M 5 Litre Drum', 5, 'c0000000-0000-0000-57d0-000000000001');
-- One item: 5 base units per pack.
insert into public.item (id, name, product_id, pack_type_id) values
  ('c7000000-0000-0000-57d0-000000000001', 'M drum', 'c2000000-0000-0000-57d0-000000000001', 'c3000000-0000-0000-57d0-000000000001');
-- A second item, only for the purchase order's second line (an item goes on an order once).
insert into public.pack_type (id, name, qty, uom_id) values
  ('c3000000-0000-0000-57d0-000000000002', 'M 1 Litre Bottle', 1, 'c0000000-0000-0000-57d0-000000000001');
insert into public.item (id, name, product_id, pack_type_id) values
  ('c7000000-0000-0000-57d0-000000000002', 'M bottle', 'c2000000-0000-0000-57d0-000000000001', 'c3000000-0000-0000-57d0-000000000002');

insert into public.region (id, name) values ('c4000000-0000-0000-57d0-000000000001', 'M-North');
insert into public.organisation (id, name, is_supplier) values
  ('c5000000-0000-0000-57d0-000000000001', 'M-ORG', false),
  ('c5000000-0000-0000-57d0-000000000002', 'M-SUPPLIER', true);
insert into public.location (id, name, region_id, organisation_id) values
  ('c6000000-0000-0000-57d0-000000000001', 'M-Plant', 'c4000000-0000-0000-57d0-000000000001', 'c5000000-0000-0000-57d0-000000000001');
insert into public.storage_area (id, code, name, location_id) values
  ('c8000000-0000-0000-57d0-000000000001', 'MA', 'M Area A', 'c6000000-0000-0000-57d0-000000000001'),
  ('c8000000-0000-0000-57d0-000000000002', 'MB', 'M Area B', 'c6000000-0000-0000-57d0-000000000001');

create function pg_temp.stock(p_area text) returns numeric language sql as $$
  select coalesce((select qty from public.storage_area_item_stock
                    where item_id = 'c7000000-0000-0000-57d0-000000000001' and storage_area_id = p_area::uuid), 0);
$$;
create function pg_temp.base(p_area text) returns numeric language sql as $$
  select coalesce((select base_qty from public.storage_area_item_stock
                    where item_id = 'c7000000-0000-0000-57d0-000000000001' and storage_area_id = p_area::uuid), 0);
$$;
create function pg_temp.rows(p_type text) returns bigint language sql as $$
  select count(*) from public.item_transaction where transaction_type = p_type::public.transaction_type;
$$;

-- ============================================================================
-- Purchase order and PO intake
-- ============================================================================
insert into public.purchase_order (id, supplier_id) values
  ('d0000000-0000-0000-57d0-000000000001', 'c5000000-0000-0000-57d0-000000000002');
insert into public.purchase_order_item (id, purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, eta) values
  ('d1000000-0000-0000-57d0-000000000001', 'd0000000-0000-0000-57d0-000000000001', 'c7000000-0000-0000-57d0-000000000001', 10, 100, current_date),
  ('d1000000-0000-0000-57d0-000000000002', 'd0000000-0000-0000-57d0-000000000001', 'c7000000-0000-0000-57d0-000000000002', 4, 50, current_date);

-- Line rules (PurchaseOrderItem_Validate).
select throws_ok($$ insert into public.purchase_order_item (purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, eta)
  values ('d0000000-0000-0000-57d0-000000000001', 'c7000000-0000-0000-57d0-000000000001', 1, 10, current_date) $$,
  'P0001', 'That item is already on this purchase order.', 'an item goes on a purchase order once');
insert into public.purchase_order (id, supplier_id) values
  ('d0000000-0000-0000-57d0-000000000002', 'c5000000-0000-0000-57d0-000000000002');
select throws_ok($$ insert into public.purchase_order_item (purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat)
  values ('d0000000-0000-0000-57d0-000000000002', 'c7000000-0000-0000-57d0-000000000001', 1, 10) $$,
  'P0001', 'ETA is required.', 'a line needs an ETA');
select throws_ok($$ insert into public.purchase_order_item (purchase_order_id, item_id, qty_ordered, eta)
  values ('d0000000-0000-0000-57d0-000000000002', 'c7000000-0000-0000-57d0-000000000001', 1, current_date) $$,
  'P0001', 'Unit cost must be greater than 0.', 'a line needs a unit cost');
select lives_ok($$ insert into public.purchase_order_item (purchase_order_id, item_id, qty_ordered, unit_cost_inc_vat, eta)
  values ('d0000000-0000-0000-57d0-000000000002', 'c7000000-0000-0000-57d0-000000000001', 1, 23, current_date) $$,
  'the inc VAT price alone is enough');
delete from public.purchase_order_item where purchase_order_id = 'd0000000-0000-0000-57d0-000000000002';

select is((select unit_cost_inc_vat from public.purchase_order_item where id = 'd1000000-0000-0000-57d0-000000000001'),
  round(100 * (1 + public.get_vat_rate()), 4), 'unit cost inc VAT derived from exc');
select is((select base_qty from public.purchase_order_item where id = 'd1000000-0000-0000-57d0-000000000001'), 50::numeric,
  'PO line base qty = ordered x item conversion');
select is((select nr_of_items from public.purchase_order where id = 'd0000000-0000-0000-57d0-000000000001'), 2, 'PO item count');
select is((select total_cost_exc_vat from public.purchase_order where id = 'd0000000-0000-0000-57d0-000000000001'), 1200::numeric,
  'PO total exc VAT');
select is((select status::text from public.purchase_order where id = 'd0000000-0000-0000-57d0-000000000001'), 'new', 'PO starts new');

update public.purchase_order_item set unit_cost_inc_vat = 115
 where id = 'd1000000-0000-0000-57d0-000000000002' and public.get_vat_rate() = 0.15;
select is((select unit_cost_exc_vat from public.purchase_order_item where id = 'd1000000-0000-0000-57d0-000000000002'), 100::numeric,
  'editing the inc VAT price drives the exc VAT price');
update public.purchase_order_item set unit_cost_exc_vat = 50, unit_cost_inc_vat = 57.5
 where id = 'd1000000-0000-0000-57d0-000000000002';

insert into public.load (id) values ('d2000000-0000-0000-57d0-000000000001');
select throws_ok($$ insert into public.intake (load_id, storage_area_id, supplier_id, purchase_order_id, invoice_number) values
  ('d2000000-0000-0000-57d0-000000000001', 'c8000000-0000-0000-57d0-000000000001',
   'c5000000-0000-0000-57d0-000000000002', 'd0000000-0000-0000-57d0-000000000001', 'INV-1') $$,
  'P0001', 'Delivery note is required.', 'a PO intake needs a delivery note');
select throws_ok($$ insert into public.intake (load_id, storage_area_id, supplier_id, purchase_order_id, delivery_note, invoice_number) values
  ('d2000000-0000-0000-57d0-000000000001', 'c8000000-0000-0000-57d0-000000000001',
   'c5000000-0000-0000-57d0-000000000002', 'd0000000-0000-0000-57d0-000000000001', 'DN-1', '  ') $$,
  'P0001', 'Invoice number is required.', 'and an invoice number');
insert into public.intake (id, load_id, storage_area_id, supplier_id, purchase_order_id, delivery_note, invoice_number) values
  ('d3000000-0000-0000-57d0-000000000001', 'd2000000-0000-0000-57d0-000000000001', 'c8000000-0000-0000-57d0-000000000001',
   'c5000000-0000-0000-57d0-000000000002', 'd0000000-0000-0000-57d0-000000000001', 'DN-1', 'INV-1');

insert into public.intake_item (id, intake_id, item_id, purchase_order_item_id, qty) values
  ('d4000000-0000-0000-57d0-000000000001', 'd3000000-0000-0000-57d0-000000000001',
   'c7000000-0000-0000-57d0-000000000001', 'd1000000-0000-0000-57d0-000000000001', 6);
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 6::numeric, 'receipt posts positive qty');
select is(pg_temp.base('c8000000-0000-0000-57d0-000000000001'), 30::numeric, 'receipt posts base qty');
select is(pg_temp.rows('INTAKE_PURCHASE_ORDER'), 1::bigint, 'one INTAKE_PURCHASE_ORDER row');
select is((select qty_outstanding from public.purchase_order_item where id = 'd1000000-0000-0000-57d0-000000000001'), 4::numeric,
  'PO line outstanding after partial receipt');
select is((select status::text from public.purchase_order_item where id = 'd1000000-0000-0000-57d0-000000000001'), 'new',
  'partially received line stays new');

-- A receipt leaves the prices alone, whatever the VAT rate is by then.
update public.system_settings set vat_rate = vat_rate + 0.05 where id = 1;
update public.intake_item set qty = 10 where id = 'd4000000-0000-0000-57d0-000000000001';
update public.system_settings set vat_rate = vat_rate - 0.05 where id = 1;
select is((select unit_cost_inc_vat from public.purchase_order_item where id = 'd1000000-0000-0000-57d0-000000000001'),
  round(100 * (1 + public.get_vat_rate()), 4), 'receiving does not reprice the line at a new VAT rate');
select is((select status::text from public.purchase_order_item where id = 'd1000000-0000-0000-57d0-000000000001'), 'completed',
  'fully received line is completed');
select is((select status::text from public.purchase_order where id = 'd0000000-0000-0000-57d0-000000000001'), 'new',
  'PO stays new while another line is new');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 10::numeric, 'editing the receipt updates the same ledger row');
select is(pg_temp.rows('INTAKE_PURCHASE_ORDER'), 1::bigint, 'still one ledger row');

update public.purchase_order_item set status = 'closed' where id = 'd1000000-0000-0000-57d0-000000000002';
select is((select status::text from public.purchase_order where id = 'd0000000-0000-0000-57d0-000000000001'), 'closed',
  'no new lines and one closed: PO closed');
update public.purchase_order_item set status = 'new' where id = 'd1000000-0000-0000-57d0-000000000002';
-- A closed line completes once exactly what was ordered has arrived.
update public.purchase_order_item set status = 'closed' where id = 'd1000000-0000-0000-57d0-000000000002';
insert into public.intake_item (intake_id, item_id, purchase_order_item_id, qty, transaction_date) values
  ('d3000000-0000-0000-57d0-000000000001', 'c7000000-0000-0000-57d0-000000000002', 'd1000000-0000-0000-57d0-000000000002', 4, now());
select is((select status::text from public.purchase_order_item where id = 'd1000000-0000-0000-57d0-000000000002'), 'completed',
  'received = ordered completes the line, even a closed one');
select is((select status::text from public.purchase_order where id = 'd0000000-0000-0000-57d0-000000000001'), 'completed',
  'all lines completed: PO completed');
update public.purchase_order_item set status = 'closed' where id = 'd1000000-0000-0000-57d0-000000000002';
select is((select status::text from public.purchase_order_item where id = 'd1000000-0000-0000-57d0-000000000002'), 'completed',
  'a completed line can''t be closed');
-- Over-receipt: allowed, negative outstanding, and the line is open again until someone closes it.
update public.intake_item set qty = 5 where purchase_order_item_id = 'd1000000-0000-0000-57d0-000000000002';
select is((select qty_outstanding from public.purchase_order_item where id = 'd1000000-0000-0000-57d0-000000000002'), -1::numeric,
  'over-receipt is allowed and shows as negative outstanding');
select is((select status::text from public.purchase_order_item where id = 'd1000000-0000-0000-57d0-000000000002'), 'new',
  'an over-received line is not completed');
select is((select status::text from public.purchase_order where id = 'd0000000-0000-0000-57d0-000000000001'), 'new',
  'so its PO is new again');
update public.purchase_order_item set status = 'closed' where id = 'd1000000-0000-0000-57d0-000000000002';
select is((select status::text from public.purchase_order where id = 'd0000000-0000-0000-57d0-000000000001'), 'closed',
  'until the over-received line is closed');
update public.purchase_order_item set status = 'new' where id = 'd1000000-0000-0000-57d0-000000000002';
-- Back to a clean 10 in area A.
delete from public.intake_item where purchase_order_item_id = 'd1000000-0000-0000-57d0-000000000002';
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 10::numeric, 'deleting a receipt removes its ledger row');
select is((select status::text from public.purchase_order_item where id = 'd1000000-0000-0000-57d0-000000000002'), 'new',
  'deleting the receipt reopens the PO line');

-- A line can be received once per intake.
select throws_ok($$ insert into public.intake_item (intake_id, item_id, purchase_order_item_id, qty) values
  ('d3000000-0000-0000-57d0-000000000001', 'c7000000-0000-0000-57d0-000000000001', 'd1000000-0000-0000-57d0-000000000001', 1) $$,
  '23505', null, 'a PO line is added once per intake');

-- ============================================================================
-- Transfers (spec bug: the receive row shared the SEND link)
-- ============================================================================
insert into public.transfer_main (id, transfer_type, from_storage_area_id, to_storage_area_id) values
  ('e0000000-0000-0000-57d0-000000000001', 'BOTH', 'c8000000-0000-0000-57d0-000000000001', 'c8000000-0000-0000-57d0-000000000002');
insert into public.transfer_item (id, transfer_id, item_id, qty) values
  ('e1000000-0000-0000-57d0-000000000001', 'e0000000-0000-0000-57d0-000000000001', 'c7000000-0000-0000-57d0-000000000001', 3);
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 7::numeric, 'BOTH transfer: sent from area A');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000002'), 3::numeric, 'BOTH transfer: received in area B');
select is(pg_temp.rows('STOCK_TRANSFER'), 2::bigint, 'BOTH transfer: two ledger rows');

-- Re-saving must not drift stock.
update public.transfer_item set qty = 3 where id = 'e1000000-0000-0000-57d0-000000000001';
update public.transfer_item set qty = 2 where id = 'e1000000-0000-0000-57d0-000000000001';
update public.transfer_item set qty = 2 where id = 'e1000000-0000-0000-57d0-000000000001';
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 8::numeric, 're-save: area A is stable');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000002'), 2::numeric, 're-save: area B is stable');
select is(pg_temp.rows('STOCK_TRANSFER'), 2::bigint, 're-save: still two rows');

-- Changing the header type removes the leg that no longer applies.
update public.transfer_main set transfer_type = 'SEND' where id = 'e0000000-0000-0000-57d0-000000000001';
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000002'), 0::numeric, 'type changed to SEND: receive leg removed');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 8::numeric, 'type changed to SEND: send leg kept');
update public.transfer_main set transfer_type = 'RECEIVE' where id = 'e0000000-0000-0000-57d0-000000000001';
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 10::numeric, 'type changed to RECEIVE: send leg removed');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000002'), 2::numeric, 'type changed to RECEIVE: receive leg added');
update public.transfer_main set transfer_type = 'BOTH' where id = 'e0000000-0000-0000-57d0-000000000001';
select is(pg_temp.rows('STOCK_TRANSFER'), 2::bigint, 'back to BOTH: two rows');

select throws_ok($$ insert into public.transfer_item (transfer_id, item_id, qty) values
  ('e0000000-0000-0000-57d0-000000000001', 'c7000000-0000-0000-57d0-000000000001', 1) $$,
  '23505', null, 'an item appears once per transfer');
select throws_ok($$ insert into public.transfer_main (transfer_type, from_storage_area_id, to_storage_area_id) values
  ('BOTH', 'c8000000-0000-0000-57d0-000000000001', 'c8000000-0000-0000-57d0-000000000001') $$,
  '23514', null, 'a transfer needs two different areas');

-- Negative stock is blocked (the guard is deferred, so force it to run now).
set constraints all immediate;
select throws_ok($$ update public.transfer_item set qty = 50 where id = 'e1000000-0000-0000-57d0-000000000001' $$,
  'P0001', null, 'a transfer can''t send more than is on hand');
select throws_ok($$ delete from public.intake_item where id = 'd4000000-0000-0000-57d0-000000000001' $$,
  'P0001', null, 'a receipt that has been moved on can''t be deleted');
set constraints all deferred;
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 8::numeric, 'failed saves left stock alone');

-- ============================================================================
-- Work orders (spec bug: usage added stock)
-- ============================================================================
insert into public.work_order (id, storage_area_id) values
  ('f0000000-0000-0000-57d0-000000000001', 'c8000000-0000-0000-57d0-000000000001');
insert into public.work_order_item (id, work_order_id, item_id, qty, transaction_date) values
  ('f1000000-0000-0000-57d0-000000000001', 'f0000000-0000-0000-57d0-000000000001', 'c7000000-0000-0000-57d0-000000000001', 3,
   now() - interval '1 hour');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 5::numeric, 'usage reduces stock');
select is(pg_temp.base('c8000000-0000-0000-57d0-000000000001'), 25::numeric, 'usage reduces base stock');
select is(pg_temp.rows('WORK_ORDER_USAGE'), 1::bigint, 'one WORK_ORDER_USAGE row');

update public.work_order_item set is_return = true, qty = 1 where id = 'f1000000-0000-0000-57d0-000000000001';
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 9::numeric, 'a return adds stock');
select is(pg_temp.rows('WORK_ORDER_RETURN'), 1::bigint, 'return is its own transaction type');
update public.work_order_item set is_return = false, qty = 3 where id = 'f1000000-0000-0000-57d0-000000000001';

select throws_ok($$ insert into public.work_order_item (work_order_id, item_id, qty, transaction_date) values
  ('f0000000-0000-0000-57d0-000000000001', 'c7000000-0000-0000-57d0-000000000001', 1, now() + interval '1 day') $$,
  'P0001', null, 'usage date can''t be in the future');
select throws_ok($$ insert into public.work_order_item (work_order_id, item_id, qty) values
  ('f0000000-0000-0000-57d0-000000000001', 'c7000000-0000-0000-57d0-000000000001', 0) $$,
  '23514', null, 'usage quantity must be positive');

-- Moving the work order moves its lines.
update public.work_order_item set qty = 2 where id = 'f1000000-0000-0000-57d0-000000000001';
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 6::numeric, 'usage edited down: stock goes back up');
update public.work_order set storage_area_id = 'c8000000-0000-0000-57d0-000000000002' where id = 'f0000000-0000-0000-57d0-000000000001';
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 8::numeric, 'area changed: usage leaves area A');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000002'), 0::numeric, 'area changed: usage lands in area B');
update public.work_order set storage_area_id = 'c8000000-0000-0000-57d0-000000000001' where id = 'f0000000-0000-0000-57d0-000000000001';
update public.work_order_item set qty = 3 where id = 'f1000000-0000-0000-57d0-000000000001';

-- ============================================================================
-- Stock takes (spec bug: count overwritten, own row in the sum)
-- ============================================================================
insert into public.stock_take (id, storage_area_id) values
  ('a0000000-0000-0000-57d0-000000000001', 'c8000000-0000-0000-57d0-000000000001');
insert into public.stock_take_item (id, stock_take_id, item_id, counted_qty) values
  ('a1000000-0000-0000-57d0-000000000001', 'a0000000-0000-0000-57d0-000000000001', 'c7000000-0000-0000-57d0-000000000001', 7);
select is((select adjustment_qty from public.stock_take_item where id = 'a1000000-0000-0000-57d0-000000000001'), 2::numeric,
  'adjustment = count - ledger total');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 7::numeric, 'stock on hand equals the count');
select is((select counted_qty from public.stock_take_item where id = 'a1000000-0000-0000-57d0-000000000001'), 7::numeric,
  'the entered count is kept');

update public.stock_take_item set counted_qty = 7 where id = 'a1000000-0000-0000-57d0-000000000001';
update public.stock_take_item set counted_qty = 7 where id = 'a1000000-0000-0000-57d0-000000000001';
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 7::numeric, 're-save: stock still equals the count');
select is((select adjustment_qty from public.stock_take_item where id = 'a1000000-0000-0000-57d0-000000000001'), 2::numeric,
  're-save: adjustment unchanged');

update public.stock_take_item set counted_qty = 12 where id = 'a1000000-0000-0000-57d0-000000000001';
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 12::numeric, 'changing the count re-adjusts');
select is(pg_temp.rows('STOCK_ADJUSTMENT'), 1::bigint, 'still one adjustment row');

-- ============================================================================
-- Ledger integrity (20261112120000): future dates, backdated movements and
-- base quantities. In its own storage area so the counts above are untouched.
-- ============================================================================
insert into public.storage_area (id, code, name, location_id) values
  ('c8000000-0000-0000-57d0-000000000003', 'MC', 'M Area C', 'c6000000-0000-0000-57d0-000000000001');

select throws_ok($$ insert into public.transfer_main (transfer_type, transfer_date, to_storage_area_id)
  values ('RECEIVE', now() + interval '1 day', 'c8000000-0000-0000-57d0-000000000003') $$,
  'P0001', 'The date can''t be in the future.', 'a transfer can''t be dated in the future');
select throws_ok($$ insert into public.stock_take (take_date, storage_area_id)
  values (now() + interval '1 day', 'c8000000-0000-0000-57d0-000000000003') $$,
  'P0001', 'The date can''t be in the future.', 'a stock take can''t be dated in the future');
select throws_ok($$ update public.intake_item set transaction_date = now() + interval '1 day' $$,
  'P0001', 'The date can''t be in the future.', 'a receipt can''t be dated in the future');
select lives_ok($$ insert into public.stock_take (take_date, storage_area_id)
  values (now() + interval '1 minute', 'c8000000-0000-0000-57d0-000000000003') $$,
  'a clock a minute ahead is tolerated');
delete from public.stock_take where storage_area_id = 'c8000000-0000-0000-57d0-000000000003';

-- 10 received three days ago, counted as 8 yesterday.
insert into public.transfer_main (id, transfer_type, transfer_date, to_storage_area_id) values
  ('e0000000-0000-0000-57d0-0000000000c1', 'RECEIVE', now() - interval '3 days', 'c8000000-0000-0000-57d0-000000000003');
insert into public.transfer_item (transfer_id, item_id, qty) values
  ('e0000000-0000-0000-57d0-0000000000c1', 'c7000000-0000-0000-57d0-000000000001', 10);
insert into public.stock_take (id, take_date, storage_area_id) values
  ('a0000000-0000-0000-57d0-0000000000c1', now() - interval '1 day', 'c8000000-0000-0000-57d0-000000000003');
insert into public.stock_take_item (id, stock_take_id, item_id, counted_qty) values
  ('a1000000-0000-0000-57d0-0000000000c1', 'a0000000-0000-0000-57d0-0000000000c1', 'c7000000-0000-0000-57d0-000000000001', 8);
select is((select adjustment_qty from public.stock_take_item where id = 'a1000000-0000-0000-57d0-0000000000c1'), -2::numeric,
  'count of 8 against 10 adjusts by -2');

-- Usage of 3 captured late, dated before the count: the count stands.
insert into public.work_order (id, storage_area_id) values
  ('f0000000-0000-0000-57d0-0000000000c1', 'c8000000-0000-0000-57d0-000000000003');
insert into public.work_order_item (id, work_order_id, item_id, qty, transaction_date) values
  ('f1000000-0000-0000-57d0-0000000000c1', 'f0000000-0000-0000-57d0-0000000000c1', 'c7000000-0000-0000-57d0-000000000001',
   3, now() - interval '2 days');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000003'), 8::numeric,
  'a movement dated before a stock take leaves the counted stock alone');
select is((select adjustment_qty from public.stock_take_item where id = 'a1000000-0000-0000-57d0-0000000000c1'), 1::numeric,
  'the stock take''s adjustment is re-worked instead (8 counted against 7)');

-- A second, later stock take follows the first.
insert into public.stock_take (id, take_date, storage_area_id) values
  ('a0000000-0000-0000-57d0-0000000000c2', now() - interval '1 hour', 'c8000000-0000-0000-57d0-000000000003');
insert into public.stock_take_item (id, stock_take_id, item_id, counted_qty) values
  ('a1000000-0000-0000-57d0-0000000000c2', 'a0000000-0000-0000-57d0-0000000000c2', 'c7000000-0000-0000-57d0-000000000001', 6);
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000003'), 6::numeric, 'second count: stock is 6');
update public.work_order_item set qty = 5 where id = 'f1000000-0000-0000-57d0-0000000000c1';
select is(
  (select array_agg(adjustment_qty order by id) from public.stock_take_item
    where id in ('a1000000-0000-0000-57d0-0000000000c1', 'a1000000-0000-0000-57d0-0000000000c2')),
  array[3, -2]::numeric[], 'changing the early movement re-works the first take; the second still closes on its count');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000003'), 6::numeric, 'stock still equals the latest count');

-- Changing the first count carries through to the second take's adjustment.
update public.stock_take_item set counted_qty = 9 where id = 'a1000000-0000-0000-57d0-0000000000c1';
select is((select adjustment_qty from public.stock_take_item where id = 'a1000000-0000-0000-57d0-0000000000c2'), -3::numeric,
  'a changed earlier count re-works the later take');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000003'), 6::numeric, 'and stock still equals the latest count');

delete from public.work_order_item where id = 'f1000000-0000-0000-57d0-0000000000c1';
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000003'), 6::numeric,
  'deleting the early movement leaves the counted stock alone');
select is((select adjustment_qty from public.stock_take_item where id = 'a1000000-0000-0000-57d0-0000000000c1'), -1::numeric,
  'and the first take is re-worked (9 counted against 10)');
select is(pg_temp.rows('STOCK_ADJUSTMENT'), 3::bigint, 'one adjustment row per counted line');

-- Base quantities follow the item's pack size.
select is(pg_temp.base('c8000000-0000-0000-57d0-000000000003'), 30::numeric, '6 packs of 5 = 30 base units');
update public.pack_type set qty = 20 where id = 'c3000000-0000-0000-57d0-000000000001';
select is(pg_temp.base('c8000000-0000-0000-57d0-000000000003'), 120::numeric, 'a new pack size re-works the ledger''s base quantities');
select is((select count(*) from public.intake_item ii join public.item i on i.id = ii.item_id
            where ii.base_qty <> ii.qty * i.conversion_to_default_uom), 0::bigint, 'receipt lines follow too');
select is((select count(*) from public.purchase_order_item pi join public.item i on i.id = pi.item_id
            where pi.base_qty <> pi.qty_ordered * i.conversion_to_default_uom), 0::bigint, 'purchase order lines follow too');
update public.pack_type set qty = 5 where id = 'c3000000-0000-0000-57d0-000000000001';
select is(pg_temp.base('c8000000-0000-0000-57d0-000000000003'), 30::numeric, 'and back again');

-- The role checks below pick "any other" document: leave none of these behind.
delete from public.work_order where storage_area_id = 'c8000000-0000-0000-57d0-000000000003';
delete from public.stock_take where storage_area_id = 'c8000000-0000-0000-57d0-000000000003';
delete from public.transfer_main where to_storage_area_id = 'c8000000-0000-0000-57d0-000000000003';

-- ============================================================================
-- Roles
-- ============================================================================
create role m_probe_dummy;
drop role m_probe_dummy;
grant usage on schema extensions to authenticated;
create function pg_temp.try(p_sql text)
returns text
language plpgsql
as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n::text;
exception when others then
  return sqlstate;
end;
$$;
grant execute on function pg_temp.try(text) to authenticated;
grant execute on function pg_temp.stock(text) to authenticated;

select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-57d0-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select is(pg_temp.try($$ insert into public.item_transaction (transaction_type, qty, base_qty, item_id, storage_area_id, intake_item_id)
  values ('STOCK_ADJUSTMENT', 1, 5, 'c7000000-0000-0000-57d0-000000000001', 'c8000000-0000-0000-57d0-000000000001',
  'd4000000-0000-0000-57d0-000000000001') $$), '42501', 'user cannot write the ledger directly');
select is((select count(*) from public.item_transaction) > 0, true, 'user can read the ledger');
select is(pg_temp.try($$ insert into public.purchase_order (supplier_id) values ('c5000000-0000-0000-57d0-000000000002') $$),
  '42501', 'user cannot create a purchase order');
select is(pg_temp.try($$ update public.purchase_order set comment = 'x' $$), '2', 'user can edit a purchase order');
select is(pg_temp.try($$ insert into public.purchase_order_item (purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, eta)
  values ('d0000000-0000-0000-57d0-000000000002', 'c7000000-0000-0000-57d0-000000000001', 1, 10, current_date) $$),
  '42501', 'user cannot add a purchase order line');
select is(pg_temp.try($$ update public.purchase_order_item set eta = current_date $$), '2', 'user can edit purchase order lines');
select is(pg_temp.try($$ insert into public.load default values $$), '42501', 'user cannot create a load');
select is((select count(*) from public.stock_document), 0::bigint, 'user sees no documents');
select is(pg_temp.try($$ insert into public.transfer_main (transfer_type, from_storage_area_id)
  values ('SEND', 'c8000000-0000-0000-57d0-000000000001') $$), '1', 'user can create a transfer');
select is(pg_temp.try($$ delete from public.transfer_main $$), '0', 'user cannot delete a transfer');
select is(pg_temp.try($$ insert into public.work_order (storage_area_id) values ('c8000000-0000-0000-57d0-000000000001') $$),
  '1', 'user can create a work order');
select is(pg_temp.try($$ insert into public.stock_take (storage_area_id) values ('c8000000-0000-0000-57d0-000000000001') $$),
  '1', 'user can create a stock take');
select is(pg_temp.try($$ delete from public.stock_take $$), '0', 'user cannot delete a stock take');

select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-57d0-000000000002", "role": "authenticated"}', true);
select is(pg_temp.try($$ insert into public.purchase_order (supplier_id) values ('c5000000-0000-0000-57d0-000000000002') $$),
  '1', 'admin can create a purchase order');
select is(pg_temp.try($$ insert into public.load default values $$), '42501', 'admin cannot receive stock');

select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-57d0-000000000003", "role": "authenticated"}', true);
select is((select count(*) from public.work_order) > 0, true, 'viewer can read work orders');
select is((select count(*) from public.transfer_main), 0::bigint, 'viewer cannot see transfers');
select is(pg_temp.try($$ update public.work_order set comment = 'x' $$), '0', 'viewer cannot edit a work order');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 12::numeric, 'viewer can read stock on hand');

select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-57d0-000000000004", "role": "authenticated"}', true);
select is(pg_temp.try($$ insert into public.load default values $$), '1', 'system_admin can create a load');

-- Posting works through the real roles (the triggers run as the table owner).
select is(pg_temp.try($$ insert into public.intake_item (intake_id, item_id, purchase_order_item_id, qty)
  values ('d3000000-0000-0000-57d0-000000000001', 'c7000000-0000-0000-57d0-000000000001', 'd1000000-0000-0000-57d0-000000000002', 2) $$),
  '1', 'system_admin can receive a PO line');
select is((select qty from public.storage_area_item_stock where item_id = 'c7000000-0000-0000-57d0-000000000002'
            and storage_area_id = 'c8000000-0000-0000-57d0-000000000001'), 2::numeric, 'the receipt posted to the ledger');
select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-57d0-000000000001", "role": "authenticated"}', true);
select is(pg_temp.try($$ insert into public.transfer_item (transfer_id, item_id, qty)
  select id, 'c7000000-0000-0000-57d0-000000000001', 1 from public.transfer_main
   where transfer_type = 'SEND' $$), '1', 'user can add a transfer line');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 11::numeric, 'user''s transfer line posted to the ledger');
select is(pg_temp.try($$ insert into public.work_order_item (work_order_id, item_id, qty, transaction_date)
  select id, 'c7000000-0000-0000-57d0-000000000001', 1, now() from public.work_order
   where id <> 'f0000000-0000-0000-57d0-000000000001' limit 1 $$), '1', 'user can add a work order line');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 10::numeric, 'user''s usage posted to the ledger');
select is(pg_temp.try($$ insert into public.stock_take_item (stock_take_id, item_id, counted_qty)
  select id, 'c7000000-0000-0000-57d0-000000000001', 20 from public.stock_take
   where id <> 'a0000000-0000-0000-57d0-000000000001' limit 1 $$), '1', 'user can add a stock take line');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 20::numeric, 'user''s count posted to the ledger');

-- Editing a line runs the line triggers' WHEN clause as the user.
select isnt(pg_temp.try($$ update public.transfer_item set qty = qty $$), '42501', 'user can edit a transfer line');
select isnt(pg_temp.try($$ update public.work_order_item set qty = qty $$), '42501', 'user can edit a work order line');
select isnt(pg_temp.try($$ update public.stock_take_item set counted_qty = counted_qty $$), '42501', 'user can edit a stock take line');
select is(pg_temp.stock('c8000000-0000-0000-57d0-000000000001'), 20::numeric, 'those edits changed no stock');

select * from finish();
rollback;
