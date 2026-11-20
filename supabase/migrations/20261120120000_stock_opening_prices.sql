-- MWTS stock: opening stock prices.
--
-- The first stock count of a storage area is its opening stock. A counted
-- line can now carry a unit price (estimated or exact), a batch number and
-- an expiry date. When the count is more than the system holds, the surplus
-- becomes a batch at that price, so stock used later is costed at it.
-- Without a price the surplus is valued at the latest cost received before
-- it, as before. A shortfall takes stock out like any other use.

alter table public.stock_take_item
  add column unit_cost_exc_vat numeric(15, 4),
  add column batch_number text,
  add column expiry_date date,
  add constraint stock_take_item_unit_cost_check check (unit_cost_exc_vat is null or unit_cost_exc_vat >= 0);

grant insert (unit_cost_exc_vat, batch_number, expiry_date) on public.stock_take_item to authenticated;
grant update (unit_cost_exc_vat, batch_number, expiry_date) on public.stock_take_item to authenticated;

create or replace function public.stock_allocate(p_tx uuid)
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
  v_batch text;
  v_expiry date;
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
           ii.batch_number, ii.expiry_date, poi.unit_cost_exc_vat
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
    -- Stock with no receipt: its own batch. A stock take line can give the
    -- price, batch and expiry (opening stock); otherwise the latest cost
    -- received before it.
    v_cost := null; v_batch := null; v_expiry := null;
    if r.stock_take_item_id is not null then
      select unit_cost_exc_vat, batch_number, expiry_date into v_cost, v_batch, v_expiry
        from public.stock_take_item where id = r.stock_take_item_id;
    end if;
    if v_cost is null then
      select unit_cost_exc_vat into v_cost
        from public.stock_lot
       where item_id = r.item_id and source = 'INTAKE' and received_at <= r.transaction_date
       order by received_at desc, reference desc
       limit 1;
    end if;
    insert into public.stock_lot (item_id, source, item_transaction_id, received_at,
                                  batch_number, expiry_date, unit_cost_exc_vat)
    values (r.item_id,
            case r.transaction_type when 'STOCK_ADJUSTMENT' then 'ADJUSTMENT'
                                    when 'WORK_ORDER_RETURN' then 'RETURN'
                                    else 'UNTRACED' end,
            p_tx, r.transaction_date, v_batch, v_expiry, v_cost)
    on conflict (item_transaction_id) do update
      set source = excluded.source, received_at = excluded.received_at,
          batch_number = excluded.batch_number, expiry_date = excluded.expiry_date,
          -- A counted price always wins; otherwise the cost first given stays.
          unit_cost_exc_vat = case when r.stock_take_item_id is not null
                                   then excluded.unit_cost_exc_vat
                                   else stock_lot.unit_cost_exc_vat end
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

-- Price, batch or expiry changed on a counted line: decide its batch again
-- (the batch keeps its id, so stock already used from it follows the price).
create function public.stock_take_item_lot_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx uuid;
begin
  for v_tx in select id from public.item_transaction where stock_take_item_id = new.id and qty > 0
  loop
    perform public.stock_allocate(v_tx);
  end loop;
  return null;
end;
$$;
revoke execute on function public.stock_take_item_lot_changed() from public, anon, authenticated;

create trigger stock_take_item_lot_changed
  after update of unit_cost_exc_vat, batch_number, expiry_date on public.stock_take_item
  for each row
  when (old.unit_cost_exc_vat is distinct from new.unit_cost_exc_vat
     or old.batch_number is distinct from new.batch_number
     or old.expiry_date is distinct from new.expiry_date)
  execute function public.stock_take_item_lot_changed();
