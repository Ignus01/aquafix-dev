-- Tests for stock masterdata (spec: AquaFix Stock Masterdata Spec): derived
-- codes and conversion factors (including keeping them fresh), mirrored
-- conversions, default supplier, uniqueness, delete behaviour and roles.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-57c0-000000000001', '00000000-0000-0000-57c0-000000000000', 'authenticated', 'authenticated',
   'k-user@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-57c0-000000000002', '00000000-0000-0000-57c0-000000000000', 'authenticated', 'authenticated',
   'k-admin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-57c0-000000000003', '00000000-0000-0000-57c0-000000000000', 'authenticated', 'authenticated',
   'k-viewer@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-57c0-000000000001', 'user'),
  ('10000000-0000-0000-57c0-000000000002', 'admin'),
  ('10000000-0000-0000-57c0-000000000003', 'viewer');

insert into public.unit_of_measure (id, code, name, uom_type) values
  ('b0000000-0000-0000-57c0-000000000001', 'L', 'Litre', 'VOLUME'),
  ('b0000000-0000-0000-57c0-000000000002', 'ML', 'Millilitre', 'VOLUME'),
  ('b0000000-0000-0000-57c0-000000000003', 'KG', 'Kilogram', 'MASS');
insert into public.product_type (id, code, name) values
  ('b1000000-0000-0000-57c0-000000000001', 'CHEM', 'Chemicals');
insert into public.product (id, code, name, product_type_id, uom_id) values
  ('b2000000-0000-0000-57c0-000000000001', 'chlor', 'chlorine', 'b1000000-0000-0000-57c0-000000000001', 'b0000000-0000-0000-57c0-000000000001');
insert into public.product (id, code, name, product_type_id, uom_id) values
  ('b2000000-0000-0000-57c0-000000000002', 'ALUM', 'alum', 'b1000000-0000-0000-57c0-000000000001', 'b0000000-0000-0000-57c0-000000000001');
insert into public.pack_type (id, name, qty, uom_id) values
  ('b3000000-0000-0000-57c0-000000000001', '5 Litre Drum', 5, 'b0000000-0000-0000-57c0-000000000001'),
  ('b3000000-0000-0000-57c0-000000000002', '500 ml Bottle', 500, 'b0000000-0000-0000-57c0-000000000002'),
  ('b3000000-0000-0000-57c0-000000000003', '1 kg Bag', 1, 'b0000000-0000-0000-57c0-000000000003');

insert into public.region (id, name) values ('b4000000-0000-0000-57c0-000000000001', 'K-North');
insert into public.organisation (id, name, is_supplier) values
  ('b5000000-0000-0000-57c0-000000000001', 'K-ORG', false),
  ('b5000000-0000-0000-57c0-000000000002', 'K-SUPPLIER-1', true),
  ('b5000000-0000-0000-57c0-000000000003', 'K-SUPPLIER-2', true);
insert into public.location (id, name, region_id, organisation_id) values
  ('b6000000-0000-0000-57c0-000000000001', 'K-Plant', 'b4000000-0000-0000-57c0-000000000001', 'b5000000-0000-0000-57c0-000000000001');

-- ============================================================================
-- Derived values
-- ============================================================================
select is((select code from public.product where id = 'b2000000-0000-0000-57c0-000000000001'), 'CHLOR', 'product code forced to upper case');
select is((select name from public.product where id = 'b2000000-0000-0000-57c0-000000000001'), 'CHLORINE', 'product name forced to upper case');
select is((select code from public.pack_type where id = 'b3000000-0000-0000-57c0-000000000001'), '5 L', 'pack type code is qty + uom code');

insert into public.item (id, name, product_id, pack_type_id) values
  ('b7000000-0000-0000-57c0-000000000001', 'chlorine drum', 'b2000000-0000-0000-57c0-000000000001', 'b3000000-0000-0000-57c0-000000000001');
