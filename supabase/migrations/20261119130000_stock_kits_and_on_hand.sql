-- MWTS stock distribution (19 Nov 2026, Dylan): stock goes from a collection
-- straight into technicians' kits (the MWTS store is optional), so the field
-- app needs to know whose kit is whose and how much is in each storage area,
-- offline too.
--
--   * storage_area.technician_user_id: the technician a kit belongs to. One
--     kit per technician; stores (MWTS store, WPS store) have none.
--   * storage_area_stock: stock on hand per item and storage area as a real
--     table, kept by a trigger on the ledger, so PowerSync can sync it (it
--     can't replicate the storage_area_item_stock view). The ledger stays the
--     single source: this table is only ever its running sum.

-- ============================================================================
-- Kits
-- ============================================================================
alter table public.storage_area
  add column technician_user_id uuid references auth.users (id) on delete set null;
create unique index storage_area_one_kit_per_technician on public.storage_area (technician_user_id)
  where technician_user_id is not null;

-- ============================================================================
-- Stock on hand
-- ============================================================================
create table public.storage_area_stock (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.item (id) on delete cascade,
  storage_area_id uuid not null references public.storage_area (id) on delete cascade,
  qty numeric not null default 0,
  base_qty numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint storage_area_stock_key unique (item_id, storage_area_id)
);
create index storage_area_stock_area_idx on public.storage_area_stock (storage_area_id);

alter table public.storage_area_stock enable row level security;
create policy storage_area_stock_select on public.storage_area_stock for select to authenticated
  using (public.is_stock_reader());
revoke insert, update, delete on public.storage_area_stock from anon, authenticated;

-- Add (or take away) one ledger row's quantities.
create function public.storage_area_stock_add(p_item uuid, p_area uuid, p_qty numeric, p_base numeric)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.storage_area_stock (item_id, storage_area_id, qty, base_qty)
  values (p_item, p_area, p_qty, p_base)
  on conflict (item_id, storage_area_id)
  do update set qty = storage_area_stock.qty + excluded.qty,
                base_qty = storage_area_stock.base_qty + excluded.base_qty,
                updated_at = now();
$$;
revoke execute on function public.storage_area_stock_add(uuid, uuid, numeric, numeric) from public, anon, authenticated;

create function public.item_transaction_on_hand()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.storage_area_stock_add(old.item_id, old.storage_area_id, -old.qty, -old.base_qty);
  end if;
  if tg_op <> 'DELETE' then
    perform public.storage_area_stock_add(new.item_id, new.storage_area_id, new.qty, new.base_qty);
  end if;
  return null;
end;
$$;
create trigger item_transaction_on_hand
  after insert or update or delete on public.item_transaction
  for each row execute function public.item_transaction_on_hand();

-- Backfill from the ledger.
insert into public.storage_area_stock (item_id, storage_area_id, qty, base_qty)
select item_id, storage_area_id, sum(qty), sum(base_qty)
  from public.item_transaction
 group by item_id, storage_area_id;

-- ============================================================================
-- PowerSync: stream stock_on_hand (powersync/sync-config.yaml)
-- ============================================================================
grant select on public.storage_area_stock to powersync_role;
alter publication powersync add table public.storage_area_stock;
