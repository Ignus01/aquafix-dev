-- Tests for 20261119130000_stock_kits_and_on_hand.sql: one kit per
-- technician, and storage_area_stock always equal to the ledger's sum.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('30000000-0000-0000-6b17-000000000001', '00000000-0000-0000-6b17-000000000000', 'authenticated', 'authenticated',
   'k-tech@example.test', '', now(), now(), now()),
  ('30000000-0000-0000-6b17-000000000002', '00000000-0000-0000-6b17-000000000000', 'authenticated', 'authenticated',
   'k-viewer@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('30000000-0000-0000-6b17-000000000001', 'user'),
  ('30000000-0000-0000-6b17-000000000002', 'viewer');

insert into public.unit_of_measure (id, code, name, uom_type) values ('a0000000-0000-0000-6b17-000000000001', 'KTAB', 'K Tablet', 'NODIM');
insert into public.product_type (id, code, name) values ('a1000000-0000-0000-6b17-000000000001', 'KREAG', 'K Reagent');
insert into public.product (id, code, name, product_type_id, uom_id) values
  ('a2000000-0000-0000-6b17-000000000001', 'KDPD1', 'KDPD1', 'a1000000-0000-0000-6b17-000000000001', 'a0000000-0000-0000-6b17-000000000001');
insert into public.pack_type (id, name, qty, uom_id) values
  ('a3000000-0000-0000-6b17-000000000001', 'K pack of 100', 100, 'a0000000-0000-0000-6b17-000000000001');
insert into public.item (id, name, product_id, pack_type_id) values
  ('a7000000-0000-0000-6b17-000000000001', 'K DPD1', 'a2000000-0000-0000-6b17-000000000001', 'a3000000-0000-0000-6b17-000000000001');
insert into public.region (id, name) values ('a4000000-0000-0000-6b17-000000000001', 'K-Region');
insert into public.organisation (id, name, is_supplier) values
  ('a5000000-0000-0000-6b17-000000000001', 'K-ORG', false),
  ('a5000000-0000-0000-6b17-000000000002', 'K-SUPPLIER', true);
insert into public.location (id, name, region_id, organisation_id) values
  ('a6000000-0000-0000-6b17-000000000001', 'K-Base', 'a4000000-0000-0000-6b17-000000000001', 'a5000000-0000-0000-6b17-000000000001');
insert into public.storage_area (id, code, name, location_id, technician_user_id) values
  ('a8000000-0000-0000-6b17-000000000001', 'K-STORE', 'K store', 'a6000000-0000-0000-6b17-000000000001', null),
  ('a8000000-0000-0000-6b17-000000000002', 'K-KIT', 'K kit', 'a6000000-0000-0000-6b17-000000000001', '30000000-0000-0000-6b17-000000000001');

-- ============================================================================
-- Kits
-- ============================================================================
select throws_ok($$ insert into public.storage_area (code, name, location_id, technician_user_id) values
  ('K-KIT2', 'K kit 2', 'a6000000-0000-0000-6b17-000000000001', '30000000-0000-0000-6b17-000000000001') $$,
  '23505', null, 'a technician has one kit');
select lives_ok($$ insert into public.storage_area (code, name, location_id) values
  ('K-STORE2', 'K store 2', 'a6000000-0000-0000-6b17-000000000001') $$, 'any number of stores have no technician');

-- ============================================================================
-- On hand follows the ledger
-- ============================================================================
create function pg_temp.matches() returns boolean language sql as $$
  select not exists (
    select item_id, storage_area_id, qty, base_qty from public.storage_area_item_stock
    except
    select item_id, storage_area_id, qty, base_qty from public.storage_area_stock
  ) and not exists (
    select item_id, storage_area_id, qty, base_qty from public.storage_area_stock where qty <> 0 or base_qty <> 0
    except
    select item_id, storage_area_id, qty, base_qty from public.storage_area_item_stock
  );
$$;
create function pg_temp.on_hand(p_area text) returns numeric language sql as $$
  select coalesce((select qty from public.storage_area_stock
                    where item_id = 'a7000000-0000-0000-6b17-000000000001' and storage_area_id = p_area::uuid), 0);
$$;
grant execute on function pg_temp.matches() to authenticated;
grant execute on function pg_temp.on_hand(text) to authenticated;

insert into public.purchase_order (id, supplier_id) values ('b0000000-0000-0000-6b17-000000000001', 'a5000000-0000-0000-6b17-000000000002');
insert into public.purchase_order_item (id, purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, eta) values
  ('b1000000-0000-0000-6b17-000000000001', 'b0000000-0000-0000-6b17-000000000001', 'a7000000-0000-0000-6b17-000000000001', 5, 90, current_date);

select set_config('request.jwt.claims', '{"sub": "30000000-0000-0000-6b17-000000000001", "role": "authenticated"}', true);
set local role authenticated;

-- Collected straight into the technician's kit.
select lives_ok($$ select public.receive_purchase_order(jsonb_build_object(
    'purchase_order_id', 'b0000000-0000-0000-6b17-000000000001',
    'storage_area_id', 'a8000000-0000-0000-6b17-000000000002',
    'lines', jsonb_build_array(jsonb_build_object('purchase_order_item_id', 'b1000000-0000-0000-6b17-000000000001', 'qty', 5)))) $$,
  'collected into the kit');
select is(pg_temp.on_hand('a8000000-0000-0000-6b17-000000000002'), 5::numeric, 'the kit has 5');
select is((select base_qty from public.storage_area_stock where storage_area_id = 'a8000000-0000-0000-6b17-000000000002'),
  500::numeric, 'in tablets too');

select lives_ok($$ select public.save_stock_document(jsonb_build_object('kind', 'transfers',
    'header', jsonb_build_object('transfer_type', 'BOTH', 'from_storage_area_id', 'a8000000-0000-0000-6b17-000000000002',
      'to_storage_area_id', 'a8000000-0000-0000-6b17-000000000001'),
    'lines', jsonb_build_array(jsonb_build_object('item_id', 'a7000000-0000-0000-6b17-000000000001', 'qty', 2)))) $$,
  'a transfer out of the kit');
select is(pg_temp.on_hand('a8000000-0000-0000-6b17-000000000002'), 3::numeric, 'kit 3 after the transfer');
select is(pg_temp.on_hand('a8000000-0000-0000-6b17-000000000001'), 2::numeric, 'store 2');

select lives_ok($$ select public.save_stock_document(jsonb_build_object('kind', 'work-orders',
    'header', jsonb_build_object('storage_area_id', 'a8000000-0000-0000-6b17-000000000002'),
    'lines', jsonb_build_array(jsonb_build_object('item_id', 'a7000000-0000-0000-6b17-000000000001', 'qty', 1)))) $$,
  'usage from the kit');
select lives_ok($$ select public.save_stock_document(jsonb_build_object('kind', 'stock-takes',
    'header', jsonb_build_object('storage_area_id', 'a8000000-0000-0000-6b17-000000000001'),
    'lines', jsonb_build_array(jsonb_build_object('item_id', 'a7000000-0000-0000-6b17-000000000001', 'counted_qty', 1)))) $$,
  'a stock take of the store');
select is(pg_temp.on_hand('a8000000-0000-0000-6b17-000000000002'), 2::numeric, 'kit 2 after usage');
select is(pg_temp.on_hand('a8000000-0000-0000-6b17-000000000001'), 1::numeric, 'store 1 after the count');
select ok(pg_temp.matches(), 'on hand equals the ledger''s sum');

select is((select count(*) from public.storage_area_stock), 2::bigint, 'a technician reads stock on hand');

select set_config('request.jwt.claims', '{"sub": "30000000-0000-0000-6b17-000000000002", "role": "authenticated"}', true);
select is((select count(*) from public.storage_area_stock), 2::bigint, 'so does a viewer');
select throws_ok($$ update public.storage_area_stock set qty = 99 $$, '42501', null, 'nobody writes it directly');

-- Edits and deletes of documents move it back.
reset role;
update public.work_order_item set qty = 2;
select is(pg_temp.on_hand('a8000000-0000-0000-6b17-000000000002'), 1::numeric, 'editing a usage line follows');
delete from public.work_order;
select is(pg_temp.on_hand('a8000000-0000-0000-6b17-000000000002'), 3::numeric, 'deleting the work order gives it back');
select ok(pg_temp.matches(), 'still equal to the ledger''s sum');

select * from finish();
rollback;
