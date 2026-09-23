-- RLS policies implementing the Mendix `InspectionSetup` module access matrix
-- (spec/inspection-setup/access-matrix.md).
--
-- InspectionSetup has its own four module roles in Mendix (system_admin,
-- admin, user, viewer) with the same names as Masterdata's. They are mapped
-- onto the existing `masterdata_role` assignments rather than a second role
-- table, so a user holds one role set across both areas.
--
-- Unlike Masterdata, `user` is read-only on every entity here — identical to
-- `viewer`. Replicated verbatim (open question in access-matrix.md). No
-- row-level (XPath) constraints existed in the source app, so none are added.

do $$
declare
  t text;
begin
  foreach t in array array[
    'inspection',
    'inspection_rule',
    'inspection_drop_down_option',
    'feedback',
    'incident_type',
    'incident_subscription',
    'inspection_allocation'
  ]
  loop
    execute format(
      $sql$
        create policy %1$I_select on public.%1$I for select
          to authenticated
          using (public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[]));

        create policy %1$I_insert on public.%1$I for insert
          to authenticated
          with check (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]));

        create policy %1$I_update on public.%1$I for update
          to authenticated
          using (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]))
          with check (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]));

        create policy %1$I_delete on public.%1$I for delete
          to authenticated
          using (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]));
      $sql$,
      t
    );
  end loop;
end;
$$;

-- ============================================================================
-- save_inspection — Mendix edits an Inspection and its child rows in memory
-- and commits them together on Save (ACT_Inspection_Save). This does the same
-- in one transaction. SECURITY INVOKER, so the RLS policies above still apply.
--
-- Payload:
--   { id?, name, description, value_type, is_required, active,
--     nr_of_images_required,
--     drop_down_options: [{ id?, name, grading_id, nr_of_images_required, priority, active }],
--     rules: [{ id?, lower_limit, upper_limit, nr_of_images_required, grading_id,
--               feedback: null | { feedback, max_nr_of_retries, auto_create_incident, incident_type_id } }],
--     allocations: [{ id?, asset_type_id }] }
--
-- As in Mendix, drop-down options are only written for DROP_DOWN inspections
-- and rules only for DECIMAL_VALUE ones; allocations are always written.
-- Child rows missing from the payload are deleted.
-- ============================================================================
create function public.save_inspection(p_inspection jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := nullif(p_inspection ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p_inspection ->> 'name', ''));
  v_value_type public.inspection_value_type;
  v_options jsonb := coalesce(p_inspection -> 'drop_down_options', '[]'::jsonb);
  v_rules jsonb := coalesce(p_inspection -> 'rules', '[]'::jsonb);
  v_allocations jsonb := coalesce(p_inspection -> 'allocations', '[]'::jsonb);
  v_row_id uuid;
  v_upper numeric;
  r record;
