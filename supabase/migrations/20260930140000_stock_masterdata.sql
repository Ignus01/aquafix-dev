-- Stock masterdata (spec: AquaFix Stock Masterdata Spec): what can be stocked
-- (product, item = product in a pack), how it is measured and packed, where it
-- is stored and who supplies it.
--
-- Differences from the Mendix model, all flagged in the spec's open questions:
--   * Derived values are kept fresh by triggers, not on-change microflows:
--     pack_type.code, item.code and item.conversion_to_default_uom are
--     recalculated when a pack type, product, unit of measure or conversion
--     they depend on changes (Mendix left existing items stale).
--   * Deleting one of a pair of mirrored conversions deletes the other too,
--     unless an item still relies on it.
--   * Uniqueness is enforced by database constraints, not just validation.
--   * `is_default` and `convert/convertion` are spelled correctly.
--   * Barcodes are maintained from the app and are globally unique, so a scan
--     resolves to one item.
--   * The `user` role can READ products, pack types, units of measure and
--     barcodes (Mendix: no access), because it can edit items, whose codes and
--     conversion factors are built from them.

create type public.uom_type as enum ('MASS', 'VOLUME', 'LENGTH', 'TIME', 'CURRENCY', 'NODIM');
create type public.item_tracking_method as enum ('FIFO', 'LIFO');

-- Audit columns come from the session, never the client (service-role writes
-- have no auth.uid() and keep what they set).
create function public.set_stock_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================================
-- product_type
-- ============================================================================
create table public.product_type (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint product_type_code_not_blank check (btrim(code) <> ''),
  constraint product_type_name_not_blank check (btrim(name) <> ''),
  constraint product_type_code_key unique (code),
  constraint product_type_name_key unique (name)
);

-- ============================================================================
-- unit_of_measure
-- ============================================================================
create table public.unit_of_measure (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  code text not null,
  name text not null,
  uom_type public.uom_type not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint unit_of_measure_code_not_blank check (btrim(code) <> ''),
  constraint unit_of_measure_name_not_blank check (btrim(name) <> ''),
  constraint unit_of_measure_code_key unique (code),
  constraint unit_of_measure_name_key unique (name)
);

