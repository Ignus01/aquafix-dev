-- Local test data (loaded by `npx supabase db reset` after the migrations).
-- Never runs against a hosted project. Mirrors the MWTS stock spec's test
-- set-up (spec "AquaFix Stock Module – Developer Spec (MWTS rollout)"):
-- MWTS and WPS stores, the technicians' kits, Selby as a site, salt and
-- reagents, and PO-00004 waiting to be received.
--
-- Test logins (all share the password below; local only):
--   admin@aquafix.test    system_admin  "Test Admin"
--   office@aquafix.test   admin         "Office"
--   ryan@aquafix.test     user          "Ryan"
--   jonifas@aquafix.test  user          "Jonifas"
-- Password: AquaFix-test-2026

-- ============================================================================
-- Users
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, email_change, email_change_token_new, recovery_token)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email,
       extensions.crypt('AquaFix-test-2026', extensions.gen_salt('bf')), now(),
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now(), '', '', '', ''
  from (values
    ('5eed0000-0000-0000-0000-000000000001'::uuid, 'admin@aquafix.test'),
    ('5eed0000-0000-0000-0000-000000000002'::uuid, 'office@aquafix.test'),
    ('5eed0000-0000-0000-0000-000000000003'::uuid, 'ryan@aquafix.test'),
    ('5eed0000-0000-0000-0000-000000000004'::uuid, 'jonifas@aquafix.test')
  ) as u(id, email);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
  from auth.users u where u.email like '%@aquafix.test';

insert into public.profiles (id, username) values
  ('5eed0000-0000-0000-0000-000000000001', 'Test Admin'),
  ('5eed0000-0000-0000-0000-000000000002', 'Office'),
  ('5eed0000-0000-0000-0000-000000000003', 'Ryan'),
  ('5eed0000-0000-0000-0000-000000000004', 'Jonifas');

insert into public.user_masterdata_roles (user_id, role) values
  ('5eed0000-0000-0000-0000-000000000001', 'system_admin'),
  ('5eed0000-0000-0000-0000-000000000002', 'admin'),
  ('5eed0000-0000-0000-0000-000000000003', 'user'),
  ('5eed0000-0000-0000-0000-000000000004', 'user');

-- ============================================================================
-- Organisations, locations and storage areas
-- ============================================================================
insert into public.region (id, name) values ('5eed0100-0000-0000-0000-000000000001', 'Gauteng');

insert into public.organisation (id, name, is_supplier, is_service_supplier) values
  ('5eed0200-0000-0000-0000-000000000001', 'MWTS', false, true),
  ('5eed0200-0000-0000-0000-000000000002', 'WPS', false, false),
  ('5eed0200-0000-0000-0000-000000000003', 'PE Chemicals PTA', true, false),
  ('5eed0200-0000-0000-0000-000000000004', 'Hanna Instruments', true, false);

insert into public.location (id, name, transfer_type, is_stock_manager, region_id, organisation_id) values
  ('5eed0300-0000-0000-0000-000000000001', 'MWTS', 'AUTO', true, '5eed0100-0000-0000-0000-000000000001', '5eed0200-0000-0000-0000-000000000001'),
  ('5eed0300-0000-0000-0000-000000000002', 'WPS', 'AUTO', true, '5eed0100-0000-0000-0000-000000000001', '5eed0200-0000-0000-0000-000000000002'),
  ('5eed0300-0000-0000-0000-000000000003', 'Selby', 'AUTO', false, '5eed0100-0000-0000-0000-000000000001', '5eed0200-0000-0000-0000-000000000001'),
  ('5eed0300-0000-0000-0000-000000000004', 'Rietfontein', 'AUTO', false, '5eed0100-0000-0000-0000-000000000001', '5eed0200-0000-0000-0000-000000000001');

-- Kits belong to a technician; the MWTS store (optional) and the WPS store
-- (a contractor holding stock for MWTS) belong to nobody.
insert into public.storage_area (id, code, name, location_id, technician_user_id) values
  ('5eed0400-0000-0000-0000-000000000001', 'MWTS-STORE', 'MWTS store', '5eed0300-0000-0000-0000-000000000001', null),
  ('5eed0400-0000-0000-0000-000000000002', 'RYAN-KIT', 'Ryan''s kit', '5eed0300-0000-0000-0000-000000000001', '5eed0000-0000-0000-0000-000000000003'),
  ('5eed0400-0000-0000-0000-000000000003', 'JONIFAS-KIT', 'Jonifas''s kit', '5eed0300-0000-0000-0000-000000000001', '5eed0000-0000-0000-0000-000000000004'),
  ('5eed0400-0000-0000-0000-000000000004', 'WPS-STORE', 'WPS store', '5eed0300-0000-0000-0000-000000000002', null);

-- ============================================================================
-- Products and items: salt in 25 kg bags; DPD1 and DPD3 reagent tablets in packs of 100
-- ============================================================================
insert into public.unit_of_measure (id, code, name, uom_type) values
  ('5eed0500-0000-0000-0000-000000000001', 'KG', 'Kilogram', 'MASS'),
  ('5eed0500-0000-0000-0000-000000000002', 'TAB', 'Tablet', 'NODIM');

