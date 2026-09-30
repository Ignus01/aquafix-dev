-- Services (spec: AquaFix Services Spec): one maintenance or repair job on an
-- asset, done by an external service supplier, with its cost and files.
--
-- Differences from the Mendix model, all flagged in the spec's open questions:
--   * `scheduled_maintenance` is spelled correctly (Mendix: SCHEDULED_MAINTENACE);
--     there is no data to migrate from here.
--   * `total_cost` is a generated column instead of an on-change microflow.
--   * "One open service per asset" is a partial unique index, so two people
--     saving at once can't both win.
--   * The next scheduled service is created AFTER the completed one is written,
--     so the completed service can never be mistaken for the open one (the
--     spec's riskiest open question), and only when a service *becomes*
--     completed, not on every later edit of a completed service.
--   * Deleting a service cascades to its files (Mendix could orphan them).

create type public.service_type as enum ('scheduled_maintenance', 'repair');

-- Display name for a user: profile username, else the email's local part.
-- SECURITY DEFINER because profiles is admin-readable only.
create function public.user_display_name(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(p.username), ''), split_part(u.email::text, '@', 1))
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_id;
$$;

revoke execute on function public.user_display_name(uuid) from public, anon, authenticated;

-- ============================================================================
-- service
-- ============================================================================
create table public.service (
  id uuid primary key default gen_random_uuid(),
  -- Mendix `_UID`: the service number shown to users.
  reference bigint generated always as identity (start with 1) not null unique,
  service_type public.service_type not null,
  due_date timestamptz not null,
  is_completed boolean not null default false,
  completed_date timestamptz,
  invoice_nr text,
  total_part_cost numeric(14, 2) not null default 0,
  total_labour_cost numeric(14, 2) not null default 0,
  total_cost numeric(15, 2) generated always as (total_part_cost + total_labour_cost) stored,
  comment text,
  -- Stamped by trigger with the user who completed the service.
  performed_by text,
  -- Service_Asset: blocked from deleting an asset that has services.
  asset_id uuid not null references public.asset (id) on delete restrict,
  -- Service_OrganisationServiceSupplier: required once completed.
  supplier_id uuid references public.organisation (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint service_costs_check check (total_part_cost >= 0 and total_labour_cost >= 0),
  constraint service_comment_length check (char_length(comment) <= 200),
  -- Validation rule 4: a completed service has a completed date and supplier.
  constraint service_completed_check check (
    (is_completed = (completed_date is not null))
    and (not is_completed or supplier_id is not null)
  )
);

create index service_asset_id_idx on public.service (asset_id, due_date desc);
create index service_supplier_id_idx on public.service (supplier_id);
create index service_due_date_idx on public.service (due_date);
-- Validation rule 5: no two incomplete services on the same asset.
create unique index service_one_open_per_asset on public.service (asset_id) where not is_completed;

-- Audit columns come from the session, never the client. PerformedBy is set
-- when a service becomes completed and cleared when it is reopened.
-- (auth.uid() is null for service-role writes, which keep what they set.)
create function public.set_service_audit_fields()
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

  if tg_table_name = 'service' then
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
    if not new.is_completed then
      new.performed_by := null;
    elsif tg_op = 'INSERT' then
      new.performed_by := coalesce(public.user_display_name(auth.uid()), new.performed_by);
    elsif old.is_completed then
      new.performed_by := old.performed_by;
    else
      new.performed_by := coalesce(public.user_display_name(auth.uid()), new.performed_by);
    end if;
  end if;
  return new;
end;
$$;

create trigger service_set_audit_fields
  before insert or update on public.service
  for each row execute function public.set_service_audit_fields();

alter table public.service enable row level security;

-- ============================================================================
-- service_file — ServiceFile (extends System.FileDocument in Mendix). The
-- binaries live in the private Storage bucket `service-files`.
-- ============================================================================
create table public.service_file (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.service (id) on delete cascade,
  name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  constraint service_file_name_not_blank check (btrim(name) <> ''),
  constraint service_file_size_check check (size_bytes > 0)
);

create index service_file_service_id_idx on public.service_file (service_id, created_at);

create trigger service_file_set_audit_fields
  before insert or update on public.service_file
  for each row execute function public.set_service_audit_fields();

alter table public.service_file enable row level security;

-- ============================================================================
-- RLS (spec "Security"): admin, system_admin and user have full edit rights
-- on services, viewer is read-only; no row-level limits. Files: user can add
-- but not delete. `_UID` and PerformedBy are not writable by clients, and
-- total_cost is generated, which also closes the "_TotalCost is writable"
-- gap in the spec.
-- ============================================================================
create function public.is_service_writer()
returns boolean
language sql
stable
as $$
  select public.has_masterdata_role(array['system_admin','admin','user']::public.masterdata_role[]);
$$;

create function public.is_service_admin()
returns boolean
language sql
stable
as $$
  select public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]);
