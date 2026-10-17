-- Water-quality readings taken during inspections.
--
-- Field teams measure some water-quality parameters on site (pH, EC, free
-- chlorine, …) as part of an inspection. An Inspection can now be flagged as a
-- water-quality parameter and linked to the quality_parameter it measures, so
-- those readings sit next to the lab results: water_quality_reading lists both,
-- per location and day, checked against the same parameter limits.
--
-- Only DECIMAL_VALUE inspections can be linked (a reading is a number). The
-- inspection's own rules still grade the value in the field; the report uses
-- the parameter's limits, as lab results do.

alter table public.inspection
  add column is_water_quality_parameter boolean not null default false,
  -- Blocked while an inspection measures it (the Parameters page says so).
  add column quality_parameter_id uuid references public.quality_parameter (id) on delete restrict,
  add constraint inspection_quality_parameter_check check (
    (not is_water_quality_parameter and quality_parameter_id is null)
    or (is_water_quality_parameter and quality_parameter_id is not null
        and value_type = 'DECIMAL_VALUE')
  );

create index inspection_quality_parameter_id_idx on public.inspection (quality_parameter_id)
  where quality_parameter_id is not null;

-- ============================================================================
-- save_inspection — as before, plus is_water_quality_parameter and
-- quality_parameter_id in the payload.
-- ============================================================================
create or replace function public.save_inspection(p_inspection jsonb)
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
  v_is_quality boolean := coalesce((p_inspection ->> 'is_water_quality_parameter')::boolean, false);
  v_parameter_id uuid := nullif(p_inspection ->> 'quality_parameter_id', '')::uuid;
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
  -- Water-quality parameter (also enforced by inspection_quality_parameter_check).
  if v_is_quality then
    if v_value_type <> 'DECIMAL_VALUE' then
      raise exception using errcode = 'P0001',
        message = 'A water quality parameter must be a DECIMAL_VALUE inspection.';
    end if;
    if v_parameter_id is null then
      raise exception using errcode = 'P0001', message = 'Select the quality parameter this inspection measures.';
    end if;
  else
    v_parameter_id := null;
  end if;

  if v_id is null then
    insert into public.inspection (
      name, description, value_type, is_required, active, nr_of_images_required,
      is_water_quality_parameter, quality_parameter_id
    ) values (
      v_name,
      coalesce(p_inspection ->> 'description', ''),
      v_value_type,
      coalesce((p_inspection ->> 'is_required')::boolean, true),
      coalesce((p_inspection ->> 'active')::boolean, true),
      coalesce((p_inspection ->> 'nr_of_images_required')::integer, 0),
      v_is_quality,
      v_parameter_id
    )
    returning id into v_id;
  else
    update public.inspection set
      name = v_name,
      description = coalesce(p_inspection ->> 'description', ''),
      value_type = v_value_type,
      is_required = coalesce((p_inspection ->> 'is_required')::boolean, true),
      active = coalesce((p_inspection ->> 'active')::boolean, true),
      nr_of_images_required = coalesce((p_inspection ->> 'nr_of_images_required')::integer, 0),
      is_water_quality_parameter = v_is_quality,
      quality_parameter_id = v_parameter_id
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
-- water_quality_reading — every quality reading, lab or site, one row per
-- value, checked against the parameter's current limits (lab_result_status).
--   source       'lab' (an imported certificate) or 'site' (an inspection)
--   reference    the lab no, or the inspection activity's UID
--   sampled_on   the day, in the app's time zone for site readings
-- Site readings are the current value of each flagged inspection (superseded
-- Feedback attempts are left out), filed under the inspection's current
-- parameter. security_invoker: lab rows need a quality reader and site rows
-- an inspection reader (today both are every masterdata role).
-- ============================================================================
create view public.water_quality_reading
with (security_invoker = true)
as
select w.source, w.id, w.location_id, w.asset_id, w.asset_name, w.sampled_on, w.sampled_at,
       w.reference, w.sample_id, w.inspection_activity_id, w.parameter_id, w.value, w.below_detection,
       l.name as location_name, l.region_id, l.organisation_id,
       p.name as parameter_name, p.short_name as parameter_short_name, p.unit,
       p.min_acceptable, p.max_acceptable, p.decimals, p.sort_order,
       public.lab_result_status(w.value, w.below_detection, p.min_acceptable, p.max_acceptable) as status
from (
  select 'lab'::text as source,
         r.id,
         s.location_id,
         null::uuid as asset_id,
         null::text as asset_name,
         s.sampled_on,
         null::timestamptz as sampled_at,
         s.lab_no as reference,
         s.id as sample_id,
         null::uuid as inspection_activity_id,
         r.parameter_id,
         r.value,
         r.below_detection
  from public.lab_result r
  join public.lab_sample s on s.id = r.sample_id
  union all
  select 'site',
         v.id,
         a.location_id,
         a.id,
         a.name,
         (ia.inspection_date at time zone public.app_time_zone())::date,
         ia.inspection_date,
         ia.legacy_uid::text,
         null,
         ia.id,
         i.quality_parameter_id,
         v.decimal_value,
         false
  from public.inspection_value v
  join public.inspection i on i.id = v.inspection_id
  join public.inspection_activity ia on ia.id = v.inspection_activity_id
  join public.asset a on a.id = ia.asset_id
  where i.is_water_quality_parameter
    and v.is_current
) w
join public.location l on l.id = w.location_id
join public.quality_parameter p on p.id = w.parameter_id;

grant select on public.water_quality_reading to authenticated;
