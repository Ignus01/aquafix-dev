-- Tests for the MWTS stock rollout (20261119120000_stock_mwts_rollout.sql):
-- receive_purchase_order (R1/R3), relaxed fields (R2), collection fields
-- (R3) and the site on work orders (R4).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup (superuser: no RLS)
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('20000000-0000-0000-3a75-000000000001', '00000000-0000-0000-3a75-000000000000', 'authenticated', 'authenticated',
   'r-tech@example.test', '', now(), now(), now()),
  ('20000000-0000-0000-3a75-000000000002', '00000000-0000-0000-3a75-000000000000', 'authenticated', 'authenticated',
   'r-admin@example.test', '', now(), now(), now()),
  ('20000000-0000-0000-3a75-000000000003', '00000000-0000-0000-3a75-000000000000', 'authenticated', 'authenticated',
   'r-viewer@example.test', '', now(), now(), now());
insert into public.profiles (id, username) values ('20000000-0000-0000-3a75-000000000001', 'R Jonifas');
insert into public.user_masterdata_roles (user_id, role) values
  ('20000000-0000-0000-3a75-000000000001', 'user'),
  ('20000000-0000-0000-3a75-000000000002', 'admin'),
  ('20000000-0000-0000-3a75-000000000003', 'viewer');

insert into public.unit_of_measure (id, code, name, uom_type) values
  ('e0000000-0000-0000-3a75-000000000001', 'RKG', 'R Kilogram', 'MASS');
insert into public.product_type (id, code, name) values ('e1000000-0000-0000-3a75-000000000001', 'RSALT', 'R Salt');
insert into public.product (id, code, name, product_type_id, uom_id) values
  ('e2000000-0000-0000-3a75-000000000001', 'RSALT', 'RSALT', 'e1000000-0000-0000-3a75-000000000001', 'e0000000-0000-0000-3a75-000000000001');
insert into public.pack_type (id, name, qty, uom_id) values
  ('e3000000-0000-0000-3a75-000000000001', 'R 25 kg bag', 25, 'e0000000-0000-0000-3a75-000000000001'),
  ('e3000000-0000-0000-3a75-000000000002', 'R 50 kg bag', 50, 'e0000000-0000-0000-3a75-000000000001');
insert into public.item (id, name, product_id, pack_type_id) values
  ('e7000000-0000-0000-3a75-000000000001', 'R salt 25', 'e2000000-0000-0000-3a75-000000000001', 'e3000000-0000-0000-3a75-000000000001'),
  ('e7000000-0000-0000-3a75-000000000002', 'R salt 50', 'e2000000-0000-0000-3a75-000000000001', 'e3000000-0000-0000-3a75-000000000002');

insert into public.region (id, name) values ('e4000000-0000-0000-3a75-000000000001', 'R-Region');
insert into public.organisation (id, name, is_supplier) values
  ('e5000000-0000-0000-3a75-000000000001', 'R-ORG', false),
  ('e5000000-0000-0000-3a75-000000000002', 'R-SUPPLIER', true);
insert into public.location (id, name, region_id, organisation_id) values
  ('e6000000-0000-0000-3a75-000000000001', 'R-WPS', 'e4000000-0000-0000-3a75-000000000001', 'e5000000-0000-0000-3a75-000000000001'),
  ('e6000000-0000-0000-3a75-000000000002', 'R-Selby', 'e4000000-0000-0000-3a75-000000000001', 'e5000000-0000-0000-3a75-000000000001'),
  ('e6000000-0000-0000-3a75-000000000003', 'R-Other', 'e4000000-0000-0000-3a75-000000000001', 'e5000000-0000-0000-3a75-000000000001');
insert into public.storage_area (id, code, name, location_id) values
  ('e8000000-0000-0000-3a75-000000000001', 'R-WPS-STORE', 'R WPS store', 'e6000000-0000-0000-3a75-000000000001'),
  ('e8000000-0000-0000-3a75-000000000002', 'R-MWTS-STORE', 'R MWTS store', 'e6000000-0000-0000-3a75-000000000001');

