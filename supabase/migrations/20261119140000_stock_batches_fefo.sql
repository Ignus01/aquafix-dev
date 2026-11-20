-- Batch tracking for MWTS (19–20 Nov 2026, Dylan: "for both" cost and
-- traceability; batch number and expiry captured when stock is received;
-- batches decided when a movement is saved, as stock systems usually do).
--
-- Every receipt line is a batch (stock_lot): its PO line, unit cost, date
-- received, batch number and expiry. Every ledger row is split over the
-- batches it moved (stock_allocation), decided once, when the row is saved:
--   * a receipt puts its own batch into the storage area;
--   * a transfer's receive leg brings in exactly the batches its send leg
--     took out, so a batch keeps its origin from kit to kit;
--   * anything that takes stock out (usage, a send, a stock-take shortfall)
--     takes, from what the storage area holds at that moment, the batch
--     that expires first, then the oldest received (the newest received for
--     an item set to LIFO);
--   * stock that appears without a receipt (a stock-take surplus, a return
--     to stock, a manual receive with no send) gets its own batch with no
--     PO, valued at the item's latest real price received before it (else
--     the first one after it). A receipt with no price (no PO line, or a PO
--     line priced 0 as some older lines are) is valued the same way.
-- A choice is never revisited because of other movements: a late phone sync
-- or a back-dated document takes from what is there when it arrives. Only a
-- change to the row itself (its quantity or storage area) re-decides that
-- one row. Deleting a receipt whose batch was already moved on leaves those
-- later movements untraced (lot_id null) rather than changing them.
--
-- Value is qty × the batch's unit cost, read at query time, so correcting a
-- PO line's price flows through to everything that used it.
--
-- storage_area_stock.next_expiry: the earliest expiry still on hand per item
-- and storage area, for the phone's "expires" warning.

-- ============================================================================
-- Batch number and expiry on receipt lines
-- ============================================================================
alter table public.intake_item
  add column batch_number text,
  add column expiry_date date;
grant insert (batch_number, expiry_date) on public.intake_item to authenticated;
grant update (batch_number, expiry_date) on public.intake_item to authenticated;

-- ============================================================================
-- Batches and allocations
-- ============================================================================
create table public.stock_lot (
  id uuid primary key default gen_random_uuid(),
  reference bigint generated always as identity (start with 1) not null unique,
  item_id uuid not null references public.item (id) on delete cascade,
  source text not null,
  intake_item_id uuid unique references public.intake_item (id) on delete cascade,
  item_transaction_id uuid unique references public.item_transaction (id) on delete cascade,
  purchase_order_item_id uuid references public.purchase_order_item (id) on delete set null,
  received_at timestamptz not null,
  batch_number text,
  expiry_date date,
  unit_cost_exc_vat numeric(15, 4),
  constraint stock_lot_source_check check (source in ('INTAKE', 'ADJUSTMENT', 'RETURN', 'UNTRACED')),
  constraint stock_lot_one_origin check (num_nonnulls(intake_item_id, item_transaction_id) = 1)
);
create index stock_lot_item_idx on public.stock_lot (item_id);
create index stock_lot_po_item_idx on public.stock_lot (purchase_order_item_id);

create table public.stock_allocation (
  id uuid primary key default gen_random_uuid(),
  item_transaction_id uuid not null references public.item_transaction (id) on delete cascade,
  -- null: untraced (the batch was deleted, or more went out than the
  -- batches held).
  lot_id uuid references public.stock_lot (id) on delete set null,
  item_id uuid not null references public.item (id) on delete cascade,
  storage_area_id uuid not null references public.storage_area (id) on delete cascade,
  qty numeric not null           -- signed, like the ledger row
);
create index stock_allocation_tx_idx on public.stock_allocation (item_transaction_id);
create index stock_allocation_item_area_idx on public.stock_allocation (item_id, storage_area_id);
create index stock_allocation_lot_idx on public.stock_allocation (lot_id);

alter table public.stock_lot enable row level security;
alter table public.stock_allocation enable row level security;
create policy stock_lot_select on public.stock_lot for select to authenticated using (public.is_stock_reader());
create policy stock_allocation_select on public.stock_allocation for select to authenticated using (public.is_stock_reader());
revoke insert, update, delete on public.stock_lot, public.stock_allocation from anon, authenticated;

