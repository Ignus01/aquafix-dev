-- RLS, RPCs and Storage for incidents (spec/incidents/access-matrix.md,
-- "Rebuild recommendation"). The Mendix module roles map onto the existing
-- `masterdata_role` assignments, as InspectionSetup did.
--
-- Mendix had no row-level constraints: any `user` could edit or delete any
-- incident through the client API. The rebuild tightens that:
--   incident        read: every role · create: user+ · edit: admins, or the
--                   creator while not completed · delete: admins.
--                   Status only changes through the two RPCs below.
--   incident_note   read: every role · add: user+ while the incident is open
--                   · append-only (no edits) · delete: admins.
--   incident_image  read: every role · add: user+ · no edits · delete: the
--                   uploader while the incident is open, or admins.
-- Field users can read every incident (product decision), so the report
-- linked from notification emails opens for every subscriber (EML-R08).

create function public.is_incident_writer()
returns boolean
language sql
stable
as $$
  select public.has_masterdata_role(array['system_admin','admin','user']::public.masterdata_role[]);
$$;

create function public.is_incident_admin()
returns boolean
language sql
stable
as $$
  select public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]);
$$;

-- ============================================================================
-- incident
-- ============================================================================
create policy incident_select on public.incident for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[]));

create policy incident_insert on public.incident for insert
  to authenticated
  with check (public.is_incident_writer());

create policy incident_update on public.incident for update
  to authenticated
  using (
    public.is_incident_admin()
    or (public.is_incident_writer() and created_by = auth.uid() and status <> 'completed')
  )
  with check (
    public.is_incident_admin()
    or (public.is_incident_writer() and created_by = auth.uid() and status <> 'completed')
  );

create policy incident_delete on public.incident for delete
  to authenticated
  using (public.is_incident_admin());

-- Clients may only write the user-editable columns. status/completed_at go
-- through advance_incident_status / set_incident_status; the audit columns
-- are set by trigger.
revoke insert, update on public.incident from anon, authenticated;
grant insert (location_id, incident_type_id, comment) on public.incident to authenticated;
grant update (location_id, incident_type_id, comment) on public.incident to authenticated;

-- ============================================================================
-- incident_note
-- ============================================================================
create policy incident_note_select on public.incident_note for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[]));

-- ICN-R03, now enforced server-side: no notes on a Completed incident.
create policy incident_note_insert on public.incident_note for insert
  to authenticated
  with check (
    public.is_incident_writer()
    and exists (
      select 1 from public.incident i
      where i.id = incident_note.incident_id
        and i.status <> 'completed'
    )
  );

create policy incident_note_delete on public.incident_note for delete
  to authenticated
  using (public.is_incident_admin());

revoke insert, update on public.incident_note from anon, authenticated;
grant insert (incident_id, body) on public.incident_note to authenticated;

-- ============================================================================
-- incident_image
-- ============================================================================
create policy incident_image_select on public.incident_image for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[]));

-- An image can only point at a file the caller uploaded themselves (their own
-- Storage folder), and only be attached where the caller may write: an
-- incident they can edit, or a note they wrote on an open incident.
create policy incident_image_insert on public.incident_image for insert
  to authenticated
  with check (
    public.is_incident_writer()
    and split_part(storage_path, '/', 1) = auth.uid()::text
    and (thumbnail_path is null or split_part(thumbnail_path, '/', 1) = auth.uid()::text)
    and (
      exists (
        select 1 from public.incident i
        where i.id = incident_image.incident_id
          and i.status <> 'completed'
          and (public.is_incident_admin() or i.created_by = auth.uid())
      )
      or exists (
        select 1
        from public.incident_note n
        join public.incident i on i.id = n.incident_id
        where n.id = incident_image.incident_note_id
          and i.status <> 'completed'
          and (public.is_incident_admin() or n.created_by = auth.uid())
      )
    )
  );

create policy incident_image_delete on public.incident_image for delete
  to authenticated
  using (
    public.is_incident_admin()
    or (
      public.is_incident_writer()
      and created_by = auth.uid()
      and exists (
        select 1
        from public.incident i
        left join public.incident_note n on n.incident_id = i.id
        where (i.id = incident_image.incident_id or n.id = incident_image.incident_note_id)
          and i.status <> 'completed'
      )
    )
  );

revoke insert, update on public.incident_image from anon, authenticated;
grant insert (incident_id, incident_note_id, storage_path, thumbnail_path, mime_type, size_bytes)
  on public.incident_image to authenticated;

-- ============================================================================
-- incident_status_change — read-only history
-- ============================================================================
create policy incident_status_change_select on public.incident_status_change for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[]));

revoke insert, update, delete on public.incident_status_change from anon, authenticated;

