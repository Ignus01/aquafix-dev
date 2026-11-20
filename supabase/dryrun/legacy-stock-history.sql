-- Dry run, step 1: two years of "live-like" stock history, written through
-- the normal tables (so the ledger triggers post it) on the schema as it is
-- on live today, i.e. BEFORE the MWTS stock migrations (20261119+).
--
-- What live data can look like, on purpose:
--   * POs most weeks, prices drifting up; some lines priced 0 (Mendix-era
--     rows, from before the "cost > 0" rule); partial receipts.
--   * Facility-transfer intakes with no PO (no price).
--   * Store -> kit transfers (send and receive), plus a few send-only and
--     receive-only ones.
--   * Daily usage from kits (no site: old usage had none), some returns,
--     and ~8% entered late with an earlier date (backdated).
--   * Monthly kit counts that come up short or over.
--   * Edits: usage quantities changed later; a document deleted.
--   * Two LIFO items, items with packs of 1 to 25.
-- Deterministic (setseed) so runs compare.
\set ON_ERROR_STOP on

select setseed(0.42);

-- Master data -----------------------------------------------------------------
insert into public.region (id, name) values ('d7000000-0000-0000-0000-000000000001', 'DRY REGION');
insert into public.organisation (id, name, is_supplier) values
  ('d7100000-0000-0000-0000-000000000001', 'DRY MWTS', false),
  ('d7100000-0000-0000-0000-000000000002', 'DRY SUPPLIER A', true),
  ('d7100000-0000-0000-0000-000000000003', 'DRY SUPPLIER B', true),
  ('d7100000-0000-0000-0000-000000000004', 'DRY SUPPLIER C', true);
