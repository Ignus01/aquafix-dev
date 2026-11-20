-- Dry run, step 3: after the MWTS migrations ran on the live-like history,
-- check nothing moved and the batches add up. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset footer off
\pset pager off

\echo '=== 1. On hand unchanged by the migrations'
select case when count(*) = 0 then 'PASS' else 'FAIL' end as result,
       'on hand per item and storage area identical before/after' as check, count(*) as differences
  from (
    select item_id, storage_area_id, qty, base_qty from dryrun.before
    except
    select item_id, storage_area_id, sum(qty), sum(base_qty) from public.item_transaction group by 1, 2
  ) d;
select case when count(*) = 0 then 'PASS' else 'FAIL' end, 'storage_area_stock equals the ledger', count(*)
  from (
    select item_id, storage_area_id, sum(qty) as qty from public.item_transaction group by 1, 2 having sum(qty) <> 0
    except
    select item_id, storage_area_id, qty from public.storage_area_stock where qty <> 0
  ) d;

\echo '=== 2. Every movement fully allocated to batches'
select case when count(*) = 0 then 'PASS' else 'FAIL' end, 'each movement''s batches add up to its qty', count(*)
  from public.item_transaction t
  left join (select item_transaction_id, sum(qty) as q from public.stock_allocation group by 1) a on a.item_transaction_id = t.id
 where t.qty <> coalesce(a.q, 0);
select case when count(*) = 0 then 'PASS' else 'FAIL' end, 'batches per item and storage area add up to on hand', count(*)
  from (
    select item_id, storage_area_id, sum(qty) from public.item_transaction group by 1, 2
    except
    select item_id, storage_area_id, sum(qty) from public.stock_allocation group by 1, 2
  ) d;
select case when count(*) = 0 then 'PASS' else 'FAIL' end, 'no batch below zero in any storage area', count(*)
  from public.stock_lot_balance where qty < 0;

\echo '=== 3. Untraced stock (taken out with no batch to take it from)'
select t.transaction_type, count(distinct t.id) as movements, sum(-a.qty) as untraced_qty
  from public.stock_allocation a join public.item_transaction t on t.id = a.item_transaction_id
 where a.lot_id is null
 group by 1 order by 1;
select coalesce(sum(-a.qty), 0) as untraced_total,
       round(100.0 * coalesce(sum(-a.qty), 0) / nullif((select sum(-qty) from public.item_transaction where qty < 0), 0), 2) as pct_of_all_stock_out
  from public.stock_allocation a where a.lot_id is null;
\echo '    (untraced is the reason the order of the backfill matters; see section 6)'

\echo '=== 4. Values'
select round(sum(b.value_exc_vat), 2) as on_hand_value,
       sum(b.qty) filter (where l.unit_cost_exc_vat is null) as on_hand_qty_unpriced,
       sum(b.qty) filter (where l.unit_cost_exc_vat = 0) as on_hand_qty_priced_zero,
       sum(b.qty) as on_hand_qty_traced
  from public.stock_lot_balance b join public.stock_lot l on l.id = b.lot_id where b.qty > 0;
select l.source, count(*) as batches, count(*) filter (where l.unit_cost_exc_vat is null) as unpriced,
       count(*) filter (where l.unit_cost_exc_vat = 0) as priced_zero
  from public.stock_lot l group by 1 order by 1;
select case when count(*) = 0 then 'PASS' else 'FAIL' end, 'every PO receipt batch carries its PO line price', count(*)
  from public.stock_lot l join public.purchase_order_item poi on poi.id = l.purchase_order_item_id
 where l.unit_cost_exc_vat is distinct from poi.unit_cost_exc_vat;

\echo '=== 5. Batches follow transfers'
select case when count(*) = 0 then 'PASS' else 'FAIL' end, 'each receive leg carries the same batches as its send leg', count(*)
  from public.item_transaction r
  join public.item_transaction s on s.transfer_item_id = r.transfer_item_id and s.transfer_leg = 'send'
 where r.transfer_leg = 'receive'
   and exists (
     select lot_id, sum(-qty) from public.stock_allocation where item_transaction_id = s.id group by 1
     except
     select lot_id, sum(qty) from public.stock_allocation where item_transaction_id = r.id group by 1);

\echo '=== 6. Backfill order: by date (as migrated) vs. in the order rows were saved'
\timing on
begin;
create temporary table by_date as
  select coalesce(sum(-qty), 0) as untraced from public.stock_allocation where lot_id is null;
delete from public.stock_allocation;
delete from public.stock_lot where source <> 'INTAKE';
do $$
declare v uuid;
begin
  for v in select id from public.item_transaction order by reference loop
    perform public.stock_allocate(v);
  end loop;
end $$;
select (select untraced from by_date) as untraced_when_backfilled_by_date,
       coalesce(sum(-qty), 0) as untraced_when_backfilled_in_save_order
  from public.stock_allocation where lot_id is null;
rollback;

\echo '=== 7. New work on top of the migrated history'
begin;
-- A kit uses stock: it comes from the batch that expires / arrived first.
create temporary table pick as
  select s.item_id, s.storage_area_id, s.qty
    from public.storage_area_stock s join public.storage_area a on a.id = s.storage_area_id
   where a.code like 'DRY-KIT-%' and s.qty >= 2 order by s.qty desc limit 1;
insert into public.work_order (id, storage_area_id, location_id)
select 'd7900000-0000-0000-0000-000000000001', storage_area_id, 'd7200000-0000-0000-0000-000000000001' from pick;
insert into public.work_order_item (work_order_id, item_id, qty)
select 'd7900000-0000-0000-0000-000000000001', item_id, 2 from pick;
select case when count(*) > 0 and bool_and(a.lot_id is not null) then 'PASS' else 'FAIL' end,
       'new usage on a migrated kit is traced to batches' as check
  from public.stock_allocation a join public.item_transaction t on t.id = a.item_transaction_id
  join public.work_order_item wi on wi.id = t.work_order_item_id
 where wi.work_order_id = 'd7900000-0000-0000-0000-000000000001';
-- An old usage document (no site) can still be edited.
update public.work_order set comment = 'edited after migration'
 where id = (select id from public.work_order where location_id is null limit 1);
select 'PASS' as result, 'an old usage document without a site can still be edited' as check;
-- Reports and month end run on the full history.
select count(*) as cost_per_site_rows from public.stock_cost_per_site(current_date - 800, current_date);
select count(*) as missing_stock_rows, coalesce(sum(qty), 0) as qty_missing from public.stock_missing_by_technician(current_date - 800, current_date);
rollback;

\echo '=== 8. Size'
select (select count(*) from public.item_transaction) as ledger_rows,
       (select count(*) from public.stock_lot) as batches,
       (select count(*) from public.stock_allocation) as allocations;