$$;

create policy service_select on public.service for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[]));

create policy service_insert on public.service for insert
  to authenticated
  with check (public.is_service_writer());

create policy service_update on public.service for update
  to authenticated
  using (public.is_service_writer())
  with check (public.is_service_writer());

create policy service_delete on public.service for delete
  to authenticated
  using (public.is_service_writer());

revoke insert, update on public.service from anon, authenticated;
grant insert (asset_id, service_type, due_date, is_completed, completed_date, invoice_nr,
              total_part_cost, total_labour_cost, comment, supplier_id)
  on public.service to authenticated;
grant update (asset_id, service_type, due_date, is_completed, completed_date, invoice_nr,
              total_part_cost, total_labour_cost, comment, supplier_id)
  on public.service to authenticated;

create policy service_file_select on public.service_file for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[]));

-- A file can only point at something the caller uploaded to their own folder.
create policy service_file_insert on public.service_file for insert
  to authenticated
  with check (
    public.is_service_writer()
    and split_part(storage_path, '/', 1) = auth.uid()::text
  );

create policy service_file_delete on public.service_file for delete
  to authenticated
  using (public.is_service_admin());

revoke insert, update on public.service_file from anon, authenticated;
grant insert (service_id, name, storage_path, mime_type, size_bytes)
  on public.service_file to authenticated;