select is((select code from public.item where id = 'b7000000-0000-0000-57c0-000000000001'), 'CHLOR (5 L)', 'item code');
select is((select name from public.item where id = 'b7000000-0000-0000-57c0-000000000001'), 'CHLORINE DRUM', 'item name forced to upper case');
select is((select conversion_to_default_uom from public.item where id = 'b7000000-0000-0000-57c0-000000000001'), 5::numeric,
  'same unit: factor 1, so conversion is the pack qty');

-- No conversion ml -> L yet: blocked.
select throws_ok(
  $$ insert into public.item (name, product_id, pack_type_id) values ('bottle', 'b2000000-0000-0000-57c0-000000000001', 'b3000000-0000-0000-57c0-000000000002') $$,
  'P0001', 'There is no unit of measure conversion from ML to L. Add one under Unit Of Measure first.', 'item needs a conversion');

-- Once ml -> L exists, a pack in ml can be stocked.
insert into public.unit_of_measure_conversion (from_uom_id, to_uom_id, conversion)
values ('b0000000-0000-0000-57c0-000000000002', 'b0000000-0000-0000-57c0-000000000001', 0.001);

select is((select code from public.unit_of_measure_conversion where from_uom_id = 'b0000000-0000-0000-57c0-000000000002'), 'ML_TO_L', 'conversion code');
select is((select conversion from public.unit_of_measure_conversion
            where from_uom_id = 'b0000000-0000-0000-57c0-000000000001' and to_uom_id = 'b0000000-0000-0000-57c0-000000000002'),
  1000::numeric, 'saving ml -> L mirrors L -> ml with 1 / conversion');
select is((select code from public.unit_of_measure_conversion where from_uom_id = 'b0000000-0000-0000-57c0-000000000001'), 'L_TO_ML', 'mirror code');

insert into public.item (id, name, product_id, pack_type_id) values
  ('b7000000-0000-0000-57c0-000000000002', 'chlorine bottle', 'b2000000-0000-0000-57c0-000000000001', 'b3000000-0000-0000-57c0-000000000002');
select is((select conversion_to_default_uom from public.item where id = 'b7000000-0000-0000-57c0-000000000002'), 0.5::numeric,
  '500 ml = 0.5 L via the conversion');

-- ============================================================================
-- Stale values are refreshed (spec open questions)
-- ============================================================================
update public.unit_of_measure_conversion set conversion = 0.002
 where from_uom_id = 'b0000000-0000-0000-57c0-000000000002' and to_uom_id = 'b0000000-0000-0000-57c0-000000000001';
select is((select conversion_to_default_uom from public.item where id = 'b7000000-0000-0000-57c0-000000000002'), 1::numeric,
  'editing a conversion recalculates existing items');
select is((select conversion from public.unit_of_measure_conversion
            where from_uom_id = 'b0000000-0000-0000-57c0-000000000001'), 500::numeric, 'and the mirror follows');

update public.pack_type set qty = 250 where id = 'b3000000-0000-0000-57c0-000000000002';
select is((select conversion_to_default_uom from public.item where id = 'b7000000-0000-0000-57c0-000000000002'), 0.5::numeric,
  'editing a pack type qty recalculates existing items');
select is((select code from public.item where id = 'b7000000-0000-0000-57c0-000000000002'), 'CHLOR (250 ML)', 'and their code');

update public.product set code = 'cl2' where id = 'b2000000-0000-0000-57c0-000000000001';
select is((select code from public.item where id = 'b7000000-0000-0000-57c0-000000000001'), 'CL2 (5 L)', 'editing a product code refreshes item codes');

update public.unit_of_measure set code = 'LT' where id = 'b0000000-0000-0000-57c0-000000000001';
select is((select code from public.pack_type where id = 'b3000000-0000-0000-57c0-000000000001'), '5 LT', 'editing a uom code refreshes pack type codes');
select is((select code from public.item where id = 'b7000000-0000-0000-57c0-000000000001'), 'CL2 (5 LT)', 'and item codes');
select is((select code from public.unit_of_measure_conversion where from_uom_id = 'b0000000-0000-0000-57c0-000000000002'), 'ML_TO_LT', 'and conversion codes');