-- PO with two lines; Deliver to = WPS store.
insert into public.purchase_order (id, supplier_id, deliver_to_area_id) values
  ('f0000000-0000-0000-3a75-000000000001', 'e5000000-0000-0000-3a75-000000000002', 'e8000000-0000-0000-3a75-000000000001');
insert into public.purchase_order_item (id, purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, eta) values
  ('f1000000-0000-0000-3a75-000000000001', 'f0000000-0000-0000-3a75-000000000001', 'e7000000-0000-0000-3a75-000000000001', 10, 212, current_date),
  ('f1000000-0000-0000-3a75-000000000002', 'f0000000-0000-0000-3a75-000000000001', 'e7000000-0000-0000-3a75-000000000002', 2, 300, current_date);
-- A second PO, to try receiving its line against the first.
insert into public.purchase_order (id, supplier_id) values
  ('f0000000-0000-0000-3a75-000000000002', 'e5000000-0000-0000-3a75-000000000002');
insert into public.purchase_order_item (id, purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, eta) values
  ('f1000000-0000-0000-3a75-000000000003', 'f0000000-0000-0000-3a75-000000000002', 'e7000000-0000-0000-3a75-000000000001', 1, 212, current_date);

-- R4 fixtures: a service and an incident at Selby.
insert into public.asset_type (id, name) values ('e9000000-0000-0000-3a75-000000000001', 'R softener');
insert into public.asset (id, name, code, asset_type_id, location_id) values
  ('ea000000-0000-0000-3a75-000000000001', 'R softener 1', 'R-SOFT-1', 'e9000000-0000-0000-3a75-000000000001', 'e6000000-0000-0000-3a75-000000000002');
insert into public.service (id, service_type, due_date, asset_id) values
  ('eb000000-0000-0000-3a75-000000000001', 'repair', now(), 'ea000000-0000-0000-3a75-000000000001');
insert into public.incident_type (id, name) values ('ec000000-0000-0000-3a75-000000000001', 'R low salt');
insert into public.incident (id, comment, location_id, incident_type_id) values
  ('ed000000-0000-0000-3a75-000000000001', 'R low', 'e6000000-0000-0000-3a75-000000000002', 'ec000000-0000-0000-3a75-000000000001');

create function pg_temp.stock(p_item text, p_area text) returns numeric language sql as $$
  select coalesce((select qty from public.storage_area_item_stock
                    where item_id = p_item::uuid and storage_area_id = p_area::uuid), 0);
$$;
create function pg_temp.line(p_id text) returns public.purchase_order_item language sql as $$
  select * from public.purchase_order_item where id = p_id::uuid;
$$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n::text;
exception when others then
  return sqlstate;
end;
$$;
create table pg_temp.r (name text primary key, result jsonb);
grant all on pg_temp.r to authenticated;
grant execute on function pg_temp.stock(text, text) to authenticated;
grant execute on function pg_temp.line(text) to authenticated;
grant execute on function pg_temp.try(text) to authenticated;

-- ============================================================================
-- R3 · collection fields
-- ============================================================================
select throws_ok($$ update public.purchase_order set collect_from = 'STORAGE_AREA'
                     where id = 'f0000000-0000-0000-3a75-000000000001' $$,
  '23514', null, 'collecting from a storage area needs the area');
select throws_ok($$ update public.purchase_order set collect_from = 'VAN'
                     where id = 'f0000000-0000-0000-3a75-000000000001' $$,
  '23514', null, 'collect from is supplier or a storage area');
update public.purchase_order set collector_user_id = '20000000-0000-0000-3a75-000000000001', collect_from = 'SUPPLIER'
 where id = 'f0000000-0000-0000-3a75-000000000001';

