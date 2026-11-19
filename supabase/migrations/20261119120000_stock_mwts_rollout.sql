-- Stock module for the MWTS rollout (spec "AquaFix Stock Module – Developer
-- Spec (MWTS rollout)", 19 Nov 2026), requirements R1–R4:
--
--   R1  Receiving on the web: receive_purchase_order() makes the load, the PO
--       intake and its lines in one call (the web's Receive button and the
--       phone's Collected both use it).
--   R2  Fewer compulsory fields: a load's driver defaults to the signed-in
--       user's name; vehicle, delivery note and invoice number are optional
--       (the invoice number can still be added later: editing it posts
--       nothing).
--   R3  Collections: who collects a purchase order, from where, and which
--       storage area it is delivered to. The phone's Collected is
--       receive_purchase_order() with a command id, so a resend from an
--       offline phone returns the first result instead of receiving twice.
--       Open purchase orders and their open lines sync to the phones.
--   R4  Work orders record the site (location) and optionally a service or
--       incident at that site.
--
-- Decisions (19 Nov 2026, Dylan):
--   * Receiving is opened to system_admin, admin and user (it was
--     system_admin only). Deleting a load, an intake, an intake line or a
--     delivery note stays with system_admin and admin.
--   * The site on a work order is required by the web app, the PWA and the
--     field app for new work orders, but stays nullable in the database:
--     work orders from phones still on an older field app (no site field)
--     must keep syncing. Old work orders without a site still open.
--   * The collector is told in-app only: the Collect list on the phone.

-- ============================================================================
-- R1/R2 · Who receives
-- ============================================================================
create or replace function public.is_stock_receiver() returns boolean language sql stable as $$
  select public.has_masterdata_role(array['system_admin','admin','user']::public.masterdata_role[]);
$$;

-- One policy per command so delete can stay with the admins.
drop policy load_all on public.load;
drop policy intake_all on public.intake;
drop policy intake_item_all on public.intake_item;
drop policy stock_document_all on public.stock_document;

create policy load_select on public.load for select to authenticated using (public.is_stock_receiver());
create policy load_insert on public.load for insert to authenticated with check (public.is_stock_receiver());
create policy load_update on public.load for update to authenticated
  using (public.is_stock_receiver()) with check (public.is_stock_receiver());
create policy load_delete on public.load for delete to authenticated using (public.is_stock_admin());

create policy intake_select on public.intake for select to authenticated using (public.is_stock_receiver());
create policy intake_insert on public.intake for insert to authenticated with check (public.is_stock_receiver());
create policy intake_update on public.intake for update to authenticated
  using (public.is_stock_receiver()) with check (public.is_stock_receiver());
create policy intake_delete on public.intake for delete to authenticated using (public.is_stock_admin());

create policy intake_item_select on public.intake_item for select to authenticated using (public.is_stock_receiver());
create policy intake_item_insert on public.intake_item for insert to authenticated with check (public.is_stock_receiver());
create policy intake_item_update on public.intake_item for update to authenticated
  using (public.is_stock_receiver()) with check (public.is_stock_receiver());
create policy intake_item_delete on public.intake_item for delete to authenticated using (public.is_stock_admin());

create policy stock_document_select on public.stock_document for select to authenticated using (public.is_stock_receiver());
create policy stock_document_insert on public.stock_document for insert to authenticated
  with check (public.is_stock_receiver() and split_part(storage_path, '/', 1) = auth.uid()::text);
create policy stock_document_delete on public.stock_document for delete to authenticated using (public.is_stock_admin());

drop policy stock_documents_delete on storage.objects;
create policy stock_documents_delete on storage.objects for delete
  to authenticated
  using (bucket_id = 'stock-documents' and public.is_stock_admin());

-- ============================================================================
-- R2 · Driver defaults to the signed-in user; delivery note and invoice optional
-- ============================================================================
-- The signed-in user's display name, as get_user_names() shows it.
create function public.current_user_display_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(p.username), ''), split_part(u.email::text, '@', 1))
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = auth.uid();
$$;
revoke execute on function public.current_user_display_name() from public, anon;
grant execute on function public.current_user_display_name() to authenticated;

create function public.load_before()
returns trigger
language plpgsql
as $$
begin
  new.driver := nullif(btrim(new.driver), '');
  new.vehicle_reg_nr := nullif(btrim(new.vehicle_reg_nr), '');
  if tg_op = 'INSERT' and new.driver is null then
    new.driver := public.current_user_display_name();
  end if;
  return new;
end;
$$;
create trigger load_before before insert or update on public.load
  for each row execute function public.load_before();