-- ============================================================================
-- Validation and uniqueness
-- ============================================================================
select throws_ok($$ insert into public.pack_type (name, qty, uom_id) values ('Zero', 0, 'b0000000-0000-0000-57c0-000000000001') $$,
  '23514', null, 'pack type qty must be > 0');
select throws_ok($$ insert into public.pack_type (name, qty, uom_id) values ('5 Litre Drum', 5, 'b0000000-0000-0000-57c0-000000000001') $$,
  '23505', null, 'pack type name unique');
select throws_ok($$ insert into public.product (code, name, product_type_id, uom_id) values ('CL2', 'OTHER', 'b1000000-0000-0000-57c0-000000000001', 'b0000000-0000-0000-57c0-000000000001') $$,
  '23505', null, 'product code unique (case-insensitively, via upper case)');
select throws_ok($$ insert into public.item (name, product_id, pack_type_id) values ('dupe', 'b2000000-0000-0000-57c0-000000000001', 'b3000000-0000-0000-57c0-000000000001') $$,
  '23505', null, 'product + pack type pair unique');
select throws_ok($$ insert into public.unit_of_measure_conversion (from_uom_id, to_uom_id, conversion) values ('b0000000-0000-0000-57c0-000000000001', 'b0000000-0000-0000-57c0-000000000001', 1) $$,
  '23514', null, 'cannot convert a unit to itself');
select throws_ok($$ insert into public.unit_of_measure_conversion (from_uom_id, to_uom_id, conversion) values ('b0000000-0000-0000-57c0-000000000003', 'b0000000-0000-0000-57c0-000000000001', 0) $$,
  '23514', null, 'conversion must be > 0');
select throws_ok($$ insert into public.supplier_item (item_id, supplier_id, default_lead_time, default_price_exc_vat)
  values ('b7000000-0000-0000-57c0-000000000001', 'b5000000-0000-0000-57c0-000000000002', 0, 10) $$, '23514', null, 'lead time must be > 0');
select throws_ok($$ insert into public.supplier_item (item_id, supplier_id, default_lead_time, default_price_exc_vat)
  values ('b7000000-0000-0000-57c0-000000000001', 'b5000000-0000-0000-57c0-000000000002', 2, 0) $$, '23514', null, 'price must be > 0');

-- ============================================================================
-- Suppliers: one default per item
-- ============================================================================
insert into public.supplier_item (id, item_id, supplier_id, default_lead_time, default_price_exc_vat, is_default) values
  ('b8000000-0000-0000-57c0-000000000001', 'b7000000-0000-0000-57c0-000000000001', 'b5000000-0000-0000-57c0-000000000002', 2, 10, true),
  ('b8000000-0000-0000-57c0-000000000002', 'b7000000-0000-0000-57c0-000000000001', 'b5000000-0000-0000-57c0-000000000003', 3, 12, false);
select throws_ok($$ insert into public.supplier_item (item_id, supplier_id, default_lead_time, default_price_exc_vat)
  values ('b7000000-0000-0000-57c0-000000000001', 'b5000000-0000-0000-57c0-000000000002', 2, 10) $$, '23505', null, 'one supplier item per supplier');
update public.supplier_item set is_default = true where id = 'b8000000-0000-0000-57c0-000000000002';
select is((select array_agg(id order by id) from public.supplier_item where is_default), array['b8000000-0000-0000-57c0-000000000002'::uuid],
  'setting a default clears the other');

-- ============================================================================
-- Deletes
-- ============================================================================
select throws_ok($$ delete from public.product where id = 'b2000000-0000-0000-57c0-000000000001' $$, '23503', null, 'product with items cannot be deleted');
select throws_ok($$ delete from public.pack_type where id = 'b3000000-0000-0000-57c0-000000000001' $$, '23503', null, 'pack type with items cannot be deleted');
select throws_ok($$ delete from public.product_type where id = 'b1000000-0000-0000-57c0-000000000001' $$, '23503', null, 'product type with products cannot be deleted');
select throws_ok($$ delete from public.unit_of_measure_conversion where from_uom_id = 'b0000000-0000-0000-57c0-000000000002' $$,
  'P0001', 'Cannot delete this conversion (ML_TO_LT) as items depend on it.', 'conversion an item relies on cannot be deleted');