-- ============================================================================
-- R1/R3 · receive_purchase_order as a technician (role user)
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub": "20000000-0000-0000-3a75-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select ok(exists (select 1 from public.list_stock_collectors() where id = '20000000-0000-0000-3a75-000000000001'
                   and name = 'R Jonifas'), 'a technician is offered as a collector, by name');
select ok(not exists (select 1 from public.list_stock_collectors() where id = '20000000-0000-0000-3a75-000000000003'),
  'a viewer is not');

select throws_ok($$ select public.receive_purchase_order(jsonb_build_object(
    'purchase_order_id', 'f0000000-0000-0000-3a75-000000000001',
    'lines', jsonb_build_array(jsonb_build_object('purchase_order_item_id', 'f1000000-0000-0000-3a75-000000000001', 'qty', 0)))) $$,
  'P0001', 'Enter a quantity for at least one line.', 'nothing received is refused');
select throws_ok($$ select public.receive_purchase_order(jsonb_build_object(
    'purchase_order_id', 'f0000000-0000-0000-3a75-000000000001',
    'lines', jsonb_build_array(jsonb_build_object('purchase_order_item_id', 'f1000000-0000-0000-3a75-000000000003', 'qty', 1)))) $$,
  'P0001', 'Line 1 is not on this purchase order.', 'a line from another order is refused');
select throws_ok($$ select public.receive_purchase_order(jsonb_build_object(
    'purchase_order_id', 'f0000000-0000-0000-3a75-000000000001',
    'lines', jsonb_build_array(jsonb_build_object('purchase_order_item_id', 'f1000000-0000-0000-3a75-000000000001', 'qty', -1)))) $$,
  'P0001', 'Line 1: Qty can''t be negative.', 'a negative qty is refused');
select throws_ok($$ select public.receive_purchase_order(jsonb_build_object(
    'purchase_order_id', 'f0000000-0000-0000-3a75-000000000002',
    'lines', jsonb_build_array(jsonb_build_object('purchase_order_item_id', 'f1000000-0000-0000-3a75-000000000003', 'qty', 1)))) $$,
  'P0001', 'Choose the storage area it goes into.', 'an order with no Deliver to needs an area');

-- Script A step 2: Collected with 8 of 10 (only PO, area, date and qty: R2).
insert into pg_temp.r values ('A2 payload', jsonb_build_object(
  'command_id', 'f9000000-0000-0000-3a75-000000000001',
  'captured_at', now() - interval '1 hour',
  'purchase_order_id', 'f0000000-0000-0000-3a75-000000000001',
  'intake_id', 'f8000000-0000-0000-3a75-000000000001',
  'lines', jsonb_build_array(
    jsonb_build_object('purchase_order_item_id', 'f1000000-0000-0000-3a75-000000000001', 'qty', 8),
    jsonb_build_object('purchase_order_item_id', 'f1000000-0000-0000-3a75-000000000002', 'qty', 0))));
insert into pg_temp.r values ('A2', public.receive_purchase_order((select result from pg_temp.r where name = 'A2 payload')));

select is(pg_temp.stock('e7000000-0000-0000-3a75-000000000001', 'e8000000-0000-0000-3a75-000000000001'), 8::numeric,
  'WPS store (the order''s Deliver to) shows 8');
select is((pg_temp.line('f1000000-0000-0000-3a75-000000000001')).qty_outstanding, 2::numeric, 'the line shows 2 outstanding');
select is((select status::text from public.purchase_order where id = 'f0000000-0000-0000-3a75-000000000001'), 'new',
  'the order stays open');
select is((select result ->> 'purchase_order_status' from pg_temp.r where name = 'A2'), 'new', 'the result says so too');
select is((select count(*) from public.intake_item where intake_id = 'f8000000-0000-0000-3a75-000000000001'), 1::bigint,
  'a line with qty 0 is not received');
select is((select driver from public.load l join public.intake i on i.load_id = l.id
            where i.id = 'f8000000-0000-0000-3a75-000000000001'), 'R Jonifas', 'the driver defaults to the collector');