begin
  -- INS-R01
  if v_name = '' then
    raise exception using errcode = 'P0001', message = 'Name is required.';
  end if;
  -- INS-R02
  if coalesce(p_inspection ->> 'value_type', '') = '' then
    raise exception using errcode = 'P0001', message = 'Value type is required.';
  end if;
  v_value_type := (p_inspection ->> 'value_type')::public.inspection_value_type;
  -- INS-R03
  if v_value_type = 'DROP_DOWN' and jsonb_array_length(v_options) = 0 then
    raise exception using errcode = 'P0001', message = 'This Inspection requires Drop-Down Options.';
  end if;

  if v_id is null then
    insert into public.inspection (
      name, description, value_type, is_required, active, nr_of_images_required
    ) values (
      v_name,
      coalesce(p_inspection ->> 'description', ''),
      v_value_type,
      coalesce((p_inspection ->> 'is_required')::boolean, true),
      coalesce((p_inspection ->> 'active')::boolean, true),
      coalesce((p_inspection ->> 'nr_of_images_required')::integer, 0)
    )
    returning id into v_id;
  else
    update public.inspection set
      name = v_name,
      description = coalesce(p_inspection ->> 'description', ''),
      value_type = v_value_type,
      is_required = coalesce((p_inspection ->> 'is_required')::boolean, true),
      active = coalesce((p_inspection ->> 'active')::boolean, true),
      nr_of_images_required = coalesce((p_inspection ->> 'nr_of_images_required')::integer, 0)
    where id = v_id;
    if not found then
      raise exception using errcode = '42501',
        message = 'Inspection not found, or you don''t have permission to edit it.';
    end if;
  end if;

  -- --------------------------------------------------------------------------
  -- Drop-down options (DROP_DOWN only)
  -- --------------------------------------------------------------------------
  if v_value_type = 'DROP_DOWN' then
    delete from public.inspection_drop_down_option o
    where o.inspection_id = v_id
      and o.id not in (
        select (e ->> 'id')::uuid
        from jsonb_array_elements(v_options) e
        where coalesce(e ->> 'id', '') <> ''
      );

    for r in
      select *
      from jsonb_to_recordset(v_options) as x(
        id uuid, name text, grading_id uuid,
        nr_of_images_required integer, priority integer, active boolean
      )
    loop
      -- IDO-R01 / IDO-R02
      if btrim(coalesce(r.name, '')) = '' then
        raise exception using errcode = 'P0001', message = 'Every drop-down option needs a name.';
      end if;
      if r.grading_id is null then
        raise exception using errcode = 'P0001',
          message = format('Drop-down option "%s" needs a grading.', btrim(r.name));
      end if;

      if r.id is null then
        insert into public.inspection_drop_down_option (
          inspection_id, name, grading_id, nr_of_images_required, priority, active
        ) values (
          v_id, btrim(r.name), r.grading_id,
          coalesce(r.nr_of_images_required, 0), coalesce(r.priority, 0), coalesce(r.active, true)
        );
      else
        update public.inspection_drop_down_option set
          name = btrim(r.name),
          grading_id = r.grading_id,
          nr_of_images_required = coalesce(r.nr_of_images_required, 0),
          priority = coalesce(r.priority, 0),
          active = coalesce(r.active, true)
        where id = r.id and inspection_id = v_id;
        if not found then
          raise exception using errcode = 'P0001', message = 'A drop-down option no longer exists — reload and try again.';
        end if;
      end if;
    end loop;
  end if;

  -- --------------------------------------------------------------------------
  -- Rules + their feedback (DECIMAL_VALUE only)
  -- --------------------------------------------------------------------------
  if v_value_type = 'DECIMAL_VALUE' then
    delete from public.inspection_rule ir
    where ir.inspection_id = v_id
      and ir.id not in (
        select (e ->> 'id')::uuid
        from jsonb_array_elements(v_rules) e
        where coalesce(e ->> 'id', '') <> ''
      );

    for r in
      select *
      from jsonb_to_recordset(v_rules) as x(
        id uuid, lower_limit numeric, upper_limit numeric,
        nr_of_images_required integer, grading_id uuid, feedback jsonb
      )
    loop
      -- IRR-R02: a reversed range collapses to [lower, lower] instead of failing.
      v_upper := greatest(coalesce(r.upper_limit, 0), coalesce(r.lower_limit, 0));

      if r.id is null then
        insert into public.inspection_rule (
          inspection_id, lower_limit, upper_limit, nr_of_images_required, grading_id
        ) values (
          v_id, coalesce(r.lower_limit, 0), v_upper, coalesce(r.nr_of_images_required, 0), r.grading_id
        )
        returning id into v_row_id;
      else
        update public.inspection_rule set
          lower_limit = coalesce(r.lower_limit, 0),
          upper_limit = v_upper,
          nr_of_images_required = coalesce(r.nr_of_images_required, 0),
          grading_id = r.grading_id
        where id = r.id and inspection_id = v_id;
        if not found then
          raise exception using errcode = 'P0001', message = 'A rule no longer exists — reload and try again.';
        end if;
        v_row_id := r.id;
      end if;

      if r.feedback is null or jsonb_typeof(r.feedback) = 'null' then
        delete from public.feedback where inspection_rule_id = v_row_id;
      else
        -- FBK-R01..R03 (also enforced by check constraints; checked here for
        -- readable messages).
        if char_length(coalesce(r.feedback ->> 'feedback', '')) < 5 then
          raise exception using errcode = 'P0001', message = 'Feedback must be at least 5 characters.';
        end if;
        if coalesce((r.feedback ->> 'max_nr_of_retries')::integer, 0) < 1 then
          raise exception using errcode = 'P0001', message = 'Feedback max nr of retries must be >= 1.';
        end if;
        if coalesce((r.feedback ->> 'auto_create_incident')::boolean, false)
          and coalesce(r.feedback ->> 'incident_type_id', '') = '' then
          raise exception using errcode = 'P0001',
            message = 'Feedback needs an incident type when "Auto create incident" is on.';
        end if;

        insert into public.feedback (
          inspection_rule_id, feedback, max_nr_of_retries, auto_create_incident, incident_type_id
        ) values (
          v_row_id,
          r.feedback ->> 'feedback',
          (r.feedback ->> 'max_nr_of_retries')::integer,
          coalesce((r.feedback ->> 'auto_create_incident')::boolean, false),
          nullif(r.feedback ->> 'incident_type_id', '')::uuid
        )
        on conflict (inspection_rule_id) do update set
          feedback = excluded.feedback,
          max_nr_of_retries = excluded.max_nr_of_retries,
          auto_create_incident = excluded.auto_create_incident,
          incident_type_id = excluded.incident_type_id;
      end if;
    end loop;

    -- IRR-R01: flag the rule with the lowest bound.
    update public.inspection_rule ir
    set is_first = (ir.id = f.id)
    from (
      select id
      from public.inspection_rule
      where inspection_id = v_id
      order by lower_limit, upper_limit, legacy_uid
      limit 1
    ) f
    where ir.inspection_id = v_id
      and ir.is_first is distinct from (ir.id = f.id);
  end if;

  -- --------------------------------------------------------------------------
  -- Asset type allocations (always)
  -- --------------------------------------------------------------------------
  delete from public.inspection_allocation ia
  where ia.inspection_id = v_id
    and ia.id not in (
      select (e ->> 'id')::uuid
      from jsonb_array_elements(v_allocations) e
      where coalesce(e ->> 'id', '') <> ''
    );

  for r in
    select * from jsonb_to_recordset(v_allocations) as x(id uuid, asset_type_id uuid)
  loop
    -- IAA-R01
    if r.asset_type_id is null then
      raise exception using errcode = 'P0001', message = 'Every allocation needs an asset type.';
    end if;
    if r.id is null then
      insert into public.inspection_allocation (inspection_id, asset_type_id)
      values (v_id, r.asset_type_id);
    else
      update public.inspection_allocation
      set asset_type_id = r.asset_type_id
      where id = r.id and inspection_id = v_id and asset_type_id is distinct from r.asset_type_id;
    end if;
  end loop;

  return v_id;