insert into public.barcode (barcode, item_id) values ('6001234567890', 'b7000000-0000-0000-57c0-000000000001');
select throws_ok($$ insert into public.barcode (barcode, item_id) values ('6001234567890', 'b7000000-0000-0000-57c0-000000000002') $$,
  '23505', null, 'a barcode belongs to one item');
delete from public.item where id = 'b7000000-0000-0000-57c0-000000000001';
select is((select count(*) from public.barcode), 0::bigint, 'deleting an item deletes its barcodes');
select is((select count(*) from public.supplier_item), 0::bigint, 'and its supplier items');

-- Drop the ml item, then the conversion: the mirror goes with it.
delete from public.item where id = 'b7000000-0000-0000-57c0-000000000002';
delete from public.unit_of_measure_conversion where from_uom_id = 'b0000000-0000-0000-57c0-000000000002';
select is((select count(*) from public.unit_of_measure_conversion), 0::bigint, 'deleting a conversion deletes its mirror');

insert into public.unit_of_measure_conversion (from_uom_id, to_uom_id, conversion)
values ('b0000000-0000-0000-57c0-000000000003', 'b0000000-0000-0000-57c0-000000000002', 4);
select is((select count(*) from public.unit_of_measure_conversion), 2::bigint, 'kg <-> ml pair');
-- Only the unused pack type / product reference L and KG; ML is now free.
delete from public.pack_type where id = 'b3000000-0000-0000-57c0-000000000002';
delete from public.unit_of_measure where id = 'b0000000-0000-0000-57c0-000000000002';
select is((select count(*) from public.unit_of_measure_conversion), 0::bigint, 'deleting a uom deletes conversions to and from it');

-- ============================================================================
-- Roles
-- ============================================================================
create temp table r (name text primary key, result jsonb);
grant all on r to authenticated;
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

select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-57c0-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select is((select count(*) from public.product), 2::bigint, 'user can read products');
select is((select count(*) from public.pack_type), 2::bigint, 'user can read pack types');
select is(pg_temp.try($$ insert into public.product_type (code, name) values ('X', 'X') $$), '42501', 'user cannot create a product type');
select is(pg_temp.try($$ update public.product set active = false $$), '0', 'user cannot edit a product');
select is(pg_temp.try($$ insert into public.storage_area (code, name, location_id) values ('K1', 'Shelf', 'b6000000-0000-0000-57c0-000000000001') $$),
  '1', 'user can create a storage area');
select is(pg_temp.try($$ update public.storage_area set name = 'Shelf 1' $$), '1', 'user can edit a storage area');
select is(pg_temp.try($$ delete from public.storage_area $$), '0', 'user cannot delete a storage area');

select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-57c0-000000000002", "role": "authenticated"}', true);
select is(pg_temp.try($$ insert into public.item (name, product_id, pack_type_id) values ('bag', 'b2000000-0000-0000-57c0-000000000001', 'b3000000-0000-0000-57c0-000000000001') $$),
  '1', 'admin can create an item');
select is(pg_temp.try($$ delete from public.storage_area $$), '1', 'admin can delete a storage area');

select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-57c0-000000000001", "role": "authenticated"}', true);
select is(pg_temp.try($$ insert into public.item (name, product_id, pack_type_id) values ('bag2', 'b2000000-0000-0000-57c0-000000000002', 'b3000000-0000-0000-57c0-000000000001') $$),
  '42501', 'user cannot create an item');
select is(pg_temp.try($$ update public.item set item_tracking_method = 'LIFO' $$), '1', 'user can edit an existing item');

select set_config('request.jwt.claims',
  '{"sub": "10000000-0000-0000-57c0-000000000003", "role": "authenticated"}', true);
select is(pg_temp.try($$ update public.item set active = false $$), '0', 'viewer cannot edit an item');
select is((select count(*) from public.item), 1::bigint, 'viewer can read items');

select * from finish();
rollback;
