-- Stock rules the Mendix app enforced and the rebuild had dropped, found by
-- comparing the Mendix model's microflows with this schema.
--
--   Purchase order lines (PurchaseOrderItem_Validate, ..._UpdateQtyOutstanding,
--   ACT_PurchaseOrderItem_ChangeStatus):
--     * prices are only re-worked when a price is edited. Before, every update
--       of a line (a receipt updates qty_received) rebuilt the inc-VAT price
--       from today's VAT rate, so a VAT change repriced old orders;
--     * an item can be on a purchase order once;
--     * ETA is required and the unit cost must be greater than 0;
--     * status as Mendix: a line is COMPLETED exactly when received = ordered
--       (also when it had been closed); otherwise it is NEW, or CLOSED once a
--       user closes it. An over-received line is therefore not completed: it
--       stays open, flagged, until someone closes it. Closing and reopening is
--       a toggle in the app, not a free choice of status.
--   PO intakes (POIntake_Validate): intake date, delivery note and invoice
--     number, the last two required.
--   Master data (*_Validate): names and codes are stored in upper case on
--     product types, units of measure, pack types and storage areas, as they
--     already were on products and items; a conversion joins two units of the
--     same type; a unit's type can't change once it is in use.
--
-- Rows written before this migration are not re-checked: each rule applies to
-- new rows and to the values an update actually changes.
--
-- Not here, on purpose: the transfer rules (both storage areas, type taken
-- from the destination location) and the load rules (driver, vehicle, date
-- not after today) are enforced by the web app only. The released phone app
-- saves transfers and loads through save_stock_document without them, and
-- would stop syncing if the database refused those rows.

-- ============================================================================
-- Purchase order lines
-- ============================================================================
create or replace function public.purchase_order_item_before()
returns trigger
language plpgsql
as $$
declare
  v_vat numeric := 1 + public.get_vat_rate();
  v_conv numeric;
begin
  -- Prices: whichever one was edited drives the other; untouched prices stay.
  if tg_op = 'INSERT' then
    if new.unit_cost_exc_vat = 0 and new.unit_cost_inc_vat <> 0 then
      new.unit_cost_exc_vat := round(new.unit_cost_inc_vat / v_vat, 4);
    else
      new.unit_cost_inc_vat := round(new.unit_cost_exc_vat * v_vat, 4);
    end if;
  elsif new.unit_cost_exc_vat is distinct from old.unit_cost_exc_vat then
    new.unit_cost_inc_vat := round(new.unit_cost_exc_vat * v_vat, 4);
  elsif new.unit_cost_inc_vat is distinct from old.unit_cost_inc_vat then
    new.unit_cost_exc_vat := round(new.unit_cost_inc_vat / v_vat, 4);
  end if;

  if tg_op = 'INSERT' or new.eta is distinct from old.eta then
    if new.eta is null then
      raise exception 'ETA is required.' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' or new.unit_cost_exc_vat is distinct from old.unit_cost_exc_vat then
    if new.unit_cost_exc_vat <= 0 then
      raise exception 'Unit cost must be greater than 0.' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' or new.item_id is distinct from old.item_id then
    if exists (select 1 from public.purchase_order_item
                where purchase_order_id = new.purchase_order_id and item_id = new.item_id and id <> new.id) then
      raise exception 'That item is already on this purchase order.' using errcode = 'P0001';
    end if;
  end if;

  new.total_cost_exc_vat := round(new.qty_ordered * new.unit_cost_exc_vat, 2);
  new.total_cost_inc_vat := round(new.qty_ordered * new.unit_cost_inc_vat, 2);

  select conversion_to_default_uom into v_conv from public.item where id = new.item_id;
  new.base_qty := new.qty_ordered * coalesce(v_conv, 0);
  new.qty_outstanding := new.qty_ordered - new.qty_received;

  if new.qty_received = new.qty_ordered then
    new.status := 'completed';
  elsif new.status = 'completed' then
    new.status := 'new';
  end if;
  return new;
end;
$$;