-- Same as 20261113120000 without the two required fields.
create or replace function public.intake_before()
returns trigger
language plpgsql
as $$
begin
  new.delivery_note := nullif(btrim(new.delivery_note), '');
  new.invoice_number := nullif(btrim(new.invoice_number), '');
  if (tg_op = 'INSERT' or new.intake_date is distinct from old.intake_date)
     and new.intake_date > now() + interval '5 minutes' then
    raise exception 'The date can''t be in the future.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ============================================================================
-- R3 · Collections on the purchase order
-- ============================================================================
alter table public.purchase_order
  add column collector_user_id uuid references auth.users (id) on delete set null,
  add column collect_from text,
  add column collect_from_area_id uuid references public.storage_area (id) on delete restrict,
  add column deliver_to_area_id uuid references public.storage_area (id) on delete restrict,
  add constraint purchase_order_collect_from_check check (collect_from in ('SUPPLIER', 'STORAGE_AREA')),
  add constraint purchase_order_collect_from_area_check check (
    (collect_from = 'STORAGE_AREA') = (collect_from_area_id is not null));
create index purchase_order_collector_idx on public.purchase_order (collector_user_id) where status = 'new';

grant insert (collector_user_id, collect_from, collect_from_area_id, deliver_to_area_id) on public.purchase_order to authenticated;
grant update (collector_user_id, collect_from, collect_from_area_id, deliver_to_area_id) on public.purchase_order to authenticated;

-- Who can be asked to collect: everyone who can receive stock.
create function public.list_stock_collectors()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, coalesce(nullif(btrim(p.username), ''), split_part(u.email::text, '@', 1)) as name
    from auth.users u
    left join public.profiles p on p.id = u.id
   where public.is_stock_reader()
     and exists (select 1 from public.user_masterdata_roles r
                  where r.user_id = u.id and r.role in ('system_admin', 'admin', 'user'))
   order by 2;
$$;
revoke execute on function public.list_stock_collectors() from public, anon;
grant execute on function public.list_stock_collectors() to authenticated;

-- ============================================================================
-- R1/R3 · receive_purchase_order — a load, a PO intake and its lines in one
-- transaction. Used by the web's Receive and by the phone's Collected.
--
-- SECURITY INVOKER: the receiving RLS applies (system_admin, admin, user).
--
-- Payload:
--   { command_id?,     the phone's command id: a resend returns the first result
--     captured_at?,    the phone's time of the tap (> 5 min ahead or > 7 days
--                      old is refused); the load and intake date, else now()
--     purchase_order_id,
--     storage_area_id?, where it goes; defaults to the order's Deliver to
--     load_id?, intake_id?, the phone's ids
--     driver?,          defaults to the signed-in user's name
--     vehicle_reg_nr?, delivery_note?, invoice_number?, comment?,
--     lines: [ { id?, purchase_order_item_id, qty } ]   qty 0 = not received
--     documents?: [ { name, storage_path, mime_type?, size_bytes } ]
--                       files already uploaded to stock-documents/<uid>/… }
--
-- Returns { load_id, load_reference, intake_id, intake_reference,
--           purchase_order_status }.
-- ============================================================================
create function public.receive_purchase_order(p jsonb)
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

    insert into public.intake_item (id, intake_id, item_id, purchase_order_item_id, qty, transaction_date)
    select coalesce(nullif(l ->> 'id', '')::uuid, gen_random_uuid()), v_intake_id, poi.item_id, poi.id,
           (l ->> 'qty')::numeric, v_when
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
revoke execute on function public.receive_purchase_order(jsonb) from public, anon;
grant execute on function public.receive_purchase_order(jsonb) to authenticated;
-- The phone chooses the intake's and its lines' ids (as for the other stock documents).
grant insert (id) on public.intake, public.intake_item to authenticated;

-- ============================================================================
-- R4 · Site, service and incident on work orders
-- ============================================================================
alter table public.work_order
  add column location_id uuid references public.location (id) on delete restrict,
  add column service_id uuid references public.service (id) on delete set null,
  add column incident_id uuid references public.incident (id) on delete set null;
create index work_order_location_idx on public.work_order (location_id);
create index work_order_service_idx on public.work_order (service_id) where service_id is not null;
create index work_order_incident_idx on public.work_order (incident_id) where incident_id is not null;

grant insert (location_id, service_id, incident_id) on public.work_order to authenticated;
grant update (location_id, service_id, incident_id) on public.work_order to authenticated;