end;
$$;

-- ============================================================================
-- reorder_inspection_allocations — the AssetType page's drag-reorder
-- (Masterdata.ACT_InspectionAllocation_UpdateSortOrder): rewrite priority as
-- 1..n in the given order, atomically. SECURITY INVOKER (RLS applies).
-- ============================================================================
create function public.reorder_inspection_allocations(
  p_asset_type_id uuid,
  p_ordered_ids uuid[]
)
returns void
language sql
set search_path = public
as $$
  update public.inspection_allocation ia
  set priority = o.ord
  from unnest(p_ordered_ids) with ordinality as o(id, ord)
  where ia.id = o.id
    and ia.asset_type_id = p_asset_type_id
    and ia.priority is distinct from o.ord;
$$;

-- ============================================================================
-- list_subscribable_accounts — the IncidentSubscription Account picker and
-- subscriber grid (Mendix Administration.Account FullName/Email, filtered to
-- accounts with an email). auth.users isn't readable through the API, so this
-- is SECURITY DEFINER and returns nothing unless the caller holds a role.
-- ============================================================================
create function public.list_subscribable_accounts()
returns table (id uuid, username text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, coalesce(p.username, u.email::text), u.email::text
  from auth.users u
  left join public.profiles p on p.id = u.id
  where coalesce(u.email, '') <> ''
    and public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[])
  order by 2;
$$;

revoke execute on function public.list_subscribable_accounts() from public, anon;
grant execute on function public.list_subscribable_accounts() to authenticated;