-- Batch balances per storage area, valued at the batch's cost.
create view public.stock_lot_balance with (security_invoker = true) as
select a.lot_id, a.item_id, a.storage_area_id, sum(a.qty) as qty,
       round(sum(a.qty) * l.unit_cost_exc_vat, 2) as value_exc_vat
  from public.stock_allocation a
  join public.stock_lot l on l.id = a.lot_id
 group by a.lot_id, a.item_id, a.storage_area_id, l.unit_cost_exc_vat;

alter table public.storage_area_stock add column next_expiry date;

-- ============================================================================
-- Deciding one ledger row's batches
-- ============================================================================
-- The earliest expiry of the batches still in one storage area.
create function public.stock_next_expiry_refresh(p_item uuid, p_area uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.storage_area_stock s
     set next_expiry = (
       select min(x.expiry_date) from (
         select l.expiry_date
           from public.stock_allocation a join public.stock_lot l on l.id = a.lot_id
          where a.item_id = p_item and a.storage_area_id = p_area and l.expiry_date is not null
          group by a.lot_id, l.expiry_date
         having sum(a.qty) > 0) x)
   where s.item_id = p_item and s.storage_area_id = p_area;
$$;
revoke execute on function public.stock_next_expiry_refresh(uuid, uuid) from public, anon, authenticated;

-- The price for stock that came in without one (no PO line, a PO line
-- priced 0 as some older lines are, a return, stock found by a count): the
-- latest real price received before it, else the first one after it.
create function public.stock_fallback_cost(p_item uuid, p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select l.unit_cost_exc_vat from public.stock_lot l
      where l.item_id = p_item and l.source = 'INTAKE' and l.unit_cost_exc_vat > 0 and l.received_at <= p_at
      order by l.received_at desc, l.reference desc limit 1),
    (select l.unit_cost_exc_vat from public.stock_lot l
      where l.item_id = p_item and l.source = 'INTAKE' and l.unit_cost_exc_vat > 0 and l.received_at > p_at
      order by l.received_at, l.reference limit 1));
$$;
revoke execute on function public.stock_fallback_cost(uuid, timestamptz) from public, anon, authenticated;