select is((select transaction_type::text from public.item_transaction t join public.intake_item ii on ii.id = t.intake_item_id
            where ii.intake_id = 'f8000000-0000-0000-3a75-000000000001'), 'INTAKE_PURCHASE_ORDER', 'it posts as a PO intake');

-- Offline resend: same command, same result, nothing received twice.
insert into pg_temp.r values ('A2 resend', public.receive_purchase_order((select result from pg_temp.r where name = 'A2 payload')));
select is((select result from pg_temp.r where name = 'A2 resend'), (select result from pg_temp.r where name = 'A2'),
  'a resend returns the first result');
select is((select count(*) from public.intake where purchase_order_id = 'f0000000-0000-0000-3a75-000000000001'), 1::bigint,
  'and makes no second intake');
select is(pg_temp.stock('e7000000-0000-0000-3a75-000000000001', 'e8000000-0000-0000-3a75-000000000001'), 8::numeric,
  'stock is unchanged by the resend');

-- Script A step 3: the invoice number added afterwards posts nothing.
select is(pg_temp.try($$ update public.intake set invoice_number = 'INV-1604'
                          where id = 'f8000000-0000-0000-3a75-000000000001' $$), '1', 'a technician can add the invoice number later');
select is(pg_temp.stock('e7000000-0000-0000-3a75-000000000001', 'e8000000-0000-0000-3a75-000000000001'), 8::numeric,
  'adding it reverses nothing');
select is(pg_temp.try($$ delete from public.intake where id = 'f8000000-0000-0000-3a75-000000000001' $$), '0',
  'a technician can''t delete an intake');

-- The rest, into another area: the order completes.
select lives_ok($$ select public.receive_purchase_order(jsonb_build_object(
    'purchase_order_id', 'f0000000-0000-0000-3a75-000000000001',
    'storage_area_id', 'e8000000-0000-0000-3a75-000000000002',
    'delivery_note', 'DN-77', 'vehicle_reg_nr', 'ABC 123 GP', 'driver', 'Courier',
    'lines', jsonb_build_array(
      jsonb_build_object('purchase_order_item_id', 'f1000000-0000-0000-3a75-000000000001', 'qty', 2),
      jsonb_build_object('purchase_order_item_id', 'f1000000-0000-0000-3a75-000000000002', 'qty', 2)))) $$,
  'the rest is received into another storage area');
select is((select status::text from public.purchase_order where id = 'f0000000-0000-0000-3a75-000000000001'), 'completed',
  'nothing outstanding: the order is completed');
select is((select driver from public.load where vehicle_reg_nr = 'ABC 123 GP'), 'Courier', 'a driver that is given is kept');
select is(pg_temp.stock('e7000000-0000-0000-3a75-000000000002', 'e8000000-0000-0000-3a75-000000000002'), 2::numeric,
  'the second line went into the chosen area');
select throws_ok($$ select public.receive_purchase_order(jsonb_build_object(
    'purchase_order_id', 'f0000000-0000-0000-3a75-000000000001',
    'lines', jsonb_build_array(jsonb_build_object('purchase_order_item_id', 'f1000000-0000-0000-3a75-000000000001', 'qty', 1)))) $$,
  'P0001', null, 'a completed order can''t be received again');

-- A plain PO intake from the web form also needs no delivery note or invoice (R2).
select is(pg_temp.try($$ insert into public.load default values $$), '1', 'a technician can create a load');
select is(pg_temp.try($$ insert into public.intake (load_id, storage_area_id, supplier_id, purchase_order_id)
  select id, 'e8000000-0000-0000-3a75-000000000001', 'e5000000-0000-0000-3a75-000000000002', 'f0000000-0000-0000-3a75-000000000002'
    from public.load where vehicle_reg_nr is null and driver = 'R Jonifas' order by reference desc limit 1 $$), '1',
  'an intake saves without a delivery note or invoice number');