-- Lines saved under the old rule (completed at received >= ordered).
alter table public.purchase_order_item disable trigger purchase_order_item_audit;
update public.purchase_order_item set status = 'new'
 where status = 'completed' and qty_received <> qty_ordered;
update public.purchase_order_item set status = 'completed'
 where status <> 'completed' and qty_received = qty_ordered;
alter table public.purchase_order_item enable trigger purchase_order_item_audit;

-- ============================================================================
-- PO intakes: date, delivery note, invoice number
-- ============================================================================
alter table public.intake
  add column intake_date timestamptz not null default now(),
  add column delivery_note text,
  add column invoice_number text;
update public.intake set intake_date = created_at;

grant insert (intake_date, delivery_note, invoice_number) on public.intake to authenticated;
grant update (intake_date, delivery_note, invoice_number) on public.intake to authenticated;

create function public.intake_before()
returns trigger
language plpgsql
as $$
begin
  new.delivery_note := nullif(btrim(new.delivery_note), '');
  new.invoice_number := nullif(btrim(new.invoice_number), '');
  if new.intake_type = 'PURCHASE_ORDER' then
    if (tg_op = 'INSERT' or new.delivery_note is distinct from old.delivery_note) and new.delivery_note is null then
      raise exception 'Delivery note is required.' using errcode = 'P0001';
    end if;
    if (tg_op = 'INSERT' or new.invoice_number is distinct from old.invoice_number) and new.invoice_number is null then
      raise exception 'Invoice number is required.' using errcode = 'P0001';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.intake_date is distinct from old.intake_date)
     and new.intake_date > now() + interval '5 minutes' then
    raise exception 'The date can''t be in the future.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger intake_before before insert or update on public.intake
  for each row execute function public.intake_before();

-- ============================================================================
-- Master data
-- ============================================================================
-- Name and code in upper case before the uniqueness check (pack types have a
-- derived code, so only their name).
create function public.stock_masterdata_upper()
returns trigger
language plpgsql
as $$
begin
  new.name := upper(btrim(new.name));
  if tg_table_name <> 'pack_type' then
    new.code := upper(btrim(new.code));
  end if;
  return new;
end;
$$;
create trigger product_type_upper before insert or update on public.product_type
  for each row execute function public.stock_masterdata_upper();
create trigger unit_of_measure_upper before insert or update on public.unit_of_measure
  for each row execute function public.stock_masterdata_upper();
create trigger pack_type_upper before insert or update on public.pack_type
  for each row execute function public.stock_masterdata_upper();
create trigger storage_area_upper before insert or update on public.storage_area
  for each row execute function public.stock_masterdata_upper();

-- A conversion joins two units of the same type (kg <-> g, never kg <-> L).
create function public.uom_conversion_same_type()
returns trigger
language plpgsql
as $$
declare
  v_from public.unit_of_measure;
  v_to public.unit_of_measure;
begin
  if tg_op = 'UPDATE' and new.from_uom_id = old.from_uom_id and new.to_uom_id = old.to_uom_id then
    return new;
  end if;
  select * into v_from from public.unit_of_measure where id = new.from_uom_id;
  select * into v_to from public.unit_of_measure where id = new.to_uom_id;
  if v_from.uom_type <> v_to.uom_type then
    raise exception '% and % are different types of unit, so one can''t be converted to the other.',
      v_from.code, v_to.code using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger uom_conversion_same_type before insert or update on public.unit_of_measure_conversion
  for each row execute function public.uom_conversion_same_type();

-- A unit's type is fixed once something uses the unit.
create function public.unit_of_measure_type_locked()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.unit_of_measure_conversion where from_uom_id = new.id or to_uom_id = new.id)
     or exists (select 1 from public.product where uom_id = new.id)
     or exists (select 1 from public.pack_type where uom_id = new.id) then
    raise exception 'The type can''t be changed: this unit of measure is already in use.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger unit_of_measure_type_locked before update of uom_type on public.unit_of_measure
  for each row when (old.uom_type is distinct from new.uom_type)
  execute function public.unit_of_measure_type_locked();
