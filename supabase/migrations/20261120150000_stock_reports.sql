-- MWTS stock reports.
--
-- R8 · Cost per site: stock usage per site, month and item, valued at the
-- actual price of the batches it came from. Returns to stock count against
-- the usage.
--
-- Missing stock: what kit counts found short, per technician, month and
-- item, valued the same way. Shortfalls stay stock-take losses in the
-- ledger; this report just names whose kit they came from.
--
-- Both read through the caller's own rights (security invoker), months in
-- the app's time zone, quantities in the item's pack units. Stock whose
-- batch is unknown (untraced) is counted in qty and listed separately,
-- with no value.

create function public.stock_cost_per_site(p_from date, p_to date)
returns table (
  month date,
  location_id uuid,
  site text,
  item_id uuid,
  item text,
  qty numeric,
  value_exc_vat numeric,
  untraced_qty numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select date_trunc('month', t.transaction_date at time zone public.app_time_zone())::date,
         w.location_id, coalesce(loc.name, '(no site)'), t.item_id, i.name,
         sum(-a.qty),
         round(sum(-a.qty * l.unit_cost_exc_vat), 2),
         coalesce(sum(-a.qty) filter (where l.id is null or l.unit_cost_exc_vat is null), 0)
    from public.item_transaction t
    join public.work_order_item wi on wi.id = t.work_order_item_id
    join public.work_order w on w.id = wi.work_order_id
    left join public.location loc on loc.id = w.location_id
    join public.item i on i.id = t.item_id
    join public.stock_allocation a on a.item_transaction_id = t.id
    left join public.stock_lot l on l.id = a.lot_id
   where (t.transaction_date at time zone public.app_time_zone())::date between p_from and p_to
   group by 1, w.location_id, loc.name, t.item_id, i.name
  having sum(-a.qty) <> 0
   order by 1, 3, 5;
$$;

create function public.stock_missing_by_technician(p_from date, p_to date)
returns table (
  month date,
  storage_area_id uuid,
  storage_area text,
  technician_user_id uuid,
  item_id uuid,
  item text,
  qty numeric,
  value_exc_vat numeric,
  untraced_qty numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select date_trunc('month', t.transaction_date at time zone public.app_time_zone())::date,
         sa.id, sa.name, sa.technician_user_id, t.item_id, i.name,
         sum(-a.qty),
         round(sum(-a.qty * l.unit_cost_exc_vat), 2),
         coalesce(sum(-a.qty) filter (where l.id is null or l.unit_cost_exc_vat is null), 0)
    from public.item_transaction t
    join public.storage_area sa on sa.id = t.storage_area_id
    join public.item i on i.id = t.item_id
    join public.stock_allocation a on a.item_transaction_id = t.id
    left join public.stock_lot l on l.id = a.lot_id
   where t.stock_take_item_id is not null
     and t.qty < 0
     and sa.technician_user_id is not null
     and (t.transaction_date at time zone public.app_time_zone())::date between p_from and p_to
   group by 1, sa.id, sa.name, sa.technician_user_id, t.item_id, i.name
   order by 1, 3, 6;
$$;

revoke execute on function public.stock_cost_per_site(date, date), public.stock_missing_by_technician(date, date) from public, anon;
grant execute on function public.stock_cost_per_site(date, date), public.stock_missing_by_technician(date, date) to authenticated;
