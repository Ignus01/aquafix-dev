-- Stock manager (spec: AquaFix Stock Management Spec): one ledger,
-- `item_transaction`, that every stock document posts signed rows into. Stock
-- on hand is the sum of the ledger (view `storage_area_item_stock`).
--
-- Documents: purchase orders, loads and intakes (PO intakes), transfers, work
-- orders and stock takes. Dispatches and non-PO intakes have no pages in the
-- spec; their enum values exist but nothing creates them.
--
-- Differences from the Mendix model, all flagged in the spec's open questions:
--   * Ledger rows are written only by triggers on the document lines, one row
--     per line (two legs for a BOTH transfer), so they can't drift:
--       - transfer legs are kept apart (send / receive), fixing the shared
--         SEND link that turned a receive into a second send on re-save;
--       - changing a transfer's type, areas or date re-posts its lines, so no
--         orphan rows are left behind;
--       - work-order usage posts a NEGATIVE quantity; a line flagged
--         `is_return` posts a positive WORK_ORDER_RETURN;
--       - a stock take line stores the count in `counted_qty`; the adjustment
--         is counted minus the ledger total EXCLUDING the line itself.
--   * Stock can't go negative: a send, usage or other change that would leave
--     an item below zero in a storage area is rejected (decision: block).
--   * Over-receipt is allowed; the PO line then shows a negative outstanding
--     quantity (decision: allow, flagged in the UI).
--   * Receiving (loads, intakes, documents) stays system_admin-only, as built.
--     All roles go through the helper functions below, so changing that is a
--     one-line change per helper.
--   * No location scoping, as built.
--   * `work_order.order_date` is spelled correctly (Mendix: OderDate).
--   * Document numbers are identity columns shown with a prefix by the app.

create type public.transaction_type as enum (
  'INTAKE_PURCHASE_ORDER', 'INTAKE_FACILITY', 'INTAKE_STOCK_RETURN',
  'DISPATCH_LOCATION_TRANSFER', 'DISPATCH_SUPPLIER_RETURN', 'DISPATCH_SALES_ORDER',
  'STOCK_TRANSFER', 'STOCK_ADJUSTMENT', 'WORK_ORDER_RETURN', 'WORK_ORDER_USAGE'
);
create type public.po_status as enum ('new', 'completed', 'closed');
create type public.intake_type as enum ('PURCHASE_ORDER', 'FACILITY_TRANSFER', 'STOCK_RETURN');
create type public.load_type as enum ('INTAKE', 'DISPATCH');
create type public.transfer_type as enum ('SEND', 'RECEIVE', 'BOTH');

-- ============================================================================
-- Role helpers
-- ============================================================================
create function public.is_stock_reader() returns boolean language sql stable as $$
  select public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[]);
$$;
-- Order, transfer, issue and count stock.
create function public.is_stock_writer() returns boolean language sql stable as $$
  select public.has_masterdata_role(array['system_admin','admin','user']::public.masterdata_role[]);
$$;
create function public.is_stock_admin() returns boolean language sql stable as $$
  select public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]);
$$;
-- Receive stock.
create function public.is_stock_receiver() returns boolean language sql stable as $$
  select public.has_masterdata_role(array['system_admin']::public.masterdata_role[]);
$$;

-- ============================================================================
-- Tables
-- ============================================================================
create table public.purchase_order (
  id uuid primary key default gen_random_uuid(),
  reference bigint generated always as identity (start with 1) not null unique,
  order_date date not null default current_date,
  order_alias text,
  comment text,
  status public.po_status not null default 'new',
  supplier_id uuid not null references public.organisation (id) on delete restrict,
  -- Derived by trigger from the lines.
  total_cost_exc_vat numeric(15, 2) not null default 0,
  total_cost_inc_vat numeric(15, 2) not null default 0,
  nr_of_items integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null
);
create index purchase_order_supplier_id_idx on public.purchase_order (supplier_id);

create table public.purchase_order_item (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_order (id) on delete cascade,
  item_id uuid not null references public.item (id) on delete restrict,
  qty_ordered numeric not null,
  unit_cost_exc_vat numeric(15, 4) not null default 0,
  unit_cost_inc_vat numeric(15, 4) not null default 0,
  total_cost_exc_vat numeric(15, 2) not null default 0,
  total_cost_inc_vat numeric(15, 2) not null default 0,
  eta date,
  status public.po_status not null default 'new',
  -- Derived: qty_ordered x item conversion; receipts from the intake lines.
  base_qty numeric not null default 0,
  qty_received numeric not null default 0,
  qty_outstanding numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint purchase_order_item_qty_positive check (qty_ordered > 0),
  constraint purchase_order_item_cost_positive check (unit_cost_exc_vat >= 0 and unit_cost_inc_vat >= 0)
);
create index purchase_order_item_po_idx on public.purchase_order_item (purchase_order_id);
create index purchase_order_item_item_idx on public.purchase_order_item (item_id);