-- ============================================================================
-- product
-- ============================================================================
create table public.product (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  code text not null,
  name text not null,
  active boolean not null default true,
  -- A product type or unit of measure in use can't be deleted.
  product_type_id uuid not null references public.product_type (id) on delete restrict,
  uom_id uuid not null references public.unit_of_measure (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint product_code_not_blank check (btrim(code) <> ''),
  constraint product_name_not_blank check (btrim(name) <> ''),
  constraint product_code_key unique (code),
  constraint product_name_key unique (name)
);

create index product_product_type_id_idx on public.product (product_type_id);
create index product_uom_id_idx on public.product (uom_id);

-- Name and Code are forced to upper case before the uniqueness check.
create function public.product_normalize()
returns trigger
language plpgsql
as $$
begin
  new.name := upper(btrim(new.name));
  new.code := upper(btrim(new.code));
  return new;
end;
$$;

-- ============================================================================
-- pack_type
-- ============================================================================
create table public.pack_type (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  name text not null,
  qty numeric not null,
  -- Derived: "5 L" (Qty + UOM code). Kept by trigger.
  code text,
  active boolean not null default true,
  uom_id uuid not null references public.unit_of_measure (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint pack_type_name_not_blank check (btrim(name) <> ''),
  constraint pack_type_qty_positive check (qty > 0),
  constraint pack_type_name_key unique (name)
);

create index pack_type_uom_id_idx on public.pack_type (uom_id);

-- ============================================================================
-- storage_area
-- ============================================================================
create table public.storage_area (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  code text not null,
  name text not null,
  active boolean not null default true,
  -- Stock-keeping locations own their storage areas. Kept (dangling in
  -- Mendix) is not possible with a foreign key, so a location in use is protected.
  location_id uuid not null references public.location (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint storage_area_code_not_blank check (btrim(code) <> ''),
  constraint storage_area_name_not_blank check (btrim(name) <> ''),
  constraint storage_area_code_key unique (code),
  constraint storage_area_name_key unique (name)
);

create index storage_area_location_id_idx on public.storage_area (location_id);

-- ============================================================================
-- item
-- ============================================================================
create table public.item (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  name text not null,
  -- Derived: "CHLOR (5 L)". Kept by trigger.
  code text,
  -- Derived: pack qty x (pack UOM -> product UOM factor). Kept by trigger.
  conversion_to_default_uom numeric not null default 0,
  item_tracking_method public.item_tracking_method not null default 'FIFO',
  active boolean not null default true,
  product_id uuid not null references public.product (id) on delete restrict,
  pack_type_id uuid not null references public.pack_type (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint item_name_not_blank check (btrim(name) <> ''),
  constraint item_product_pack_type_key unique (product_id, pack_type_id)
);

create index item_pack_type_id_idx on public.item (pack_type_id);

-- ============================================================================
-- barcode (no audit columns, as in Mendix)
-- ============================================================================
create table public.barcode (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  item_id uuid not null references public.item (id) on delete cascade,
  constraint barcode_not_blank check (btrim(barcode) <> ''),
  constraint barcode_barcode_key unique (barcode)
);

create index barcode_item_id_idx on public.barcode (item_id);

-- ============================================================================
-- supplier_item
-- ============================================================================
create table public.supplier_item (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  is_default boolean not null default false,
  default_lead_time numeric not null,
  default_price_exc_vat numeric not null,
  item_id uuid not null references public.item (id) on delete cascade,
  supplier_id uuid not null references public.organisation (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint supplier_item_lead_time_positive check (default_lead_time > 0),
  constraint supplier_item_price_positive check (default_price_exc_vat > 0),
  constraint supplier_item_item_supplier_key unique (item_id, supplier_id)
);

create index supplier_item_supplier_id_idx on public.supplier_item (supplier_id);
-- At most one default supplier per item.
create unique index supplier_item_one_default on public.supplier_item (item_id) where is_default;

-- Marking a supplier item as default clears the flag on the item's others.
create function public.supplier_item_single_default()
returns trigger
language plpgsql
as $$
begin
  if new.is_default then
    update public.supplier_item
       set is_default = false
     where item_id = new.item_id and id <> new.id and is_default;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- unit_of_measure_conversion
-- ============================================================================
create table public.unit_of_measure_conversion (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  conversion numeric not null,
  -- Derived: "FROM_TO_TO". Kept by trigger.
  code text,
  -- Deleting a unit of measure deletes the conversions to and from it.
  from_uom_id uuid not null references public.unit_of_measure (id) on delete cascade,
  to_uom_id uuid not null references public.unit_of_measure (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint uom_conversion_positive check (conversion > 0),
  constraint uom_conversion_distinct check (from_uom_id <> to_uom_id),
  constraint uom_conversion_from_to_key unique (from_uom_id, to_uom_id)
);

create index uom_conversion_to_uom_id_idx on public.unit_of_measure_conversion (to_uom_id);

-- ============================================================================
-- Derived values
-- ============================================================================

-- PackType.Code: "5 L"; cleared if Qty <= 0 or there is no UOM.
create function public.pack_type_update_code()
returns trigger
language plpgsql
as $$
declare
  v_uom text;
begin
  select code into v_uom from public.unit_of_measure where id = new.uom_id;
  if new.qty is null or new.qty <= 0 or v_uom is null then
    new.code := null;
  else
    new.code := trim_scale(new.qty)::text || ' ' || v_uom;
  end if;
  return new;
end;
$$;

-- Item.Code and Item.ConversionToDefaultUOM. The factor is 1 when the pack UOM
-- is the product UOM, otherwise the direct pack UOM -> product UOM conversion
-- (chains such as ml -> L -> kL are not resolved). No conversion blocks the save.
create function public.item_update_derived()
returns trigger
language plpgsql
as $$
declare
  v_product_code text;
  v_product_uom uuid;
  v_pack_code text;
  v_pack_qty numeric;
  v_pack_uom uuid;
  v_factor numeric;
begin
  select code, uom_id into v_product_code, v_product_uom
    from public.product where id = new.product_id;
  select code, qty, uom_id into v_pack_code, v_pack_qty, v_pack_uom
    from public.pack_type where id = new.pack_type_id;

  new.name := upper(btrim(new.name));
  new.code := case when v_pack_code is null then null
                   else v_product_code || ' (' || v_pack_code || ')' end;

  if v_pack_uom = v_product_uom then
    v_factor := 1;
  else
    select conversion into v_factor
      from public.unit_of_measure_conversion
     where from_uom_id = v_pack_uom and to_uom_id = v_product_uom;
  end if;

  if v_factor is null then
    raise exception 'There is no unit of measure conversion from % to %. Add one under Unit Of Measure first.',
      (select code from public.unit_of_measure where id = v_pack_uom),
      (select code from public.unit_of_measure where id = v_product_uom)
      using errcode = 'P0001';
  end if;

  new.conversion_to_default_uom := v_pack_qty * v_factor;
  return new;
end;
$$;

-- UnitOfMeasureConversion.Code: "FROM_TO_TO".
create function public.uom_conversion_update_code()
returns trigger
language plpgsql
as $$
begin
  new.code := (select code from public.unit_of_measure where id = new.from_uom_id)
    || '_TO_' || (select code from public.unit_of_measure where id = new.to_uom_id);
  return new;
end;
$$;

-- Saving A -> B also creates or updates B -> A with factor 1 / Conversion.
-- Only for the row the user wrote (depth 1): the mirror row's own write must
-- not bounce back, and cascades from a unit of measure delete handle both rows.
create function public.uom_conversion_mirror()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  insert into public.unit_of_measure_conversion (from_uom_id, to_uom_id, conversion)
  values (new.to_uom_id, new.from_uom_id, 1 / new.conversion)
  on conflict (from_uom_id, to_uom_id) do update set conversion = excluded.conversion;
  return null;
end;
$$;

-- Deleting one of a mirrored pair deletes the other, but not while an item
-- relies on the conversion being deleted.
create function public.uom_conversion_before_delete()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
      from public.item i
      join public.pack_type pt on pt.id = i.pack_type_id
      join public.product p on p.id = i.product_id
     where pt.uom_id = old.from_uom_id and p.uom_id = old.to_uom_id
  ) then
    raise exception 'Cannot delete this conversion (%) as items depend on it.', old.code
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create function public.uom_conversion_mirror_delete()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() = 1 then
    delete from public.unit_of_measure_conversion
     where from_uom_id = old.to_uom_id and to_uom_id = old.from_uom_id;
  end if;
  return null;
end;
$$;

-- Re-derive dependants. An `update ... set x = x` fires the dependant's
-- before-update derived-value trigger.
create function public.refresh_pack_types_of_uom()
returns trigger
language plpgsql
as $$
begin
  update public.pack_type set qty = qty where uom_id = new.id;
  update public.unit_of_measure_conversion set conversion = conversion
   where from_uom_id = new.id or to_uom_id = new.id;
  return null;
end;
$$;

create function public.refresh_items_of_pack_type()
returns trigger
language plpgsql
as $$
begin
  update public.item set name = name where pack_type_id = new.id;
  return null;
end;
$$;

create function public.refresh_items_of_product()
returns trigger
language plpgsql
as $$
begin
  update public.item set name = name where product_id = new.id;
  return null;
end;
$$;

create function public.refresh_items_of_conversion()
returns trigger
language plpgsql
as $$
begin
  update public.item i set name = i.name
    from public.pack_type pt, public.product p
   where pt.id = i.pack_type_id and p.id = i.product_id
     and pt.uom_id = new.from_uom_id and p.uom_id = new.to_uom_id;
  return null;
end;
$$;

-- ============================================================================
-- Triggers
-- ============================================================================
create trigger product_type_audit before insert or update on public.product_type
  for each row execute function public.set_stock_audit_fields();
create trigger unit_of_measure_audit before insert or update on public.unit_of_measure
  for each row execute function public.set_stock_audit_fields();
create trigger product_audit before insert or update on public.product
  for each row execute function public.set_stock_audit_fields();
create trigger pack_type_audit before insert or update on public.pack_type
  for each row execute function public.set_stock_audit_fields();
create trigger storage_area_audit before insert or update on public.storage_area
  for each row execute function public.set_stock_audit_fields();
create trigger item_audit before insert or update on public.item
  for each row execute function public.set_stock_audit_fields();
create trigger supplier_item_audit before insert or update on public.supplier_item
  for each row execute function public.set_stock_audit_fields();
create trigger unit_of_measure_conversion_audit before insert or update on public.unit_of_measure_conversion
  for each row execute function public.set_stock_audit_fields();

create trigger product_normalize before insert or update on public.product
  for each row execute function public.product_normalize();
create trigger pack_type_update_code before insert or update on public.pack_type
  for each row execute function public.pack_type_update_code();
create trigger item_update_derived before insert or update on public.item
  for each row execute function public.item_update_derived();
create trigger supplier_item_single_default before insert or update on public.supplier_item
  for each row execute function public.supplier_item_single_default();
create trigger uom_conversion_update_code before insert or update on public.unit_of_measure_conversion
  for each row execute function public.uom_conversion_update_code();

create trigger uom_conversion_mirror after insert or update of conversion on public.unit_of_measure_conversion
  for each row execute function public.uom_conversion_mirror();
create trigger uom_conversion_before_delete before delete on public.unit_of_measure_conversion
  for each row execute function public.uom_conversion_before_delete();
create trigger uom_conversion_mirror_delete after delete on public.unit_of_measure_conversion
  for each row execute function public.uom_conversion_mirror_delete();
create trigger uom_conversion_refresh_items after insert or update on public.unit_of_measure_conversion
  for each row execute function public.refresh_items_of_conversion();

create trigger unit_of_measure_refresh after update of code on public.unit_of_measure
  for each row when (old.code is distinct from new.code)
  execute function public.refresh_pack_types_of_uom();
create trigger pack_type_refresh_items after update on public.pack_type
  for each row when (old.code is distinct from new.code
                     or old.qty is distinct from new.qty
                     or old.uom_id is distinct from new.uom_id)
  execute function public.refresh_items_of_pack_type();
create trigger product_refresh_items after update on public.product
  for each row when (old.code is distinct from new.code or old.uom_id is distinct from new.uom_id)
  execute function public.refresh_items_of_product();

-- ============================================================================
-- RLS (spec: Security). system_admin/admin: full CRUD; viewer: read-only.
-- `user`: see the per-table lists below.
-- ============================================================================
alter table public.product_type enable row level security;
alter table public.unit_of_measure enable row level security;
alter table public.product enable row level security;
alter table public.pack_type enable row level security;
alter table public.storage_area enable row level security;
alter table public.item enable row level security;
alter table public.barcode enable row level security;
alter table public.supplier_item enable row level security;
alter table public.unit_of_measure_conversion enable row level security;

-- helper: create the four policies from role lists
create function pg_temp.stock_policies(
  t text, p_read text[], p_insert text[], p_update text[], p_delete text[]
) returns void
language plpgsql
as $$
begin
  execute format(
    'create policy %1$I_select on public.%1$I for select to authenticated using (public.has_masterdata_role(%2$L::public.masterdata_role[]))',
    t, p_read);
  execute format(
    'create policy %1$I_insert on public.%1$I for insert to authenticated with check (public.has_masterdata_role(%2$L::public.masterdata_role[]))',
    t, p_insert);
  execute format(
    'create policy %1$I_update on public.%1$I for update to authenticated using (public.has_masterdata_role(%2$L::public.masterdata_role[])) with check (public.has_masterdata_role(%2$L::public.masterdata_role[]))',
    t, p_update);
  execute format(
    'create policy %1$I_delete on public.%1$I for delete to authenticated using (public.has_masterdata_role(%2$L::public.masterdata_role[]))',
    t, p_delete);
end;
$$;

do $$
declare
  admins text[] := array['system_admin', 'admin'];
  everyone text[] := array['system_admin', 'admin', 'user', 'viewer'];
begin
  -- user: read-only on the lists (Mendix: none on product, UOM, pack type; see header).
  perform pg_temp.stock_policies('product_type', everyone, admins, admins, admins);
  perform pg_temp.stock_policies('unit_of_measure', everyone, admins, admins, admins);
  perform pg_temp.stock_policies('product', everyone, admins, admins, admins);
  perform pg_temp.stock_policies('pack_type', everyone, admins, admins, admins);
  perform pg_temp.stock_policies('barcode', everyone, admins, admins, admins);
  perform pg_temp.stock_policies('supplier_item', everyone, admins, admins, admins);
  perform pg_temp.stock_policies('unit_of_measure_conversion', everyone, admins, admins, admins);
  -- user: create and edit storage areas, no delete.
  perform pg_temp.stock_policies('storage_area', everyone,
    array['system_admin', 'admin', 'user'], array['system_admin', 'admin', 'user'], admins);
  -- user: edit existing items, no create or delete.
  perform pg_temp.stock_policies('item', everyone, admins,
    array['system_admin', 'admin', 'user'], admins);
end;
$$;