create function public.stock_allocate(p_tx uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.item_transaction;
  b record;
  v_lifo boolean;
  v_lot uuid;
  v_cost numeric;
  v_need numeric;
  v_take numeric;
  v_receive uuid;
begin
  select * into r from public.item_transaction where id = p_tx;
  if not found then return; end if;
  -- One decision at a time per item and storage area.
  perform pg_advisory_xact_lock(hashtextextended('stock_lot:' || r.item_id::text || ':' || r.storage_area_id::text, 0));
  delete from public.stock_allocation where item_transaction_id = p_tx;

  if r.qty > 0 and r.intake_item_id is not null then
    -- A receipt: its own batch.
    insert into public.stock_lot (item_id, source, intake_item_id, purchase_order_item_id, received_at,
                                  batch_number, expiry_date, unit_cost_exc_vat)
    select ii.item_id, 'INTAKE', ii.id, ii.purchase_order_item_id, ii.transaction_date,
           ii.batch_number, ii.expiry_date,
           coalesce(nullif(poi.unit_cost_exc_vat, 0), public.stock_fallback_cost(ii.item_id, ii.transaction_date))
      from public.intake_item ii
      left join public.purchase_order_item poi on poi.id = ii.purchase_order_item_id
     where ii.id = r.intake_item_id
    on conflict (intake_item_id) do update
      set received_at = excluded.received_at, purchase_order_item_id = excluded.purchase_order_item_id
    returning id into v_lot;
    insert into public.stock_allocation (item_transaction_id, lot_id, item_id, storage_area_id, qty)
    values (p_tx, v_lot, r.item_id, r.storage_area_id, r.qty);

  elsif r.qty > 0 and r.transfer_leg = 'receive' and exists (
          select 1 from public.item_transaction s
           where s.transfer_item_id = r.transfer_item_id and s.transfer_leg = 'send') then
    -- A transfer's receive leg: the batches its send leg took out.
    insert into public.stock_allocation (item_transaction_id, lot_id, item_id, storage_area_id, qty)
    select p_tx, a.lot_id, r.item_id, r.storage_area_id, -a.qty
      from public.stock_allocation a join public.item_transaction s on s.id = a.item_transaction_id
     where s.transfer_item_id = r.transfer_item_id and s.transfer_leg = 'send';

  elsif r.qty > 0 then
    -- Stock with no receipt: its own batch at the latest price received.
    v_cost := public.stock_fallback_cost(r.item_id, r.transaction_date);
    insert into public.stock_lot (item_id, source, item_transaction_id, received_at, unit_cost_exc_vat)
    values (r.item_id,
            case r.transaction_type when 'STOCK_ADJUSTMENT' then 'ADJUSTMENT'
                                    when 'WORK_ORDER_RETURN' then 'RETURN'
                                    else 'UNTRACED' end,
            p_tx, r.transaction_date, v_cost)
    on conflict (item_transaction_id) do update
      set source = excluded.source, received_at = excluded.received_at
    returning id into v_lot;
    insert into public.stock_allocation (item_transaction_id, lot_id, item_id, storage_area_id, qty)
    values (p_tx, v_lot, r.item_id, r.storage_area_id, r.qty);

  elsif r.qty < 0 then
    -- Taking stock out: from what is there now, expiring first.
    select item_tracking_method = 'LIFO' into v_lifo from public.item where id = r.item_id;
    v_need := -r.qty;
    for b in
      select a.lot_id, sum(a.qty) as bal
        from public.stock_allocation a join public.stock_lot l on l.id = a.lot_id
       where a.item_id = r.item_id and a.storage_area_id = r.storage_area_id
       group by a.lot_id, l.expiry_date, l.received_at, l.reference
      having sum(a.qty) > 0
       order by l.expiry_date nulls last,
                case when v_lifo then null else l.received_at end,
                case when v_lifo then l.received_at end desc,
                l.reference
    loop
      exit when v_need <= 0;
      v_take := least(v_need, b.bal);
      insert into public.stock_allocation (item_transaction_id, lot_id, item_id, storage_area_id, qty)
      values (p_tx, b.lot_id, r.item_id, r.storage_area_id, -v_take);
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then
      insert into public.stock_allocation (item_transaction_id, lot_id, item_id, storage_area_id, qty)
      values (p_tx, null, r.item_id, r.storage_area_id, -v_need);
    end if;
  end if;

  -- A row that no longer brings stock in has no batch of its own.
  if r.qty <= 0 then
    delete from public.stock_lot where item_transaction_id = p_tx;
  end if;

  perform public.stock_next_expiry_refresh(r.item_id, r.storage_area_id);

  -- A send leg decided again: its receive leg carries the same batches.
  if r.transfer_leg = 'send' then
    for v_receive in
      select id from public.item_transaction where transfer_item_id = r.transfer_item_id and transfer_leg = 'receive'
    loop
      perform public.stock_allocate(v_receive);
    end loop;
  end if;
end;
$$;
revoke execute on function public.stock_allocate(uuid) from public, anon, authenticated;

-- After storage_area_stock moved (trigger names fire in alphabetical order:
-- item_transaction_on_hand, then this).
create function public.item_transaction_tracking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.stock_allocate(new.id);
  elsif tg_op = 'UPDATE' then
    -- Only a change to the row itself re-decides it (a new base_qty factor doesn't).
    if new.qty is distinct from old.qty or new.item_id is distinct from old.item_id
       or new.storage_area_id is distinct from old.storage_area_id then
      perform public.stock_allocate(new.id);
      if new.item_id is distinct from old.item_id or new.storage_area_id is distinct from old.storage_area_id then
        perform public.stock_next_expiry_refresh(old.item_id, old.storage_area_id);
      end if;
    end if;
  else
    -- Its allocations went with it (cascade).
    perform public.stock_next_expiry_refresh(old.item_id, old.storage_area_id);
  end if;
  return null;
end;
$$;
create trigger item_transaction_tracking
  after insert or update or delete on public.item_transaction
  for each row execute function public.item_transaction_tracking();

-- A batch's number or expiry, or its PO line's price, corrected: the batch
-- changes; nothing is re-decided. Value follows the price (read at query
-- time); the order future movements take batches in follows the expiry.
create function public.intake_item_batch_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_area uuid;
begin
  update public.stock_lot
     set batch_number = new.batch_number, expiry_date = new.expiry_date
   where intake_item_id = new.id;
  for v_area in
    select distinct a.storage_area_id from public.stock_allocation a join public.stock_lot l on l.id = a.lot_id
     where l.intake_item_id = new.id
  loop
    perform public.stock_next_expiry_refresh(new.item_id, v_area);
  end loop;
  return null;
end;
$$;
create trigger intake_item_batch_changed
  after update of batch_number, expiry_date on public.intake_item
  for each row when (old.batch_number is distinct from new.batch_number or old.expiry_date is distinct from new.expiry_date)
  execute function public.intake_item_batch_changed();

create function public.purchase_order_item_cost_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.stock_lot set unit_cost_exc_vat = new.unit_cost_exc_vat
   where purchase_order_item_id = new.id and source = 'INTAKE';
  return null;
end;
$$;
create trigger purchase_order_item_cost_changed
  after update of unit_cost_exc_vat on public.purchase_order_item
  for each row when (old.unit_cost_exc_vat is distinct from new.unit_cost_exc_vat)
  execute function public.purchase_order_item_cost_changed();

-- ============================================================================
-- receive_purchase_order (20261119120000) with batch_number and expiry_date
-- on each line. Everything else is unchanged.
-- ============================================================================
create or replace function public.receive_purchase_order(p jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_command_id uuid := nullif(p ->> 'command_id', '')::uuid;
  v_captured_at timestamptz := nullif(p ->> 'captured_at', '')::timestamptz;
  v_when timestamptz;
  v_stored jsonb;
  v_po public.purchase_order;
  v_area uuid;
  v_load_id uuid;
  v_intake_id uuid;
  v_load_ref bigint;
  v_intake_ref bigint;
  v_lines jsonb := coalesce(p -> 'lines', '[]'::jsonb);
  v_docs jsonb := coalesce(p -> 'documents', '[]'::jsonb);
  v_line jsonb;
  v_n integer := 0;
  v_received integer := 0;
  v_po_item public.purchase_order_item;
  v_constraint text;
begin
  v_stored := public.client_command_result(v_command_id, 'receive_purchase_order');
  if v_stored is not null then
    return v_stored;
  end if;
  perform public.assert_captured_at(v_captured_at);
  v_when := coalesce(v_captured_at, now());

  if not public.is_stock_receiver() then
    raise exception using errcode = '42501', message = 'You don''t have permission to receive stock.';
  end if;

  begin
    select * into v_po from public.purchase_order where id = nullif(p ->> 'purchase_order_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'That purchase order doesn''t exist.';
  end;
  if v_po.id is null then
    raise exception using errcode = 'P0001', message = 'That purchase order doesn''t exist.';
  end if;
  if v_po.status <> 'new' then
    raise exception using errcode = 'P0001',
      message = format('Purchase order PO-%s is no longer open.', lpad(v_po.reference::text, 5, '0'));
  end if;

  v_area := coalesce(nullif(p ->> 'storage_area_id', '')::uuid, v_po.deliver_to_area_id);
  if v_area is null then
    raise exception using errcode = 'P0001', message = 'Choose the storage area it goes into.';
  end if;

  if jsonb_typeof(v_lines) <> 'array' or jsonb_typeof(v_docs) <> 'array' then
    raise exception using errcode = 'P0001', message = 'The lines and documents must be lists.';
  end if;

  -- Lines first, so a bad line is reported before anything is written.
  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    v_n := v_n + 1;
    if jsonb_typeof(v_line) <> 'object' or nullif(v_line ->> 'purchase_order_item_id', '') is null then
      raise exception using errcode = 'P0001', message = format('Line %s is not valid.', v_n);
    end if;
    select * into v_po_item from public.purchase_order_item
     where id = (v_line ->> 'purchase_order_item_id')::uuid and purchase_order_id = v_po.id;
    if not found then
      raise exception using errcode = 'P0001', message = format('Line %s is not on this purchase order.', v_n);
    end if;
    if public.stock_doc_number(v_line ->> 'qty', format('Line %s: Qty', v_n)) < 0 then
      raise exception using errcode = 'P0001', message = format('Line %s: Qty can''t be negative.', v_n);
    end if;
    if nullif(btrim(coalesce(v_line ->> 'expiry_date', '')), '') is not null then
      begin
        perform (v_line ->> 'expiry_date')::date;
      exception when others then
        raise exception using errcode = 'P0001', message = format('Line %s: the expiry date isn''t a valid date.', v_n);
      end;
    end if;
    if (v_line ->> 'qty')::numeric > 0 then
      v_received := v_received + 1;
    end if;
  end loop;
  if v_received = 0 then
    raise exception using errcode = 'P0001', message = 'Enter a quantity for at least one line.';
  end if;

  begin
    v_load_id := coalesce(nullif(p ->> 'load_id', '')::uuid, gen_random_uuid());
    v_intake_id := coalesce(nullif(p ->> 'intake_id', '')::uuid, gen_random_uuid());

    insert into public.load (id, load_type, load_date, driver, vehicle_reg_nr)
    values (v_load_id, 'INTAKE', (v_when at time zone public.app_time_zone())::date,
            p ->> 'driver', p ->> 'vehicle_reg_nr')
    returning reference into v_load_ref;

    insert into public.intake (id, intake_type, load_id, storage_area_id, supplier_id, purchase_order_id,
                               intake_date, delivery_note, invoice_number, comment)
    values (v_intake_id, 'PURCHASE_ORDER', v_load_id, v_area, v_po.supplier_id, v_po.id,
            v_when, p ->> 'delivery_note', p ->> 'invoice_number',
            nullif(btrim(coalesce(p ->> 'comment', '')), ''))
    returning reference into v_intake_ref;

    insert into public.intake_item (id, intake_id, item_id, purchase_order_item_id, qty, transaction_date,
                                    batch_number, expiry_date)
    select coalesce(nullif(l ->> 'id', '')::uuid, gen_random_uuid()), v_intake_id, poi.item_id, poi.id,
           (l ->> 'qty')::numeric, v_when,
           nullif(btrim(coalesce(l ->> 'batch_number', '')), ''),
           nullif(btrim(coalesce(l ->> 'expiry_date', '')), '')::date
      from jsonb_array_elements(v_lines) with ordinality as t(l, n)
      join public.purchase_order_item poi on poi.id = (l ->> 'purchase_order_item_id')::uuid
     where (l ->> 'qty')::numeric > 0
     order by n;

    insert into public.stock_document (intake_id, name, storage_path, mime_type, size_bytes)
    select v_intake_id, d ->> 'name', d ->> 'storage_path', nullif(d ->> 'mime_type', ''), (d ->> 'size_bytes')::bigint
      from jsonb_array_elements(v_docs) as t(d);

    set constraints public.item_transaction_guard immediate;
    set constraints public.item_transaction_guard deferred;
  exception
    when insufficient_privilege then
      raise exception using errcode = '42501', message = 'You don''t have permission to receive stock.';
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'intake_item_po_line_once' then
        raise exception using errcode = 'P0001', message = 'Each line can only be received once per delivery.';
      end if;
      raise exception using errcode = 'P0001', message = 'This delivery, or one of its lines, was already saved.';
    when foreign_key_violation then
      raise exception using errcode = 'P0001',
        message = 'A storage area or item on this form no longer exists — reload and try again.';
    when check_violation then
      raise exception using errcode = 'P0001', message = 'One of the values doesn''t meet the required constraints.';
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
      or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = 'One of the values on this form isn''t valid.';
  end;

  return public.client_command_store(v_command_id, 'receive_purchase_order',
    jsonb_build_object(
      'load_id', v_load_id, 'load_reference', v_load_ref,
      'intake_id', v_intake_id, 'intake_reference', v_intake_ref,
      'purchase_order_status', (select status from public.purchase_order where id = v_po.id)));
end;
$$;

-- ============================================================================
-- Backfill: decide the existing ledger's batches in the order the rows were
-- saved (reference), as new rows are decided when they are saved. In date
-- order, usage entered late with an earlier date ran ahead of the stock that
-- was there when it was saved and ended up untraced (dry run: 2.7% of all
-- stock taken out); in save order the negative-stock check guarantees the
-- stock was there.
-- ============================================================================
do $$
declare
  v_tx uuid;
begin
  for v_tx in select id from public.item_transaction order by reference loop
    perform public.stock_allocate(v_tx);
  end loop;
end;
$$;
