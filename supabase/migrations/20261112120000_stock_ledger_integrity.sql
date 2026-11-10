-- Stock ledger integrity: three ways stock on hand could end up wrong.
--
--   1. A movement could be dated in the future (only work order lines were
--      checked). It counted towards stock on hand at once, but a stock take
--      taken before that date ignored it and adjusted the stock a second time.
--      Intake lines, transfers and stock takes now refuse a future date.
--   2. A stock take's adjustment was worked out once, when the line was saved.
--      A movement saved afterwards with an earlier date changed the stock the
--      count had settled. Stock takes dated on or after a changed movement are
--      now re-worked, oldest first, so the count stays what was counted.
--   3. `base_qty` (the quantity in the product's unit) was fixed when a row was
--      written. Changing an item's pack size or its unit conversion left old
--      rows on the old factor, so "on hand (default unit)" mixed two factors.
--      The stored base quantities now follow the item's conversion.

-- ============================================================================
-- 1. No future dates
-- ============================================================================
-- Five minutes of slack for a phone whose clock runs ahead (as assert_captured_at).
create function public.stock_date_not_future()
returns trigger
language plpgsql
as $$
declare
  v_new timestamptz;
  v_old timestamptz;
begin
  case tg_table_name
    when 'intake_item' then
      v_new := new.transaction_date;
      if tg_op = 'UPDATE' then v_old := old.transaction_date; end if;
    when 'transfer_main' then
      v_new := new.transfer_date;
      if tg_op = 'UPDATE' then v_old := old.transfer_date; end if;
    when 'stock_take' then
      v_new := new.take_date;
      if tg_op = 'UPDATE' then v_old := old.take_date; end if;
  end case;
  -- An untouched date is left alone, so older rows can still be edited.
  if v_new is distinct from v_old and v_new > now() + interval '5 minutes' then
    raise exception 'The date can''t be in the future.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger intake_item_date_not_future before insert or update on public.intake_item
  for each row execute function public.stock_date_not_future();
create trigger transfer_main_date_not_future before insert or update on public.transfer_main
  for each row execute function public.stock_date_not_future();
create trigger stock_take_date_not_future before insert or update on public.stock_take
  for each row execute function public.stock_date_not_future();

-- ============================================================================
-- 2. Stock takes follow movements dated before them
-- ============================================================================
-- Which movements a count already includes: those dated before the stock take.
-- Dates are entered to the minute, so a movement can share the take's exact
-- date; it then counts as "before" only if it was posted before the counted
-- line was (ledger numbers run in posting order). That keeps a movement
-- captured straight after a count from being absorbed by it.
create or replace function public.stock_take_item_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_take public.stock_take;
  v_own bigint;
  v_ledger numeric;
begin
  select * into v_take from public.stock_take where id = new.stock_take_id;
  select reference into v_own from public.item_transaction where stock_take_item_id = new.id;
  select coalesce(sum(qty), 0) into v_ledger
    from public.item_transaction
   where item_id = new.item_id
     and storage_area_id = v_take.storage_area_id
     and stock_take_item_id is distinct from new.id
     and (transaction_date < v_take.take_date
          or (transaction_date = v_take.take_date and (v_own is null or reference < v_own)));
  new.adjustment_qty := new.counted_qty - v_ledger;
  return new;
end;
$$;

-- Re-work the counted lines of one item in one storage area for every stock
-- take dated on or after p_from, oldest first: each adjustment is the count
-- minus the ledger up to its date, which includes the earlier takes just
-- re-worked. `set counted_qty = counted_qty` fires the line's own triggers.
create function public.stock_take_recalc_from(p_item uuid, p_area uuid, p_from timestamptz, p_skip uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select sti.id
      from public.stock_take_item sti
      join public.stock_take st on st.id = sti.stock_take_id
     where sti.item_id = p_item
       and st.storage_area_id = p_area
       and st.take_date >= p_from
       and sti.id is distinct from p_skip
     order by st.take_date, sti.id
  loop
    update public.stock_take_item set counted_qty = counted_qty where id = r.id;
  end loop;
end;
$$;
revoke execute on function public.stock_take_recalc_from(uuid, uuid, timestamptz, uuid) from public, anon, authenticated;

create function public.item_transaction_recalc_stock_takes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The adjustments this function itself re-posts must not start it again.
  if coalesce(current_setting('aquafix.stock_take_recalc', true), '') = '1' then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.qty = old.qty and new.item_id = old.item_id
     and new.storage_area_id = old.storage_area_id and new.transaction_date = old.transaction_date then
    return null;
  end if;

  perform set_config('aquafix.stock_take_recalc', '1', true);
  if tg_op = 'UPDATE' and new.item_id = old.item_id and new.storage_area_id = old.storage_area_id then
    perform public.stock_take_recalc_from(new.item_id, new.storage_area_id,
      least(old.transaction_date, new.transaction_date), new.stock_take_item_id);
  else
    if tg_op <> 'INSERT' then
      perform public.stock_take_recalc_from(old.item_id, old.storage_area_id, old.transaction_date, old.stock_take_item_id);
    end if;
    if tg_op <> 'DELETE' then
      perform public.stock_take_recalc_from(new.item_id, new.storage_area_id, new.transaction_date, new.stock_take_item_id);
    end if;
  end if;
  perform set_config('aquafix.stock_take_recalc', '', true);
  return null;
end;
$$;

create trigger item_transaction_recalc_stock_takes
  after insert or update or delete on public.item_transaction
  for each row execute function public.item_transaction_recalc_stock_takes();

-- ============================================================================
-- 3. Base quantities follow the item's conversion
-- ============================================================================
create function public.item_refresh_base_qty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.item_transaction
     set base_qty = qty * new.conversion_to_default_uom
   where item_id = new.id;
  update public.intake_item
     set base_qty = qty * new.conversion_to_default_uom
   where item_id = new.id;
  update public.purchase_order_item
     set base_qty = qty_ordered * new.conversion_to_default_uom
   where item_id = new.id;
  return null;
end;
$$;

create trigger item_refresh_base_qty after update on public.item
  for each row when (old.conversion_to_default_uom is distinct from new.conversion_to_default_uom)
  execute function public.item_refresh_base_qty();

-- Rows written before this migration, on a factor the item no longer has.
update public.item_transaction t
   set base_qty = t.qty * i.conversion_to_default_uom
  from public.item i
 where i.id = t.item_id and t.base_qty is distinct from t.qty * i.conversion_to_default_uom;
update public.intake_item ii
   set base_qty = ii.qty * i.conversion_to_default_uom
  from public.item i
 where i.id = ii.item_id and ii.base_qty is distinct from ii.qty * i.conversion_to_default_uom;
update public.purchase_order_item pi
   set base_qty = pi.qty_ordered * i.conversion_to_default_uom
  from public.item i
 where i.id = pi.item_id and pi.base_qty is distinct from pi.qty_ordered * i.conversion_to_default_uom;

-- ============================================================================
-- 4. Signed-in users can edit transfer, work order and stock take lines again
-- ============================================================================
-- 20261104150000 put powersync_only_sync_columns_changed() in the WHEN clause
-- of the line triggers. A WHEN clause runs as the user making the change, and
-- 20261102120000 had revoked the function from `authenticated`, so every edit
-- of such a line failed with "permission denied for function". The function
-- only compares two rows the caller already holds.
grant execute on function public.powersync_only_sync_columns_changed(jsonb, jsonb) to authenticated;