-- ============================================================================
-- create_next_service — Masterdata.ACT_Asset_CreateUpdateIncompleteService:
-- opens a scheduled-maintenance service for an asset with a service plan,
-- unless it already has an open service. ServiceInterval is in years, and the
-- due date counts from today (spec open questions: kept as specified).
-- SECURITY INVOKER: the caller's RLS applies (the asset trigger below is
-- SECURITY DEFINER, so it runs as the table owner).
-- Returns the new service's id, or null if nothing was created.
-- ============================================================================
create function public.create_next_service(p_asset_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_asset public.asset;
  v_id uuid;
begin
  select * into v_asset from public.asset where id = p_asset_id;
  if not found or not v_asset.active or not v_asset.has_service_plan or v_asset.service_interval <= 0 then
    return null;
  end if;
  if exists (select 1 from public.service where asset_id = p_asset_id and not is_completed) then
    return null;
  end if;

  insert into public.service (asset_id, service_type, due_date)
  values (
    p_asset_id,
    'scheduled_maintenance',
    now() + make_interval(days => round(v_asset.service_interval * 365)::integer)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.create_next_service(uuid) from public, anon;
grant execute on function public.create_next_service(uuid) to authenticated;

-- Masterdata.ACT_Asset_Save: saving an asset that has a service plan opens its
-- first service. Fires only when the plan is switched on or its interval
-- changes, so routine asset updates (e.g. last inspection date) don't.
create function public.asset_open_first_service()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_next_service(new.id);
  return null;
end;
$$;

create trigger asset_open_service_after_insert
  after insert on public.asset
  for each row when (new.has_service_plan)
  execute function public.asset_open_first_service();

create trigger asset_open_service_after_update
  after update on public.asset
  for each row when (
    new.has_service_plan
    and (old.has_service_plan is distinct from new.has_service_plan
         or old.service_interval is distinct from new.service_interval)
  )
  execute function public.asset_open_first_service();

-- ============================================================================
-- save_service — ACT_Service_Save: Service_Validate, then write the service and
-- its files, then plan the next service. One transaction. SECURITY INVOKER,
-- so the RLS policies above apply.
--
-- Payload:
--   { id?, asset_id, service_type, due_date, comment, is_completed,
--     completed_date, supplier_id, invoice_nr, total_part_cost,
--     total_labour_cost,
--     files: [ { id } | { name, storage_path, mime_type, size_bytes } ] }
-- Existing files missing from `files` are deleted (admins only). Returns
--   { id, reference, removed_paths, next_service: { id, reference } | null }
-- — `removed_paths` are Storage objects nothing references any more.
-- ============================================================================
create function public.save_service(p_service jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := nullif(p_service ->> 'id', '')::uuid;
  v_asset_id uuid := nullif(p_service ->> 'asset_id', '')::uuid;
  v_type public.service_type;
  v_due timestamptz := nullif(p_service ->> 'due_date', '')::timestamptz;
  v_completed boolean := coalesce((p_service ->> 'is_completed')::boolean, false);
  v_completed_date timestamptz := nullif(p_service ->> 'completed_date', '')::timestamptz;
  v_supplier_id uuid := nullif(p_service ->> 'supplier_id', '')::uuid;
  v_invoice text := nullif(btrim(coalesce(p_service ->> 'invoice_nr', '')), '');
  v_part numeric := coalesce(nullif(p_service ->> 'total_part_cost', '')::numeric, 0);
  v_labour numeric := coalesce(nullif(p_service ->> 'total_labour_cost', '')::numeric, 0);
  v_comment text := nullif(btrim(coalesce(p_service ->> 'comment', '')), '');
  v_files jsonb := coalesce(p_service -> 'files', '[]'::jsonb);
  v_asset public.asset;
  v_supplier public.organisation;
  v_current public.service;
  v_clash public.service;
  v_reference bigint;
  v_next_id uuid;
  v_next_reference bigint;
  v_keep uuid[];
  v_expected integer;
  v_deleted integer;
  v_removed text[];
  r record;
begin
  -- Rules 1-3.
  if nullif(p_service ->> 'service_type', '') is null then
    raise exception using errcode = 'P0001', message = 'Service type is required.';
  end if;
  v_type := (p_service ->> 'service_type')::public.service_type;
  if v_due is null then
    raise exception using errcode = 'P0001', message = 'Due date is required.';
  end if;
  if v_asset_id is null then
    raise exception using errcode = 'P0001', message = 'Asset is required.';
  end if;
  select * into v_asset from public.asset where id = v_asset_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'That asset no longer exists.';
  end if;

  -- Rule 4.
  if v_completed then
    if v_completed_date is null then
      raise exception using errcode = 'P0001', message = 'Completed date is required.';
    end if;
    if v_supplier_id is null then
      raise exception using errcode = 'P0001', message = 'Service supplier is required.';
    end if;
    select * into v_supplier from public.organisation where id = v_supplier_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'That service supplier no longer exists.';
    end if;
  else
    v_completed_date := null;
    v_supplier_id := null;
  end if;

  if v_part < 0 or v_labour < 0 then
    raise exception using errcode = 'P0001', message = 'Costs can''t be negative.';
  end if;
  if char_length(v_comment) > 200 then
    raise exception using errcode = 'P0001', message = 'Comment can be at most 200 characters.';
  end if;

  if v_id is not null then
    select * into v_current from public.service where id = v_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'That service no longer exists.';
    end if;
  end if;

  -- The pickers only offer active assets and service suppliers. A value
  -- already on the service stays valid if it's deactivated later.
  if not v_asset.active and v_asset_id is distinct from v_current.asset_id then
    raise exception using errcode = 'P0001', message = 'That asset is inactive.';
  end if;
  if v_completed and not (v_supplier.is_service_supplier and v_supplier.active)
    and v_supplier_id is distinct from v_current.supplier_id then
    raise exception using errcode = 'P0001', message = 'That organisation isn''t an active service supplier.';
  end if;

  -- Rule 5.
  if not v_completed then
    select * into v_clash
    from public.service
    where asset_id = v_asset_id and not is_completed and id is distinct from v_id;
    if found then
      raise exception using errcode = 'P0001',
        message = format('An incomplete service for %s already exists. Service UID = %s',
                         v_asset.code, v_clash.reference);
    end if;
  end if;

  begin
    if v_id is null then
      insert into public.service (
        asset_id, service_type, due_date, is_completed, completed_date, supplier_id,
        invoice_nr, total_part_cost, total_labour_cost, comment
      ) values (
        v_asset_id, v_type, v_due, v_completed, v_completed_date, v_supplier_id,
        v_invoice, v_part, v_labour, v_comment
      )
      returning id, reference into v_id, v_reference;
    else
      update public.service set
        asset_id = v_asset_id,
        service_type = v_type,
        due_date = v_due,
        is_completed = v_completed,
        completed_date = v_completed_date,
        supplier_id = v_supplier_id,
        invoice_nr = v_invoice,
        total_part_cost = v_part,
        total_labour_cost = v_labour,
        comment = v_comment
      where id = v_id
      returning reference into v_reference;
      if not found then
        raise exception using errcode = '42501', message = 'You can''t edit this service.';
      end if;
    end if;
  exception when unique_violation then
    -- Someone else opened a service on this asset between the check and the write.
    raise exception using errcode = 'P0001',
      message = format('An incomplete service for %s already exists.', v_asset.code);
  end;

  -- Files removed from the form.
  select coalesce(array_agg((e ->> 'id')::uuid), '{}')
  into v_keep
  from jsonb_array_elements(v_files) e
  where coalesce(e ->> 'id', '') <> '';

  select count(*) into v_expected
  from public.service_file
  where service_id = v_id and id <> all (v_keep);

  with d as (
    delete from public.service_file
    where service_id = v_id and id <> all (v_keep)
    returning storage_path
  )
  select count(*), coalesce(array_agg(storage_path), '{}')
  into v_deleted, v_removed
  from d;

  if v_deleted < v_expected then
    raise exception using errcode = '42501', message = 'Only admins can remove files.';
  end if;

  -- New files (already uploaded to Storage by the client).
  for r in
    select *
    from jsonb_to_recordset(v_files) as x(
      id uuid, name text, storage_path text, mime_type text, size_bytes bigint
    )
    where x.id is null
  loop
    insert into public.service_file (service_id, name, storage_path, mime_type, size_bytes)
    values (v_id, r.name, r.storage_path, r.mime_type, r.size_bytes);
  end loop;

  -- Next service: a scheduled maintenance that has just been completed, on an
  -- asset with a service plan. The completed service is already written, so it
  -- can't be mistaken for the open one.
  if v_completed
    and v_type = 'scheduled_maintenance'
    and not coalesce(v_current.is_completed, false) then
    v_next_id := public.create_next_service(v_asset_id);
    if v_next_id is not null then
      select reference into v_next_reference from public.service where id = v_next_id;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'reference', v_reference,
    'removed_paths', to_jsonb(v_removed),
    'next_service', case when v_next_id is null then null
                         else jsonb_build_object('id', v_next_id, 'reference', v_next_reference) end
  );
end;
$$;

revoke execute on function public.save_service(jsonb) from public, anon;
grant execute on function public.save_service(jsonb) to authenticated;

-- ============================================================================
-- Storage: private bucket `service-files`.
-- Clients upload into their own folder (`<auth.uid()>/<uuid>-<name>`) before
-- the service is saved; save_service then links the path. A file is readable
-- by its uploader, and by any role once a service_file row points at it.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('service-files', 'service-files', false, 26214400)
on conflict (id) do nothing;

create policy service_files_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'service-files'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_service_writer()
  );

create policy service_files_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'service-files'
    and (
      owner_id = auth.uid()::text
      or exists (select 1 from public.service_file sf where sf.storage_path = objects.name)
    )
  );

-- The uploader can remove their own files (cancelled forms); admins any.
-- Deleting a service removes its files with the service role afterwards.
create policy service_files_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'service-files'
    and (owner_id = auth.uid()::text or public.is_service_admin())
  );