-- ============================================================================
-- save_incident — Incident_NewEdit's Save (ACT_Incident_Save, ICD-R11):
-- validate, then write the incident and its direct photos in one transaction.
-- SECURITY INVOKER, so the RLS policies above apply. The email notification is
-- queued by an insert trigger in the same transaction (EML-R01, R04).
--
-- Payload:
--   { id?, location_id, incident_type_id, comment,
--     images: [ { id } | { storage_path, thumbnail_path, mime_type, size_bytes } ] }
-- Existing images missing from `images` are deleted. Returns
--   { id, reference, removed_paths } — the Storage objects the caller should
--   remove now that nothing references them.
-- ============================================================================
create function public.save_incident(p_incident jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := nullif(p_incident ->> 'id', '')::uuid;
  v_type_id uuid := nullif(p_incident ->> 'incident_type_id', '')::uuid;
  v_location_id uuid := nullif(p_incident ->> 'location_id', '')::uuid;
  v_comment text := btrim(coalesce(p_incident ->> 'comment', ''));
  v_images jsonb := coalesce(p_incident -> 'images', '[]'::jsonb);
  v_type public.incident_type;
  v_location public.location;
  v_current public.incident;
  v_reference bigint;
  v_keep uuid[];
  v_expected integer;
  v_deleted integer;
  v_removed text[];
  r record;
begin
  -- The type is checked before anything that depends on it (the source app
  -- read IsImageRequired through an empty association first; open question).
  if v_type_id is null then
    raise exception using errcode = 'P0001', message = 'Incident type is required.';
  end if;
  select * into v_type from public.incident_type where id = v_type_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'That incident type no longer exists.';
  end if;
  -- ICD-R03
  if v_location_id is null then
    raise exception using errcode = 'P0001', message = 'Location is required.';
  end if;
  select * into v_location from public.location where id = v_location_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'That location no longer exists.';
  end if;
  -- ICD-R01
  if v_comment = '' then
    raise exception using errcode = 'P0001', message = 'Comment is required.';
  end if;

  if v_id is not null then
    select * into v_current from public.incident where id = v_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'That incident no longer exists.';
    end if;
  end if;

  -- The pickers only offer active types and active asset-manager locations. A
  -- value already on the incident stays valid if it's deactivated later.
  if not v_type.active and v_type_id is distinct from v_current.incident_type_id then
    raise exception using errcode = 'P0001', message = 'That incident type is inactive.';
  end if;
  if (not v_location.active or not v_location.is_asset_manager)
    and v_location_id is distinct from v_current.location_id then
    raise exception using errcode = 'P0001', message = 'That location isn''t available for incidents.';
  end if;

  if v_id is null then
    insert into public.incident (location_id, incident_type_id, comment)
    values (v_location_id, v_type_id, v_comment)
    returning id, reference into v_id, v_reference;
  else
    update public.incident set
      location_id = v_location_id,
      incident_type_id = v_type_id,
      comment = v_comment
    where id = v_id
    returning reference into v_reference;
    if not found then
      raise exception using errcode = '42501',
        message = 'You can''t edit this incident. It is completed, or it was logged by someone else.';
    end if;
  end if;

  -- Photos removed from the form.
  select coalesce(array_agg((e ->> 'id')::uuid), '{}')
  into v_keep
  from jsonb_array_elements(v_images) e
  where coalesce(e ->> 'id', '') <> '';

  select count(*) into v_expected
  from public.incident_image
  where incident_id = v_id and id <> all (v_keep);

  with d as (
    delete from public.incident_image
    where incident_id = v_id and id <> all (v_keep)
    returning storage_path, thumbnail_path
  )
  select
    count(distinct d.storage_path),
    coalesce(array_agg(x.p) filter (where x.p is not null), '{}')
  into v_deleted, v_removed
  from d
  cross join lateral unnest(array[d.storage_path, d.thumbnail_path]) as x(p);

  if v_deleted < v_expected then
    raise exception using errcode = '42501',
      message = 'You can only remove photos you added yourself.';
  end if;

  -- New photos (already uploaded to Storage by the client).
  for r in
    select *
    from jsonb_to_recordset(v_images) as x(
      id uuid, storage_path text, thumbnail_path text, mime_type text, size_bytes bigint
    )
    where x.id is null
  loop
    insert into public.incident_image (
      incident_id, storage_path, thumbnail_path, mime_type, size_bytes
    ) values (
      v_id, r.storage_path, r.thumbnail_path, r.mime_type, r.size_bytes
    );
  end loop;

  -- ICD-R02: photos are mandatory when the type says so. Only photos on the
  -- incident itself count, not note photos (same as the source app).
  if v_type.is_image_required
    and not exists (select 1 from public.incident_image where incident_id = v_id) then
    raise exception using errcode = 'P0001', message = 'Please add images.';
  end if;

  return jsonb_build_object(
    'id', v_id,
    'reference', v_reference,
    'removed_paths', to_jsonb(v_removed)
  );
end;
$$;

revoke execute on function public.save_incident(jsonb) from public, anon;
grant execute on function public.save_incident(jsonb) to authenticated;

-- ============================================================================
-- add_incident_note — Incident_AddNote's Save (ACT_IncidentNote_Save): the
-- note and its photos in one transaction. Fixes ICI-R05 (note photos were
-- never explicitly committed in Mendix). SECURITY INVOKER.
-- ============================================================================
create function public.add_incident_note(
  p_incident_id uuid,
  p_body text,
  p_images jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_status public.incident_status;
  v_note_id uuid;
  r record;
begin
  -- ICN-R01
  if btrim(coalesce(p_body, '')) = '' then
    raise exception using errcode = 'P0001', message = 'Note is required.';
  end if;
  select status into v_status from public.incident where id = p_incident_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'That incident no longer exists.';
  end if;
  -- ICN-R03
  if v_status = 'completed' then
    raise exception using errcode = 'P0001', message = 'Notes can''t be added to a completed incident.';
  end if;

  insert into public.incident_note (incident_id, body)
  values (p_incident_id, btrim(p_body))
  returning id into v_note_id;

  for r in
    select *
    from jsonb_to_recordset(coalesce(p_images, '[]'::jsonb)) as x(
      storage_path text, thumbnail_path text, mime_type text, size_bytes bigint
    )
  loop
    insert into public.incident_image (
      incident_note_id, storage_path, thumbnail_path, mime_type, size_bytes
    ) values (
      v_note_id, r.storage_path, r.thumbnail_path, r.mime_type, r.size_bytes
    );
  end loop;

  return v_note_id;
end;
$$;

revoke execute on function public.add_incident_note(uuid, text, jsonb) from public, anon;
grant execute on function public.add_incident_note(uuid, text, jsonb) to authenticated;

-- ============================================================================
-- advance_incident_status — ICD-R06, the one-tap status badge:
-- New → In Progress → Completed (sets completed_at). Completed: no change.
-- p_expected_status guards against a double tap advancing twice: if the
-- incident has already moved on, nothing changes.
-- SECURITY DEFINER because clients have no UPDATE right on `status`.
-- ============================================================================
create function public.advance_incident_status(
  p_incident_id uuid,
  p_expected_status public.incident_status
)
returns public.incident_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.incident_status;
begin
  if not public.is_incident_writer() then
    raise exception using errcode = '42501', message = 'You don''t have permission to change the status.';
  end if;

  select status into v_status from public.incident where id = p_incident_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'That incident no longer exists.';
  end if;
  if v_status is distinct from p_expected_status then
    return v_status;
  end if;

  if v_status = 'new' then
    update public.incident set status = 'in_progress' where id = p_incident_id;
    return 'in_progress';
  elsif v_status = 'in_progress' then
    update public.incident set status = 'completed', completed_at = now() where id = p_incident_id;
    return 'completed';
  end if;
  return v_status;
end;
$$;

revoke execute on function public.advance_incident_status(uuid, public.incident_status) from public, anon;
grant execute on function public.advance_incident_status(uuid, public.incident_status) to authenticated;

-- ============================================================================
-- set_incident_status — ICD-R07, admins only: set any status, including
-- reopening. Completed sets completed_at; any other status clears it.
-- ============================================================================
create function public.set_incident_status(
  p_incident_id uuid,
  p_status public.incident_status
)
returns public.incident_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.incident_status;
begin
  if not public.is_incident_admin() then
    raise exception using errcode = '42501', message = 'Only admins can set the status directly.';
  end if;

  select status into v_status from public.incident where id = p_incident_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'That incident no longer exists.';
  end if;
  if v_status = p_status then
    return v_status;
  end if;

  update public.incident set
    status = p_status,
    completed_at = case when p_status = 'completed' then now() end
  where id = p_incident_id;
  return p_status;
end;
$$;

revoke execute on function public.set_incident_status(uuid, public.incident_status) from public, anon;
grant execute on function public.set_incident_status(uuid, public.incident_status) to authenticated;

-- ============================================================================
-- get_user_names — "Logged by" / note authors. profiles is only readable by
-- admins, but every role sees who logged an incident, so names are resolved
-- here. Returns nothing unless the caller holds a role.
-- ============================================================================
create function public.get_user_names(p_ids uuid[])
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, coalesce(nullif(btrim(p.username), ''), split_part(u.email::text, '@', 1))
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = any (p_ids)
    and public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[]);
$$;

revoke execute on function public.get_user_names(uuid[]) from public, anon;
grant execute on function public.get_user_names(uuid[]) to authenticated;

-- ============================================================================
-- Storage: private bucket `incident-images`.
-- Clients upload into their own folder (`<auth.uid()>/<uuid>.jpg`) before the
-- incident or note is saved, then save_incident / add_incident_note links the
-- path. A file is readable by its uploader, and by any role once an
-- incident_image row points at it (incident_image's own RLS applies inside
-- the policy). Bucket access follows the table's RLS (migration notes).
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'incident-images',
  'incident-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy incident_images_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'incident-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_incident_writer()
  );

create policy incident_images_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'incident-images'
    and (
      owner_id = auth.uid()::text
      or exists (
        select 1 from public.incident_image ii
        where ii.storage_path = objects.name
           or ii.thumbnail_path = objects.name
      )
    )
  );

-- The uploader can remove their own files (cancelled forms, removed photos);
-- admins can remove any (deleting an incident).
create policy incident_images_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'incident-images'
    and (owner_id = auth.uid()::text or public.is_incident_admin())
  );