-- ============================================================================
-- Viewer
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub": "20000000-0000-0000-3a75-000000000003", "role": "authenticated"}', true);
select throws_ok($$ select public.receive_purchase_order(jsonb_build_object(
    'purchase_order_id', 'f0000000-0000-0000-3a75-000000000002', 'storage_area_id', 'e8000000-0000-0000-3a75-000000000001',
    'lines', jsonb_build_array(jsonb_build_object('purchase_order_item_id', 'f1000000-0000-0000-3a75-000000000003', 'qty', 1)))) $$,
  '42501', null, 'a viewer can''t receive');

-- ============================================================================
-- Admin can delete what a technician received
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub": "20000000-0000-0000-3a75-000000000002", "role": "authenticated"}', true);
select is(pg_temp.try($$ delete from public.intake where purchase_order_id = 'f0000000-0000-0000-3a75-000000000002' $$), '1',
  'an admin can delete an intake');

-- ============================================================================
-- R4 · site on work orders
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub": "20000000-0000-0000-3a75-000000000001", "role": "authenticated"}', true);

-- Script A step 4: 4 × salt from WPS store at Selby, linked to the incident.
insert into pg_temp.r values ('WO', public.save_stock_document(jsonb_build_object(
  'kind', 'work-orders',
  'header', jsonb_build_object('id', 'fa000000-0000-0000-3a75-000000000001',
    'storage_area_id', 'e8000000-0000-0000-3a75-000000000001',
    'location_id', 'e6000000-0000-0000-3a75-000000000002',
    'incident_id', 'ed000000-0000-0000-3a75-000000000001'),
  'lines', jsonb_build_array(jsonb_build_object('item_id', 'e7000000-0000-0000-3a75-000000000001', 'qty', 4)))));
select is((select location_id from public.work_order where id = 'fa000000-0000-0000-3a75-000000000001'),
  'e6000000-0000-0000-3a75-000000000002'::uuid, 'the work order records the site');
select is(pg_temp.stock('e7000000-0000-0000-3a75-000000000001', 'e8000000-0000-0000-3a75-000000000001'), 4::numeric,
  'WPS store = 4 after using 4');
select is((select w.location_id from public.item_transaction t
             join public.work_order_item wi on wi.id = t.work_order_item_id
             join public.work_order w on w.id = wi.work_order_id
            where w.id = 'fa000000-0000-0000-3a75-000000000001'), 'e6000000-0000-0000-3a75-000000000002'::uuid,
  'the usage row leads to the site');

select throws_ok($$ insert into public.work_order (storage_area_id, location_id, service_id) values
  ('e8000000-0000-0000-3a75-000000000001', 'e6000000-0000-0000-3a75-000000000003', 'eb000000-0000-0000-3a75-000000000001') $$,
  'P0001', 'That service is not at this site.', 'a service must be at the site');
select throws_ok($$ insert into public.work_order (storage_area_id, location_id, incident_id) values
  ('e8000000-0000-0000-3a75-000000000001', 'e6000000-0000-0000-3a75-000000000003', 'ed000000-0000-0000-3a75-000000000001') $$,
  'P0001', 'That incident is not at this site.', 'an incident must be at the site');
select throws_ok($$ insert into public.work_order (storage_area_id, service_id) values
  ('e8000000-0000-0000-3a75-000000000001', 'eb000000-0000-0000-3a75-000000000001') $$,
  'P0001', 'Choose the site before linking a service or incident.', 'a link needs a site');
select is(pg_temp.try($$ insert into public.work_order (storage_area_id, location_id, service_id) values
  ('e8000000-0000-0000-3a75-000000000001', 'e6000000-0000-0000-3a75-000000000002', 'eb000000-0000-0000-3a75-000000000001') $$),
  '1', 'a service at the site can be linked');
select is(pg_temp.try($$ insert into public.work_order (storage_area_id) values ('e8000000-0000-0000-3a75-000000000001') $$),
  '1', 'a work order without a site still saves (older phones)');

select * from finish();
rollback;