insert into public.product_type (id, code, name) values
  ('5eed0600-0000-0000-0000-000000000001', 'SALT', 'Salt'),
  ('5eed0600-0000-0000-0000-000000000002', 'REAGENT', 'Reagent');

insert into public.product (id, code, name, product_type_id, uom_id) values
  ('5eed0700-0000-0000-0000-000000000001', 'SALT', 'Salt', '5eed0600-0000-0000-0000-000000000001', '5eed0500-0000-0000-0000-000000000001'),
  ('5eed0700-0000-0000-0000-000000000002', 'DPD1', 'DPD1 tablets', '5eed0600-0000-0000-0000-000000000002', '5eed0500-0000-0000-0000-000000000002'),
  ('5eed0700-0000-0000-0000-000000000003', 'DPD3', 'DPD3 tablets', '5eed0600-0000-0000-0000-000000000002', '5eed0500-0000-0000-0000-000000000002');

insert into public.pack_type (id, name, code, qty, uom_id) values
  ('5eed0800-0000-0000-0000-000000000001', '25 kg bag', '25KG', 25, '5eed0500-0000-0000-0000-000000000001'),
  ('5eed0800-0000-0000-0000-000000000002', 'Pack of 100', 'P100', 100, '5eed0500-0000-0000-0000-000000000002');

insert into public.item (id, name, product_id, pack_type_id) values
  ('5eed0900-0000-0000-0000-000000000001', 'Salt 25 kg', '5eed0700-0000-0000-0000-000000000001', '5eed0800-0000-0000-0000-000000000001'),
  ('5eed0900-0000-0000-0000-000000000002', 'DPD1', '5eed0700-0000-0000-0000-000000000002', '5eed0800-0000-0000-0000-000000000002'),
  ('5eed0900-0000-0000-0000-000000000003', 'DPD3', '5eed0700-0000-0000-0000-000000000003', '5eed0800-0000-0000-0000-000000000002');

-- ============================================================================
-- Something at Selby to link a work order to (R4): an asset, an open service
-- and an open incident.
-- ============================================================================
insert into public.asset_type (id, name) values ('5eed0a00-0000-0000-0000-000000000001', 'Water softener');
insert into public.asset (id, name, code, asset_type_id, location_id) values
  ('5eed0b00-0000-0000-0000-000000000001', 'Selby softener 1', 'SEL-SOFT-1', '5eed0a00-0000-0000-0000-000000000001', '5eed0300-0000-0000-0000-000000000003');
insert into public.service (id, service_type, due_date, asset_id) values
  ('5eed0c00-0000-0000-0000-000000000001', 'scheduled_maintenance', now() + interval '3 days', '5eed0b00-0000-0000-0000-000000000001');
insert into public.incident_type (id, name) values ('5eed0d00-0000-0000-0000-000000000001', 'Low salt');
insert into public.incident (id, comment, location_id, incident_type_id) values
  ('5eed0e00-0000-0000-0000-000000000001', 'Softener brine tank low on salt', '5eed0300-0000-0000-0000-000000000003', '5eed0d00-0000-0000-0000-000000000001');

-- ============================================================================
-- PO-00004 (spec test data): PE Chemicals PTA, alias ODOO 16004,
-- 10 × Salt 25 kg at R212.00 ex VAT, ETA today, status New.
-- ============================================================================
insert into public.purchase_order (id, reference, supplier_id, order_date, order_alias)
overriding system value
values ('5eed0f00-0000-0000-0000-000000000004', 4, '5eed0200-0000-0000-0000-000000000003', current_date, 'ODOO 16004');
select setval(pg_get_serial_sequence('public.purchase_order', 'reference'), 4);

insert into public.purchase_order_item (id, purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, eta) values
  ('5eed1000-0000-0000-0000-000000000001', '5eed0f00-0000-0000-0000-000000000004', '5eed0900-0000-0000-0000-000000000001', 10, 212.00, current_date);

-- Script B's reagent order (spec): Hanna Instruments, alias ODOO P00123,
-- DPD1 × 5 and DPD3 × 3, no collector (any technician can collect it).
insert into public.purchase_order (id, reference, supplier_id, order_date, order_alias)
overriding system value
values ('5eed0f00-0000-0000-0000-000000000005', 5, '5eed0200-0000-0000-0000-000000000004', current_date, 'ODOO P00123');
select setval(pg_get_serial_sequence('public.purchase_order', 'reference'), 5);
insert into public.purchase_order_item (id, purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, eta) values
  ('5eed1000-0000-0000-0000-000000000002', '5eed0f00-0000-0000-0000-000000000005', '5eed0900-0000-0000-0000-000000000002', 5, 480.00, current_date),
  ('5eed1000-0000-0000-0000-000000000003', '5eed0f00-0000-0000-0000-000000000005', '5eed0900-0000-0000-0000-000000000003', 3, 520.00, current_date);