-- A linked service or incident must be at the work order's site.
create function public.work_order_site_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.service_id is not null or new.incident_id is not null) and new.location_id is null then
    raise exception 'Choose the site before linking a service or incident.' using errcode = 'P0001';
  end if;
  if new.service_id is not null and not exists (
       select 1 from public.service s join public.asset a on a.id = s.asset_id
        where s.id = new.service_id and a.location_id = new.location_id) then
    raise exception 'That service is not at this site.' using errcode = 'P0001';
  end if;
  if new.incident_id is not null and not exists (
       select 1 from public.incident i where i.id = new.incident_id and i.location_id = new.location_id) then
    raise exception 'That incident is not at this site.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger work_order_site_links
  before insert or update of location_id, service_id, incident_id on public.work_order
  for each row execute function public.work_order_site_links();

-- save_stock_document (20261104140000) with location_id, service_id and
-- incident_id on a work order's header. Everything else is unchanged.
create or replace function public.save_stock_document(p_doc jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_command_id uuid := nullif(p_doc ->> 'command_id', '')::uuid;
  v_captured_at timestamptz := nullif(p_doc ->> 'captured_at', '')::timestamptz;
  v_kind text := p_doc ->> 'kind';
  v_header jsonb := p_doc -> 'header';
  v_lines jsonb := coalesce(p_doc -> 'lines', '[]'::jsonb);
  v_stored jsonb;
  v_id uuid;
  v_reference bigint;
  v_type text;
  v_from uuid;
  v_to uuid;
  v_line jsonb;
  v_n integer;
  v_constraint text;
begin
  v_stored := public.client_command_result(v_command_id, 'save_stock_document');
  if v_stored is not null then
    return v_stored;
  end if;
  perform public.assert_captured_at(v_captured_at);

  if v_kind is null or v_kind not in ('transfers', 'work-orders', 'stock-takes', 'loads') then
    raise exception using errcode = 'P0001', message = 'That kind of stock document can''t be saved here.';
  end if;
  if v_header is null or jsonb_typeof(v_header) <> 'object' then
    raise exception using errcode = 'P0001', message = 'The document has no header.';
  end if;
  if jsonb_typeof(v_lines) <> 'array' then
    raise exception using errcode = 'P0001', message = 'The document''s lines must be a list.';
  end if;
  if v_kind = 'loads' then
    if jsonb_array_length(v_lines) > 0 then
      raise exception using errcode = 'P0001', message = 'A load has no lines.';
    end if;
  elsif jsonb_array_length(v_lines) = 0 then
    raise exception using errcode = 'P0001', message = 'Add at least one item.';   -- as doc-form
  end if;

  -- Lines first, so a bad line is reported before anything is written.
  v_n := 0;
  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    v_n := v_n + 1;
    if jsonb_typeof(v_line) <> 'object' then
      raise exception using errcode = 'P0001', message = format('Line %s is not valid.', v_n);
    end if;
    if nullif(btrim(coalesce(v_line ->> 'item_id', '')), '') is null then
      raise exception using errcode = 'P0001', message = format('Line %s: Item is required.', v_n);
    end if;
    perform public.stock_doc_number(
      v_line ->> case v_kind when 'stock-takes' then 'counted_qty' else 'qty' end,
      format('Line %s: %s', v_n, case v_kind when 'stock-takes' then 'Counted qty' else 'Qty' end));
  end loop;

  begin
    v_id := coalesce(nullif(v_header ->> 'id', '')::uuid, gen_random_uuid());

    if v_kind = 'transfers' then
      v_type := nullif(btrim(coalesce(v_header ->> 'transfer_type', '')), '');
      if v_type is null then
        raise exception using errcode = 'P0001', message = 'Type is required.';
      end if;
      if v_type not in ('SEND', 'RECEIVE', 'BOTH') then
        raise exception using errcode = 'P0001', message = 'That transfer type doesn''t exist.';
      end if;
      v_from := case when v_type <> 'RECEIVE' then nullif(v_header ->> 'from_storage_area_id', '')::uuid end;
      v_to := case when v_type <> 'SEND' then nullif(v_header ->> 'to_storage_area_id', '')::uuid end;
      if v_type <> 'RECEIVE' and v_from is null then
        raise exception using errcode = 'P0001', message = 'From storage area is required.';
      end if;
      if v_type <> 'SEND' and v_to is null then
        raise exception using errcode = 'P0001', message = 'To storage area is required.';
      end if;

      insert into public.transfer_main (id, transfer_type, transfer_date, from_storage_area_id, to_storage_area_id, comment)
      values (
        v_id, v_type::public.transfer_type,
        coalesce(nullif(v_header ->> 'transfer_date', '')::timestamptz, v_captured_at, now()),
        v_from, v_to, nullif(btrim(coalesce(v_header ->> 'comment', '')), '')
      )
      returning reference into v_reference;

      insert into public.transfer_item (id, transfer_id, item_id, qty)
      select coalesce(nullif(l ->> 'id', '')::uuid, gen_random_uuid()), v_id, (l ->> 'item_id')::uuid,
             btrim(l ->> 'qty')::numeric
      from jsonb_array_elements(v_lines) with ordinality as t(l, n)
      order by n;

    elsif v_kind in ('work-orders', 'stock-takes') then
      if nullif(v_header ->> 'storage_area_id', '') is null then
        raise exception using errcode = 'P0001', message = 'Storage area is required.';
      end if;

      if v_kind = 'work-orders' then
        insert into public.work_order (id, order_date, storage_area_id, location_id, service_id, incident_id, comment)
        values (
          v_id,
          coalesce(nullif(v_header ->> 'order_date', '')::timestamptz, v_captured_at, now()),
          (v_header ->> 'storage_area_id')::uuid,
          nullif(v_header ->> 'location_id', '')::uuid,
          nullif(v_header ->> 'service_id', '')::uuid,
          nullif(v_header ->> 'incident_id', '')::uuid,
          nullif(btrim(coalesce(v_header ->> 'comment', '')), '')
        )
        returning reference into v_reference;

        insert into public.work_order_item (id, work_order_id, item_id, qty, is_return, transaction_date)
        select coalesce(nullif(l ->> 'id', '')::uuid, gen_random_uuid()), v_id, (l ->> 'item_id')::uuid,
               btrim(l ->> 'qty')::numeric,
               coalesce(nullif(l ->> 'is_return', '')::boolean, false),
               coalesce(nullif(l ->> 'transaction_date', '')::timestamptz, v_captured_at, now())
        from jsonb_array_elements(v_lines) with ordinality as t(l, n)
        order by n;
      else
        insert into public.stock_take (id, take_date, storage_area_id, comment)
        values (
          v_id,
          coalesce(nullif(v_header ->> 'take_date', '')::timestamptz, v_captured_at, now()),
          (v_header ->> 'storage_area_id')::uuid,
          nullif(btrim(coalesce(v_header ->> 'comment', '')), '')
        )
        returning reference into v_reference;

        insert into public.stock_take_item (id, stock_take_id, item_id, counted_qty)
        select coalesce(nullif(l ->> 'id', '')::uuid, gen_random_uuid()), v_id, (l ->> 'item_id')::uuid,
               btrim(l ->> 'counted_qty')::numeric
        from jsonb_array_elements(v_lines) with ordinality as t(l, n)
        order by n;
      end if;

    else -- loads
      insert into public.load (id, load_date, driver, vehicle_reg_nr, comment)
      values (
        v_id,
        coalesce(nullif(v_header ->> 'load_date', '')::date,
                 (v_captured_at at time zone public.app_time_zone())::date,
                 current_date),
        nullif(btrim(coalesce(v_header ->> 'driver', '')), ''),
        nullif(btrim(coalesce(v_header ->> 'vehicle_reg_nr', '')), ''),
        nullif(btrim(coalesce(v_header ->> 'comment', '')), '')
      )
      returning reference into v_reference;
    end if;

    set constraints public.item_transaction_guard immediate;
    set constraints public.item_transaction_guard deferred;

  exception
    when insufficient_privilege then
      raise exception using errcode = '42501', message = 'You don''t have permission to save this document.';
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint in ('transfer_item_once', 'work_order_item_once', 'stock_take_item_once') then
        raise exception using errcode = 'P0001', message = 'Each item can only be on a document once.';
      end if;
      raise exception using errcode = 'P0001', message = 'This document, or one of its lines, was already saved.';
    when foreign_key_violation then
      raise exception using errcode = 'P0001',
        message = 'A storage area or item on this form no longer exists — reload and try again.';
    when check_violation then
      raise exception using errcode = 'P0001', message = 'One of the values doesn''t meet the required constraints.';
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
      or numeric_value_out_of_range then
      raise exception using errcode = 'P0001', message = 'One of the values on this form isn''t valid.';
  end;

  return public.client_command_store(v_command_id, 'save_stock_document',
    jsonb_build_object('id', v_id, 'reference', v_reference));
end;
$$;

-- ============================================================================
-- PowerSync: open purchase orders and their open lines (stream
-- open_purchase_orders in powersync/sync-config.yaml) and supplier names.
-- ============================================================================
grant select on public.purchase_order, public.purchase_order_item to powersync_role;
alter publication powersync add table public.purchase_order, public.purchase_order_item;