insert into public.location (id, name, region_id, organisation_id, is_stock_manager)
select ('d7200000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
       case g when 0 then 'DRY HQ' else 'DRY SITE ' || g end,
       'd7000000-0000-0000-0000-000000000001', 'd7100000-0000-0000-0000-000000000001', g = 0
  from generate_series(0, 8) g;
-- 2 stores, 8 kits.
insert into public.storage_area (id, code, name, location_id)
select ('d7300000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
       case when g <= 2 then 'DRY-STORE-' || g else 'DRY-KIT-' || (g - 2) end,
       case when g <= 2 then 'Dry store ' || g else 'Dry kit ' || (g - 2) end,
       'd7200000-0000-0000-0000-000000000000'
  from generate_series(1, 10) g;
insert into public.unit_of_measure (id, code, name, uom_type) values
  ('d7400000-0000-0000-0000-000000000001', 'DRYEA', 'Dry each', 'NODIM'),
  ('d7400000-0000-0000-0000-000000000002', 'DRYKG', 'Dry kg', 'MASS');
insert into public.product_type (id, code, name) values ('d7500000-0000-0000-0000-000000000001', 'DRYCHEM', 'Dry chemicals');
insert into public.product (id, code, name, product_type_id, uom_id)
select ('d7600000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'DRYP' || g, 'Dry product ' || g,
       'd7500000-0000-0000-0000-000000000001',
       case when g % 4 = 0 then 'd7400000-0000-0000-0000-000000000002' else 'd7400000-0000-0000-0000-000000000001' end::uuid
  from generate_series(1, 40) g;
insert into public.pack_type (id, name, qty, uom_id)
select ('d7700000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'Dry pack ' || g, (array[1, 5, 10, 25])[g],
       case when g = 4 then 'd7400000-0000-0000-0000-000000000002' else 'd7400000-0000-0000-0000-000000000001' end::uuid
  from generate_series(1, 4) g;
insert into public.item (id, name, product_id, pack_type_id, item_tracking_method)
select ('d7800000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'Dry item ' || g,
       ('d7600000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
       case when g % 4 = 0 then 'd7700000-0000-0000-0000-000000000004'
            else ('d7700000-0000-0000-0000-' || lpad((1 + g % 3)::text, 12, '0')) end::uuid,
       case when g in (7, 19) then 'LIFO' else 'FIFO' end::public.item_tracking_method
  from generate_series(1, 40) g;

-- History -----------------------------------------------------------------------
create temporary table dry_po (id uuid, created_day int, store uuid, received boolean default false);

do $$
declare
  v_days constant int := 730;
  v_start constant timestamptz := date_trunc('day', now()) - make_interval(days => v_days + 3) + interval '7 hours';
  d int;
  v_at timestamptz;
  v_po uuid; v_load uuid; v_intake uuid; v_doc uuid; v_line uuid;
  v_item uuid; v_kit uuid; v_store uuid; v_site int;
  v_qty numeric; v_avail numeric; v_n int; i int; k int;
  r record;
  v_price numeric;
begin
  for d in 0 .. v_days loop
    v_at := v_start + make_interval(days => d);

    -- A purchase order most weeks (Mon), 1-4 lines.
    if d % 7 = 0 then
      v_po := gen_random_uuid();
      insert into public.purchase_order (id, supplier_id, order_date, order_alias, status)
      values (v_po, ('d7100000-0000-0000-0000-00000000000' || (2 + d % 3))::uuid, (v_at)::date, 'ODOO ' || (16000 + d), 'new');
      v_n := 1 + floor(random() * 4)::int;
      for v_item in
        select ('d7800000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 40) g order by random() limit v_n
      loop
        v_price := round(((50 + (abs(hashtext(v_item::text)) % 900)) * (1 + d * 0.0004) * (0.95 + random() * 0.1))::numeric, 2);
        if random() < 0.05 then
          -- A Mendix-era line priced 0 (before the "cost > 0" rule existed).
          alter table public.purchase_order_item disable trigger purchase_order_item_before;
          insert into public.purchase_order_item (purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, eta, base_qty, qty_outstanding)
          values (v_po, v_item, 20 + floor(random() * 80), 0, v_at::date + 5, 0, 0);
          alter table public.purchase_order_item enable trigger purchase_order_item_before;
        else
          insert into public.purchase_order_item (purchase_order_id, item_id, qty_ordered, unit_cost_exc_vat, eta)
          values (v_po, v_item, 20 + floor(random() * 80), v_price, v_at::date + 5);
        end if;
      end loop;
      insert into dry_po (id, created_day, store) values
        (v_po, d, case when random() < 0.85 then 'd7300000-0000-0000-0000-000000000001' else 'd7300000-0000-0000-0000-000000000002' end::uuid);
    end if;

    -- Receive POs created 4 days ago (some partially; a few never).
    for r in select * from dry_po where created_day = d - 4 and not received loop
      update dry_po set received = true where id = r.id;
      continue when random() < 0.04;
      v_load := gen_random_uuid();
      insert into public.load (id, load_date) values (v_load, (v_at)::date);
      v_intake := gen_random_uuid();
      insert into public.intake (id, intake_type, load_id, storage_area_id, purchase_order_id, supplier_id, intake_date, delivery_note, invoice_number)
      select v_intake, 'PURCHASE_ORDER', v_load, r.store, r.id, po.supplier_id, v_at + interval '2 hours', 'DN-' || d, 'INV-' || d
        from public.purchase_order po where po.id = r.id;
      insert into public.intake_item (intake_id, item_id, purchase_order_item_id, qty, transaction_date)
      select v_intake, poi.item_id, poi.id,
             case when random() < 0.15 then greatest(1, floor(poi.qty_ordered * 0.6)) else poi.qty_ordered end,
             v_at + interval '2 hours'
        from public.purchase_order_item poi where poi.purchase_order_id = r.id;
    end loop;

    -- Now and then stock arrives from another facility: no PO, no price.
    if random() < 0.03 then
      v_load := gen_random_uuid();
      insert into public.load (id, load_date) values (v_load, v_at::date);
      v_intake := gen_random_uuid();
      insert into public.intake (id, intake_type, load_id, storage_area_id, intake_date)
      values (v_intake, 'FACILITY_TRANSFER', v_load, 'd7300000-0000-0000-0000-000000000002', v_at + interval '3 hours');
      insert into public.intake_item (intake_id, item_id, qty, transaction_date)
      values (v_intake, ('d7800000-0000-0000-0000-' || lpad((1 + floor(random() * 40))::int::text, 12, '0'))::uuid,
              5 + floor(random() * 20), v_at + interval '3 hours');
    end if;

    -- Every 2nd day a store hands stock to a kit (both legs).
    if d % 2 = 1 then
      v_store := case when random() < 0.8 then 'd7300000-0000-0000-0000-000000000001' else 'd7300000-0000-0000-0000-000000000002' end::uuid;
      v_kit := ('d7300000-0000-0000-0000-' || lpad((3 + floor(random() * 8))::int::text, 12, '0'))::uuid;
      v_doc := null;
      for r in
        select s.item_id, s.qty from (
          select item_id, sum(qty) as qty from public.item_transaction where storage_area_id = v_store group by item_id
        ) s where s.qty > 0 order by random() limit 1 + floor(random() * 4)::int
      loop
        if v_doc is null then
          v_doc := gen_random_uuid();
          insert into public.transfer_main (id, transfer_type, transfer_date, from_storage_area_id, to_storage_area_id)
          values (v_doc,
                  case when random() < 0.03 then 'SEND' else 'BOTH' end::public.transfer_type,
                  v_at + interval '4 hours', v_store, v_kit);
        end if;
        insert into public.transfer_item (transfer_id, item_id, qty)
        values (v_doc, r.item_id, least(r.qty, 1 + floor(random() * 12)));
      end loop;
      -- The rare transfer that only records the receiving side.
      if v_doc is not null and random() < 0.03 then
        update public.transfer_main set transfer_type = 'RECEIVE', from_storage_area_id = null where id = v_doc
          and transfer_type = 'BOTH';
      end if;
    end if;

    -- Daily usage: 6 jobs from kits; 8% entered late with an earlier date.
    for k in 1 .. 6 loop
      v_kit := ('d7300000-0000-0000-0000-' || lpad((3 + floor(random() * 8))::int::text, 12, '0'))::uuid;
      v_doc := null;
      for r in
        select s.item_id, s.qty from (
          select item_id, sum(qty) as qty from public.item_transaction where storage_area_id = v_kit group by item_id
        ) s where s.qty > 0 order by random() limit 1 + floor(random() * 2)::int
      loop
        if v_doc is null then
          v_doc := gen_random_uuid();
          insert into public.work_order (id, storage_area_id, order_date)
          values (v_doc, v_kit, v_at + make_interval(hours => 1 + k) - case when random() < 0.08 then make_interval(days => 2 + floor(random() * 8)::int) else interval '0' end);
        end if;
        if random() < 0.03 then
          insert into public.work_order_item (work_order_id, item_id, qty, is_return, transaction_date)
          select v_doc, r.item_id, 1, true, order_date from public.work_order where id = v_doc;
        else
          insert into public.work_order_item (work_order_id, item_id, qty, transaction_date)
          select v_doc, r.item_id, least(r.qty, 1 + floor(random() * 3)), order_date from public.work_order where id = v_doc;
        end if;
      end loop;
    end loop;

    -- Month end: every kit counted; some short, some over.
    if extract(day from v_at) = 28 then
      for k in 3 .. 10 loop
        v_kit := ('d7300000-0000-0000-0000-' || lpad(k::text, 12, '0'))::uuid;
        v_doc := gen_random_uuid();
        insert into public.stock_take (id, storage_area_id, take_date) values (v_doc, v_kit, v_at + interval '10 hours');
        insert into public.stock_take_item (stock_take_id, item_id, counted_qty)
        select v_doc, s.item_id,
               greatest(0, s.qty + case when random() < 0.15 then -1 - floor(random() * 2) when random() < 0.05 then 1 else 0 end)
          from (select item_id, sum(qty) as qty from public.item_transaction
                 where storage_area_id = v_kit and transaction_date <= v_at + interval '10 hours' group by item_id) s
         where s.qty > 0;
      end loop;
    end if;

    -- Edits: now and then a usage line's quantity is corrected downwards.
    if d % 37 = 0 then
      update public.work_order_item set qty = qty - 1
       where id = (select id from public.work_order_item where qty > 1 and not is_return order by random() limit 1);
    end if;
  end loop;

  -- One whole usage document deleted later.
  delete from public.work_order where id = (select id from public.work_order order by random() limit 1);
end;
$$;

select count(*) as ledger_rows,
       count(*) filter (where transaction_type = 'WORK_ORDER_USAGE') as usage_rows,
       min(transaction_date)::date as first_day, max(transaction_date)::date as last_day
  from public.item_transaction;