create table public.load (
  id uuid primary key default gen_random_uuid(),
  reference bigint generated always as identity (start with 1) not null unique,
  load_type public.load_type not null default 'INTAKE',
  load_date date not null default current_date,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null
);

create table public.intake (
  id uuid primary key default gen_random_uuid(),
  reference bigint generated always as identity (start with 1) not null unique,
  intake_type public.intake_type not null default 'PURCHASE_ORDER',
  load_id uuid not null references public.load (id) on delete restrict,
  storage_area_id uuid not null references public.storage_area (id) on delete restrict,
  supplier_id uuid references public.organisation (id) on delete restrict,
  -- Required for a PO intake.
  purchase_order_id uuid references public.purchase_order (id) on delete restrict,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint intake_po_required check (intake_type <> 'PURCHASE_ORDER' or purchase_order_id is not null)
);
create index intake_load_idx on public.intake (load_id);
create index intake_po_idx on public.intake (purchase_order_id);
create index intake_storage_area_idx on public.intake (storage_area_id);

create table public.intake_item (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.intake (id) on delete cascade,
  item_id uuid not null references public.item (id) on delete restrict,
  purchase_order_item_id uuid references public.purchase_order_item (id) on delete restrict,
  qty numeric not null,
  base_qty numeric not null default 0,
  transaction_date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint intake_item_qty_positive check (qty > 0)
);
create index intake_item_item_idx on public.intake_item (item_id);
create unique index intake_item_po_line_once on public.intake_item (intake_id, purchase_order_item_id)
  where purchase_order_item_id is not null;
create index intake_item_po_item_idx on public.intake_item (purchase_order_item_id);

create table public.stock_document (
  id uuid primary key default gen_random_uuid(),
  load_id uuid references public.load (id) on delete cascade,
  intake_id uuid references public.intake (id) on delete cascade,
  name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  constraint stock_document_one_parent check ((load_id is null) <> (intake_id is null)),
  constraint stock_document_name_not_blank check (btrim(name) <> ''),
  constraint stock_document_size_check check (size_bytes > 0)
);
create index stock_document_load_idx on public.stock_document (load_id);
create index stock_document_intake_idx on public.stock_document (intake_id);

create table public.transfer_main (
  id uuid primary key default gen_random_uuid(),
  reference bigint generated always as identity (start with 1) not null unique,
  transfer_type public.transfer_type not null,
  transfer_date timestamptz not null default now(),
  from_storage_area_id uuid references public.storage_area (id) on delete restrict,
  to_storage_area_id uuid references public.storage_area (id) on delete restrict,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint transfer_from_needed check (transfer_type = 'RECEIVE' or from_storage_area_id is not null),
  constraint transfer_to_needed check (transfer_type = 'SEND' or to_storage_area_id is not null),
  constraint transfer_areas_differ check (from_storage_area_id is distinct from to_storage_area_id
                                          or from_storage_area_id is null)
);
create index transfer_main_from_idx on public.transfer_main (from_storage_area_id);
create index transfer_main_to_idx on public.transfer_main (to_storage_area_id);

create table public.transfer_item (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfer_main (id) on delete cascade,
  item_id uuid not null references public.item (id) on delete restrict,
  qty numeric not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint transfer_item_qty_positive check (qty > 0),
  constraint transfer_item_once unique (transfer_id, item_id)
);
create index transfer_item_item_idx on public.transfer_item (item_id);

create table public.work_order (
  id uuid primary key default gen_random_uuid(),
  reference bigint generated always as identity (start with 1) not null unique,
  order_date timestamptz not null default now(),
  storage_area_id uuid not null references public.storage_area (id) on delete restrict,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null
);
create index work_order_storage_area_idx on public.work_order (storage_area_id);

create table public.work_order_item (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_order (id) on delete cascade,
  item_id uuid not null references public.item (id) on delete restrict,
  qty numeric not null,
  -- false: issued to the job (usage, stock goes down); true: returned.
  is_return boolean not null default false,
  transaction_date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint work_order_item_qty_positive check (qty > 0),
  constraint work_order_item_once unique (work_order_id, item_id)
);
create index work_order_item_item_idx on public.work_order_item (item_id);

create table public.stock_take (
  id uuid primary key default gen_random_uuid(),
  reference bigint generated always as identity (start with 1) not null unique,
  take_date timestamptz not null default now(),
  storage_area_id uuid not null references public.storage_area (id) on delete restrict,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null
);
create index stock_take_storage_area_idx on public.stock_take (storage_area_id);

create table public.stock_take_item (
  id uuid primary key default gen_random_uuid(),
  stock_take_id uuid not null references public.stock_take (id) on delete cascade,
  item_id uuid not null references public.item (id) on delete restrict,
  -- What was counted; the ledger gets only the difference (adjustment_qty).
  counted_qty numeric not null,
  adjustment_qty numeric not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint stock_take_item_counted_check check (counted_qty >= 0),
  constraint stock_take_item_once unique (stock_take_id, item_id)
);
create index stock_take_item_item_idx on public.stock_take_item (item_id);

-- ============================================================================
-- The ledger
-- ============================================================================
create table public.item_transaction (
  id uuid primary key default gen_random_uuid(),
  reference bigint generated always as identity (start with 1) not null unique,
  transaction_type public.transaction_type not null,
  -- In pack units (signed); base_qty is the same in the item's default UOM.
  qty numeric not null,
  base_qty numeric not null,
  transaction_date timestamptz not null default now(),
  item_id uuid not null references public.item (id) on delete restrict,
  storage_area_id uuid not null references public.storage_area (id) on delete restrict,
  -- The document line that produced the row (exactly one).
  intake_item_id uuid references public.intake_item (id) on delete cascade,
  transfer_item_id uuid references public.transfer_item (id) on delete cascade,
  transfer_leg text,
  work_order_item_id uuid references public.work_order_item (id) on delete cascade,
  stock_take_item_id uuid references public.stock_take_item (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint item_transaction_one_source check (
    num_nonnulls(intake_item_id, transfer_item_id, work_order_item_id, stock_take_item_id) = 1),
  constraint item_transaction_leg_check check (
    (transfer_item_id is null) = (transfer_leg is null)
    and (transfer_leg is null or transfer_leg in ('send', 'receive')))
);
create index item_transaction_stock_idx on public.item_transaction (item_id, storage_area_id, transaction_date);
create index item_transaction_area_idx on public.item_transaction (storage_area_id);
create unique index item_transaction_intake_item_key on public.item_transaction (intake_item_id)
  where intake_item_id is not null;
create unique index item_transaction_transfer_leg_key on public.item_transaction (transfer_item_id, transfer_leg)
  where transfer_item_id is not null;
create unique index item_transaction_work_order_item_key on public.item_transaction (work_order_item_id)
  where work_order_item_id is not null;
create unique index item_transaction_stock_take_item_key on public.item_transaction (stock_take_item_id)
  where stock_take_item_id is not null;

-- StorageAreaItemStock. security_invoker: the caller's RLS on the ledger applies.
create view public.storage_area_item_stock with (security_invoker = true) as
select item_id, storage_area_id,
       sum(base_qty) as base_qty,
       sum(qty) as qty
  from public.item_transaction
 group by item_id, storage_area_id;

-- ============================================================================
-- Audit columns and numbering (from the session, never the client)
-- ============================================================================
create function public.set_stock_doc_audit_fields()
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
  if tg_table_name in ('purchase_order', 'purchase_order_item', 'load', 'intake', 'transfer_main',
                       'work_order', 'stock_take') then
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['purchase_order', 'purchase_order_item', 'load', 'intake', 'intake_item',
    'transfer_main', 'transfer_item', 'work_order', 'work_order_item', 'stock_take', 'stock_take_item']
  loop
    execute format('create trigger %1$s_audit before insert or update on public.%1$I
                    for each row execute function public.set_stock_doc_audit_fields()', t);
  end loop;
end;
$$;

-- ============================================================================
-- Purchase orders
-- ============================================================================
-- Line: keep inc/exc VAT prices in step (whichever one changed drives the other),
-- derive totals and base qty.
create function public.purchase_order_item_before()
returns trigger
language plpgsql
as $$
declare
  v_vat numeric := 1 + public.get_vat_rate();
  v_conv numeric;
begin
  if tg_op = 'INSERT' then
    if new.unit_cost_exc_vat = 0 and new.unit_cost_inc_vat <> 0 then
      new.unit_cost_exc_vat := round(new.unit_cost_inc_vat / v_vat, 4);
    else
      new.unit_cost_inc_vat := round(new.unit_cost_exc_vat * v_vat, 4);
    end if;
  elsif new.unit_cost_inc_vat is distinct from old.unit_cost_inc_vat
        and new.unit_cost_exc_vat is not distinct from old.unit_cost_exc_vat then
    new.unit_cost_exc_vat := round(new.unit_cost_inc_vat / v_vat, 4);
  else
    new.unit_cost_inc_vat := round(new.unit_cost_exc_vat * v_vat, 4);
  end if;

  new.total_cost_exc_vat := round(new.qty_ordered * new.unit_cost_exc_vat, 2);
  new.total_cost_inc_vat := round(new.qty_ordered * new.unit_cost_inc_vat, 2);

  select conversion_to_default_uom into v_conv from public.item where id = new.item_id;
  new.base_qty := new.qty_ordered * coalesce(v_conv, 0);
  new.qty_outstanding := new.qty_ordered - new.qty_received;
  -- A line closed by hand stays closed; otherwise it follows what was received.
  if new.status <> 'closed' then
    new.status := case when new.qty_received >= new.qty_ordered then 'completed' else 'new' end;
  end if;
  return new;
end;
$$;
create trigger purchase_order_item_before before insert or update on public.purchase_order_item
  for each row execute function public.purchase_order_item_before();

-- PurchaseOrder_UpdateStatus: any line new -> new; else any closed -> closed;
-- else completed. A PO with no lines is new.
create function public.purchase_order_refresh(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.po_status;
begin
  select case
           when count(*) = 0 or bool_or(status = 'new') then 'new'
           when bool_or(status = 'closed') then 'closed'
           else 'completed'
         end::public.po_status
    into v_status
    from public.purchase_order_item where purchase_order_id = p_id;

  update public.purchase_order po
     set status = v_status,
         nr_of_items = t.n,
         total_cost_exc_vat = t.exc,
         total_cost_inc_vat = t.inc
    from (select count(*)::integer as n,
                 coalesce(sum(total_cost_exc_vat), 0) as exc,
                 coalesce(sum(total_cost_inc_vat), 0) as inc
            from public.purchase_order_item where purchase_order_id = p_id) t
   where po.id = p_id
     and (po.status, po.nr_of_items, po.total_cost_exc_vat, po.total_cost_inc_vat)
         is distinct from (v_status, t.n, t.exc, t.inc);
end;
$$;
revoke execute on function public.purchase_order_refresh(uuid) from public, anon, authenticated;

create function public.purchase_order_item_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.purchase_order_refresh(coalesce(new.purchase_order_id, old.purchase_order_id));
  return null;
end;
$$;
create trigger purchase_order_item_after after insert or update or delete on public.purchase_order_item
  for each row execute function public.purchase_order_item_after();

-- Received quantity of a PO line from its intake lines; the line's before
-- trigger derives outstanding and status.
create function public.purchase_order_item_recalc(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.purchase_order_item
     set qty_received = (select coalesce(sum(qty), 0) from public.intake_item where purchase_order_item_id = p_id)
   where id = p_id;
$$;
revoke execute on function public.purchase_order_item_recalc(uuid) from public, anon, authenticated;

-- ============================================================================
-- Negative-stock guard (on the ledger)
-- ============================================================================
create function public.stock_on_hand(p_item uuid, p_area uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(qty), 0) from public.item_transaction where item_id = p_item and storage_area_id = p_area;
$$;
revoke execute on function public.stock_on_hand(uuid, uuid) from public, anon, authenticated;

create function public.item_transaction_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair record;
begin
  -- Check every (item, area) whose stock this change reduced.
  for v_pair in
    select item_id, storage_area_id from (
      select new.item_id, new.storage_area_id
       where tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.qty < old.qty
                                    or new.item_id <> old.item_id or new.storage_area_id <> old.storage_area_id)
      union
      select old.item_id, old.storage_area_id
       where tg_op <> 'INSERT' and old.qty > 0
         and (tg_op = 'DELETE' or new.item_id <> old.item_id or new.storage_area_id <> old.storage_area_id
              or new.qty < old.qty)
    ) s
  loop
    if public.stock_on_hand(v_pair.item_id, v_pair.storage_area_id) < 0 then
      raise exception 'Not enough stock: % in % would go below zero (%).',
        (select name from public.item where id = v_pair.item_id),
        (select name from public.storage_area where id = v_pair.storage_area_id),
        public.stock_on_hand(v_pair.item_id, v_pair.storage_area_id)
        using errcode = 'P0001';
    end if;
  end loop;
  return null;
end;
$$;
create constraint trigger item_transaction_guard
  after insert or update or delete on public.item_transaction
  deferrable initially deferred
  for each row execute function public.item_transaction_guard();

-- ============================================================================
-- Posting: line -> ledger
-- ============================================================================
create function public.item_conversion(p_item uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select conversion_to_default_uom from public.item where id = p_item;
$$;
-- Called from the (invoker) intake line trigger; item conversions are readable by every role anyway.
revoke execute on function public.item_conversion(uuid) from public, anon;
grant execute on function public.item_conversion(uuid) to authenticated;

-- Upsert (or delete, if p_qty is null) the ledger row for one source line.
create function public.post_ledger_row(
  p_source text, p_source_id uuid, p_leg text,
  p_type public.transaction_type, p_qty numeric, p_date timestamptz,
  p_item uuid, p_area uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base numeric;
begin
  v_base := p_qty * public.item_conversion(p_item);
  case p_source
    when 'intake' then
      insert into public.item_transaction (transaction_type, qty, base_qty, transaction_date, item_id, storage_area_id, intake_item_id)
      values (p_type, p_qty, v_base, p_date, p_item, p_area, p_source_id)
      on conflict (intake_item_id) where intake_item_id is not null
      do update set transaction_type = excluded.transaction_type, qty = excluded.qty, base_qty = excluded.base_qty,
                    transaction_date = excluded.transaction_date, item_id = excluded.item_id,
                    storage_area_id = excluded.storage_area_id;
    when 'work_order' then
      insert into public.item_transaction (transaction_type, qty, base_qty, transaction_date, item_id, storage_area_id, work_order_item_id)
      values (p_type, p_qty, v_base, p_date, p_item, p_area, p_source_id)
      on conflict (work_order_item_id) where work_order_item_id is not null
      do update set transaction_type = excluded.transaction_type, qty = excluded.qty, base_qty = excluded.base_qty,
                    transaction_date = excluded.transaction_date, item_id = excluded.item_id,
                    storage_area_id = excluded.storage_area_id;
    when 'stock_take' then
      insert into public.item_transaction (transaction_type, qty, base_qty, transaction_date, item_id, storage_area_id, stock_take_item_id)
      values (p_type, p_qty, v_base, p_date, p_item, p_area, p_source_id)
      on conflict (stock_take_item_id) where stock_take_item_id is not null
      do update set transaction_type = excluded.transaction_type, qty = excluded.qty, base_qty = excluded.base_qty,
                    transaction_date = excluded.transaction_date, item_id = excluded.item_id,
                    storage_area_id = excluded.storage_area_id;
    when 'transfer' then
      insert into public.item_transaction (transaction_type, qty, base_qty, transaction_date, item_id, storage_area_id, transfer_item_id, transfer_leg)
      values (p_type, p_qty, v_base, p_date, p_item, p_area, p_source_id, p_leg)
      on conflict (transfer_item_id, transfer_leg) where transfer_item_id is not null
      do update set transaction_type = excluded.transaction_type, qty = excluded.qty, base_qty = excluded.base_qty,
                    transaction_date = excluded.transaction_date, item_id = excluded.item_id,
                    storage_area_id = excluded.storage_area_id;
  end case;
end;
$$;
revoke execute on function public.post_ledger_row(text, uuid, text, public.transaction_type, numeric, timestamptz, uuid, uuid)
  from public, anon, authenticated;

-- --- Intakes -----------------------------------------------------------------
create function public.intake_item_before()
returns trigger
language plpgsql
as $$
declare
  v_intake public.intake;
  v_po_item public.purchase_order_item;
begin
  select * into v_intake from public.intake where id = new.intake_id;
  if new.purchase_order_item_id is not null then
    select * into v_po_item from public.purchase_order_item where id = new.purchase_order_item_id;
    if v_po_item.purchase_order_id is distinct from v_intake.purchase_order_id then
      raise exception 'That line belongs to a different purchase order.' using errcode = 'P0001';
    end if;
    new.item_id := v_po_item.item_id;
  end if;
  new.base_qty := new.qty * public.item_conversion(new.item_id);
  return new;
end;
$$;
create trigger intake_item_before before insert or update on public.intake_item
  for each row execute function public.intake_item_before();

create function public.intake_item_sync(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  select ii.id, ii.item_id, ii.qty, ii.transaction_date, i.storage_area_id, i.intake_type
    into r
    from public.intake_item ii join public.intake i on i.id = ii.intake_id
   where ii.id = p_id;
  if not found then return; end if;
  perform public.post_ledger_row('intake', r.id, null,
    case r.intake_type when 'PURCHASE_ORDER' then 'INTAKE_PURCHASE_ORDER'
                       when 'FACILITY_TRANSFER' then 'INTAKE_FACILITY'
                       else 'INTAKE_STOCK_RETURN' end::public.transaction_type,
    r.qty, r.transaction_date, r.item_id, r.storage_area_id);
end;
$$;
revoke execute on function public.intake_item_sync(uuid) from public, anon, authenticated;

create function public.intake_item_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'DELETE' then
    perform public.intake_item_sync(new.id);
  end if;
  -- PO lines the change touched (the old one too, if the line moved).
  if tg_op <> 'INSERT' and old.purchase_order_item_id is not null then
    perform public.purchase_order_item_recalc(old.purchase_order_item_id);
  end if;
  if tg_op <> 'DELETE' and new.purchase_order_item_id is not null then
    perform public.purchase_order_item_recalc(new.purchase_order_item_id);
  end if;
  return null;
end;
$$;
create trigger intake_item_after after insert or update or delete on public.intake_item
  for each row execute function public.intake_item_after();

-- Receiving area moved: re-post its lines.
create function public.intake_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select id from public.intake_item where intake_id = new.id loop
    perform public.intake_item_sync(r.id);
  end loop;
  return null;
end;
$$;
create trigger intake_after_update after update of storage_area_id on public.intake
  for each row when (old.storage_area_id is distinct from new.storage_area_id)
  execute function public.intake_after_update();

-- --- Transfers ---------------------------------------------------------------
-- Post (or remove) both legs of one line according to the header's type.
create function public.transfer_item_sync(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  select ti.id, ti.item_id, ti.qty, t.transfer_type, t.transfer_date,
         t.from_storage_area_id as from_area, t.to_storage_area_id as to_area
    into r
    from public.transfer_item ti join public.transfer_main t on t.id = ti.transfer_id
   where ti.id = p_id;
  if not found then return; end if;

  if r.transfer_type in ('SEND', 'BOTH') then
    perform public.post_ledger_row('transfer', r.id, 'send', 'STOCK_TRANSFER', -r.qty,
      r.transfer_date, r.item_id, r.from_area);
  else
    delete from public.item_transaction where transfer_item_id = r.id and transfer_leg = 'send';
  end if;
  if r.transfer_type in ('RECEIVE', 'BOTH') then
    perform public.post_ledger_row('transfer', r.id, 'receive', 'STOCK_TRANSFER', r.qty,
      r.transfer_date, r.item_id, r.to_area);
  else
    delete from public.item_transaction where transfer_item_id = r.id and transfer_leg = 'receive';
  end if;
end;
$$;
revoke execute on function public.transfer_item_sync(uuid) from public, anon, authenticated;

create function public.transfer_item_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.transfer_item_sync(new.id);
  return null;
end;
$$;
create trigger transfer_item_after after insert or update on public.transfer_item
  for each row execute function public.transfer_item_after();

-- Type, areas or date changed: re-post every line (removes legs that no longer apply).
create function public.transfer_main_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select id from public.transfer_item where transfer_id = new.id loop
    perform public.transfer_item_sync(r.id);
  end loop;
  return null;
end;
$$;
create trigger transfer_main_after_update after update on public.transfer_main
  for each row when (old.transfer_type is distinct from new.transfer_type
                     or old.transfer_date is distinct from new.transfer_date
                     or old.from_storage_area_id is distinct from new.from_storage_area_id
                     or old.to_storage_area_id is distinct from new.to_storage_area_id)
  execute function public.transfer_main_after_update();

-- --- Work orders ---------------------------------------------------------------
create function public.work_order_item_before()
returns trigger
language plpgsql
as $$
begin
  if new.transaction_date > now() + interval '1 minute' then
    raise exception 'The date can''t be in the future.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger work_order_item_before before insert or update on public.work_order_item
  for each row execute function public.work_order_item_before();

create function public.work_order_item_sync(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  select wi.id, wi.item_id, wi.qty, wi.is_return, wi.transaction_date, w.storage_area_id
    into r
    from public.work_order_item wi join public.work_order w on w.id = wi.work_order_id
   where wi.id = p_id;
  if not found then return; end if;
  perform public.post_ledger_row('work_order', r.id, null,
    case when r.is_return then 'WORK_ORDER_RETURN' else 'WORK_ORDER_USAGE' end::public.transaction_type,
    case when r.is_return then r.qty else -r.qty end,
    r.transaction_date, r.item_id, r.storage_area_id);
end;
$$;
revoke execute on function public.work_order_item_sync(uuid) from public, anon, authenticated;

create function public.work_order_item_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.work_order_item_sync(new.id);
  return null;
end;
$$;
create trigger work_order_item_after after insert or update on public.work_order_item
  for each row execute function public.work_order_item_after();

create function public.work_order_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select id from public.work_order_item where work_order_id = new.id loop
    perform public.work_order_item_sync(r.id);
  end loop;
  return null;
end;
$$;
create trigger work_order_after_update after update of storage_area_id on public.work_order
  for each row when (old.storage_area_id is distinct from new.storage_area_id)
  execute function public.work_order_after_update();

-- --- Stock takes ---------------------------------------------------------------
-- adjustment = count - ledger total up to the stock take date, excluding this
-- line's own row so a re-save starts from the count, not from the adjustment.
create function public.stock_take_item_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_take public.stock_take;
  v_ledger numeric;
begin
  select * into v_take from public.stock_take where id = new.stock_take_id;
  select coalesce(sum(qty), 0) into v_ledger
    from public.item_transaction
   where item_id = new.item_id
     and storage_area_id = v_take.storage_area_id
     and transaction_date <= v_take.take_date
     and stock_take_item_id is distinct from new.id;
  new.adjustment_qty := new.counted_qty - v_ledger;
  return new;
end;
$$;
create trigger stock_take_item_before before insert or update on public.stock_take_item
  for each row execute function public.stock_take_item_before();

create function public.stock_take_item_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_take public.stock_take;
begin
  select * into v_take from public.stock_take where id = new.stock_take_id;
  perform public.post_ledger_row('stock_take', new.id, null, 'STOCK_ADJUSTMENT', new.adjustment_qty,
    v_take.take_date, new.item_id, v_take.storage_area_id);
  return null;
end;
$$;
create trigger stock_take_item_after after insert or update on public.stock_take_item
  for each row execute function public.stock_take_item_after();

-- Date or area changed: recount every line against the new basis.
create function public.stock_take_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.stock_take_item set counted_qty = counted_qty where stock_take_id = new.id;
  return null;
end;
$$;
create trigger stock_take_after_update after update of take_date, storage_area_id on public.stock_take
  for each row when (old.take_date is distinct from new.take_date
                     or old.storage_area_id is distinct from new.storage_area_id)
  execute function public.stock_take_after_update();

-- ============================================================================
-- Storage: private bucket `stock-documents` (delivery notes, invoices)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('stock-documents', 'stock-documents', false, 26214400)
on conflict (id) do nothing;

create policy stock_documents_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'stock-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_stock_receiver()
  );
create policy stock_documents_select on storage.objects for select
  to authenticated
  using (bucket_id = 'stock-documents' and public.is_stock_receiver());
create policy stock_documents_delete on storage.objects for delete
  to authenticated
  using (bucket_id = 'stock-documents' and public.is_stock_receiver());

-- ============================================================================
-- RLS (spec: Security)
-- ============================================================================
alter table public.purchase_order enable row level security;
alter table public.purchase_order_item enable row level security;
alter table public.load enable row level security;
alter table public.intake enable row level security;
alter table public.intake_item enable row level security;
alter table public.stock_document enable row level security;
alter table public.transfer_main enable row level security;
alter table public.transfer_item enable row level security;
alter table public.work_order enable row level security;
alter table public.work_order_item enable row level security;
alter table public.stock_take enable row level security;
alter table public.stock_take_item enable row level security;
alter table public.item_transaction enable row level security;

-- Ledger: everyone reads; rows are written only by the posting triggers.
create policy item_transaction_select on public.item_transaction for select to authenticated
  using (public.is_stock_reader());

-- Purchase orders: admins full; user edits (no create/delete) and edits lines (no create).
create policy purchase_order_select on public.purchase_order for select to authenticated using (public.is_stock_reader());
create policy purchase_order_insert on public.purchase_order for insert to authenticated with check (public.is_stock_admin());
create policy purchase_order_update on public.purchase_order for update to authenticated
  using (public.is_stock_writer()) with check (public.is_stock_writer());
create policy purchase_order_delete on public.purchase_order for delete to authenticated using (public.is_stock_admin());
create policy purchase_order_item_select on public.purchase_order_item for select to authenticated using (public.is_stock_reader());
create policy purchase_order_item_insert on public.purchase_order_item for insert to authenticated with check (public.is_stock_admin());
create policy purchase_order_item_update on public.purchase_order_item for update to authenticated
  using (public.is_stock_writer()) with check (public.is_stock_writer());
create policy purchase_order_item_delete on public.purchase_order_item for delete to authenticated using (public.is_stock_admin());

-- Receiving: system_admin only.
create policy load_all on public.load for all to authenticated
  using (public.is_stock_receiver()) with check (public.is_stock_receiver());
create policy intake_all on public.intake for all to authenticated
  using (public.is_stock_receiver()) with check (public.is_stock_receiver());
create policy intake_item_all on public.intake_item for all to authenticated
  using (public.is_stock_receiver()) with check (public.is_stock_receiver());
create policy stock_document_all on public.stock_document for all to authenticated
  using (public.is_stock_receiver())
  with check (public.is_stock_receiver() and split_part(storage_path, '/', 1) = auth.uid()::text);

-- Transfers, work orders, stock takes: admins full, user create and edit (no delete), viewer read where stated.
create policy transfer_main_select on public.transfer_main for select to authenticated using (public.is_stock_writer());
create policy transfer_main_insert on public.transfer_main for insert to authenticated with check (public.is_stock_writer());
create policy transfer_main_update on public.transfer_main for update to authenticated
  using (public.is_stock_writer()) with check (public.is_stock_writer());
create policy transfer_main_delete on public.transfer_main for delete to authenticated using (public.is_stock_admin());
create policy transfer_item_select on public.transfer_item for select to authenticated using (public.is_stock_writer());
create policy transfer_item_insert on public.transfer_item for insert to authenticated with check (public.is_stock_writer());
create policy transfer_item_update on public.transfer_item for update to authenticated
  using (public.is_stock_writer()) with check (public.is_stock_writer());
create policy transfer_item_delete on public.transfer_item for delete to authenticated using (public.is_stock_admin());

create policy work_order_select on public.work_order for select to authenticated using (public.is_stock_reader());
create policy work_order_insert on public.work_order for insert to authenticated with check (public.is_stock_writer());
create policy work_order_update on public.work_order for update to authenticated
  using (public.is_stock_writer()) with check (public.is_stock_writer());
create policy work_order_delete on public.work_order for delete to authenticated using (public.is_stock_admin());
create policy work_order_item_select on public.work_order_item for select to authenticated using (public.is_stock_reader());
create policy work_order_item_insert on public.work_order_item for insert to authenticated with check (public.is_stock_writer());
create policy work_order_item_update on public.work_order_item for update to authenticated
  using (public.is_stock_writer()) with check (public.is_stock_writer());
create policy work_order_item_delete on public.work_order_item for delete to authenticated using (public.is_stock_admin());

create policy stock_take_select on public.stock_take for select to authenticated using (public.is_stock_reader());
create policy stock_take_insert on public.stock_take for insert to authenticated with check (public.is_stock_writer());
create policy stock_take_update on public.stock_take for update to authenticated
  using (public.is_stock_writer()) with check (public.is_stock_writer());
create policy stock_take_delete on public.stock_take for delete to authenticated using (public.is_stock_admin());
create policy stock_take_item_select on public.stock_take_item for select to authenticated using (public.is_stock_reader());
create policy stock_take_item_insert on public.stock_take_item for insert to authenticated with check (public.is_stock_writer());
create policy stock_take_item_update on public.stock_take_item for update to authenticated
  using (public.is_stock_writer()) with check (public.is_stock_writer());
create policy stock_take_item_delete on public.stock_take_item for delete to authenticated using (public.is_stock_admin());

-- Derived and numbering columns are not writable by clients.
revoke insert, update on public.purchase_order, public.purchase_order_item, public.load, public.intake,
  public.intake_item, public.transfer_main, public.transfer_item, public.work_order, public.work_order_item,
  public.stock_take, public.stock_take_item, public.stock_document from anon, authenticated;
revoke insert, update, delete on public.item_transaction from anon, authenticated;

grant insert (order_date, order_alias, comment, supplier_id) on public.purchase_order to authenticated;
grant update (order_date, order_alias, comment, supplier_id) on public.purchase_order to authenticated;
grant insert (purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, unit_cost_inc_vat, eta, status)
  on public.purchase_order_item to authenticated;
grant update (item_id, qty_ordered, unit_cost_exc_vat, unit_cost_inc_vat, eta, status)
  on public.purchase_order_item to authenticated;
grant insert (load_type, load_date, comment) on public.load to authenticated;
grant update (load_date, comment) on public.load to authenticated;
grant insert (intake_type, load_id, storage_area_id, supplier_id, purchase_order_id, comment) on public.intake to authenticated;
grant update (storage_area_id, supplier_id, comment) on public.intake to authenticated;
grant insert (intake_id, item_id, purchase_order_item_id, qty, transaction_date) on public.intake_item to authenticated;
grant update (qty, transaction_date) on public.intake_item to authenticated;
grant insert (load_id, intake_id, name, storage_path, mime_type, size_bytes) on public.stock_document to authenticated;
grant insert (transfer_type, transfer_date, from_storage_area_id, to_storage_area_id, comment) on public.transfer_main to authenticated;
grant update (transfer_type, transfer_date, from_storage_area_id, to_storage_area_id, comment) on public.transfer_main to authenticated;
grant insert (transfer_id, item_id, qty) on public.transfer_item to authenticated;
grant update (item_id, qty) on public.transfer_item to authenticated;
grant insert (order_date, storage_area_id, comment) on public.work_order to authenticated;
grant update (order_date, storage_area_id, comment) on public.work_order to authenticated;
grant insert (work_order_id, item_id, qty, is_return, transaction_date) on public.work_order_item to authenticated;
grant update (item_id, qty, is_return, transaction_date) on public.work_order_item to authenticated;
grant insert (take_date, storage_area_id, comment) on public.stock_take to authenticated;
grant update (take_date, storage_area_id, comment) on public.stock_take to authenticated;
grant insert (stock_take_id, item_id, counted_qty) on public.stock_take_item to authenticated;
grant update (item_id, counted_qty) on public.stock_take_item to authenticated;
