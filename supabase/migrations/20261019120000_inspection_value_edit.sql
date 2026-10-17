-- ============================================================================
-- update_inspection_value — Inspection_Overview → Inspection Values → Edit,
-- admins only. Corrects one value's answer after the fact, with the same
-- derived fields save_inspection_activity writes (validation §4–§5):
--
--   * the value's display value and, for DROP_DOWN / DECIMAL_VALUE, grading;
--   * the activity's grading (highest-priority grading among its values);
--   * for CUMULATIVE_VALUE, the cumulative store — only when this is the
--     asset's latest current reading for that inspection, so correcting an
--     old reading doesn't wind the store back. The audit records the change
--     against this activity.
--
-- Only the field for the inspection's value type is read from the payload;
-- the others are left as they are. The capture checks that depend on the
-- moment of capture (photos, feedback retries, auto-created incidents, the
-- cumulative ">= previous" rule) are not repeated: this is an admin
-- correction. "Required" still applies.
--
-- Payload: { text_value, decimal_value, date_value, drop_down_option_id }
-- ============================================================================
create function public.update_inspection_value(p_value_id uuid, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value public.inspection_value;
  v_activity public.inspection_activity;
  v_insp public.inspection;
  v_option public.inspection_drop_down_option;
  v_option_id uuid;
  v_text text;
  v_dec numeric;
  v_date timestamptz;
  v_grading_id uuid;
  v_display text;
  v_tz text := public.app_time_zone();
begin
  if not public.is_inspection_admin() then
    raise exception using errcode = '42501', message = 'Only admins can edit inspection values.';
  end if;

  select * into v_value from public.inspection_value where id = p_value_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'That inspection value no longer exists.';
  end if;
  select * into v_activity from public.inspection_activity where id = v_value.inspection_activity_id for update;
  select * into v_insp from public.inspection where id = v_value.inspection_id;

  v_option_id := v_value.inspection_drop_down_option_id;
  v_text := v_value.text_value;
  v_dec := v_value.decimal_value;
  v_date := v_value.date_value;
  v_grading_id := v_value.grading_id;

  case v_insp.value_type
    when 'DROP_DOWN' then
      v_option_id := nullif(p_value ->> 'drop_down_option_id', '')::uuid;
      if v_option_id is not null then
        select * into v_option from public.inspection_drop_down_option
        where id = v_option_id and inspection_id = v_insp.id;
        if not found then
          raise exception using errcode = 'P0001',
            message = format('The option chosen for "%s" no longer exists.', v_insp.name);
        end if;
      elsif v_insp.is_required then
        raise exception using errcode = 'P0001', message = format('"%s" is required.', v_insp.name);
      end if;
      v_grading_id := v_option.grading_id;
      v_display := coalesce(v_option.name, '');
    when 'DATETIME' then
      v_date := nullif(p_value ->> 'date_value', '')::timestamptz;
      if v_date is null and v_insp.is_required then
        raise exception using errcode = 'P0001', message = format('"%s" is required.', v_insp.name);
      end if;
      v_display := coalesce(to_char(v_date at time zone v_tz, 'DD Mon YYYY, HH24:MI'), '');
    when 'TEXT' then
      v_text := coalesce(p_value ->> 'text_value', '');
      if btrim(v_text) = '' and v_insp.is_required then
        raise exception using errcode = 'P0001', message = format('"%s" is required.', v_insp.name);
      end if;
      v_display := v_text;
    else
      -- DECIMAL_VALUE, CUMULATIVE_VALUE
      v_dec := nullif(p_value ->> 'decimal_value', '')::numeric;
      if v_dec is null then
        raise exception using errcode = 'P0001', message = 'Enter a number.';
      end if;
      v_display := public.format_inspection_number(round(v_dec, 2));
      if v_insp.value_type = 'DECIMAL_VALUE' then
        select grading_id into v_grading_id
        from public.inspection_rule
        where inspection_id = v_insp.id
          and lower_limit <= v_dec
          and v_dec < upper_limit
        order by legacy_uid
        limit 1;
      end if;
  end case;

  update public.inspection_value
  set inspection_drop_down_option_id = v_option_id,
      grading_id = v_grading_id,
      text_value = v_text,
      decimal_value = v_dec,
      date_value = v_date,
      display_value = left(v_display, 200)
  where id = p_value_id;

  -- §4 Activity grading.
  update public.inspection_activity a
  set grading_id = (
        select g.id
        from public.inspection_value iv
        join public.grading g on g.id = iv.grading_id
        where iv.inspection_activity_id = a.id
        order by g.priority desc, g.legacy_uid
        limit 1
      ),
      updated_by = auth.uid()
  where a.id = v_activity.id;

  -- §5.2 Cumulative store, from the asset's latest current reading only.
  if v_insp.value_type = 'CUMULATIVE_VALUE' and v_value.is_current and not exists (
    select 1
    from public.inspection_value iv
    join public.inspection_activity ia on ia.id = iv.inspection_activity_id
    where iv.inspection_id = v_insp.id
      and iv.is_current
      and ia.asset_id = v_activity.asset_id
      and (ia.inspection_date, ia.legacy_uid) > (v_activity.inspection_date, v_activity.legacy_uid)
  ) then
    perform set_config('aquafix.inspection_activity_id', v_activity.id::text, true);
    insert into public.inspection_cumulative_value (inspection_id, asset_id, latest_value)
    values (v_insp.id, v_activity.asset_id, v_dec)
    on conflict (inspection_id, asset_id) do update set latest_value = excluded.latest_value;
  end if;
end;
$$;

revoke execute on function public.update_inspection_value(uuid, jsonb) from public, anon;
grant execute on function public.update_inspection_value(uuid, jsonb) to authenticated;

-- ============================================================================
-- The back-office grids now load every activity and value (not the newest
-- 1000). A bare function call in a policy is evaluated for every row, and
-- each page of 1000 sorts the whole table first; wrapped in a sub-select it
-- runs once per query (≈20x faster on 23k values). Same rule, same result.
-- The master data embedded in every row (asset, its type and location, the
-- inspection, the grading and its colour) gets the same treatment.
-- ============================================================================
alter policy inspection_activity_select on public.inspection_activity
  using ((select public.is_inspection_reader()));
alter policy inspection_value_select on public.inspection_value
  using ((select public.is_inspection_reader()));
alter policy inspection_image_select on public.inspection_image
  using ((select public.is_inspection_reader()));
alter policy inspection_cumulative_value_select on public.inspection_cumulative_value
  using ((select public.is_inspection_reader()));

do $$
declare
  t text;
begin
  foreach t in array array['asset', 'asset_type', 'location', 'inspection', 'grading', 'colour_container']
  loop
    execute format(
      $sql$
        alter policy %1$I_select on public.%1$I
          using ((select public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[])));
      $sql$,
      t
    );
  end loop;
end;
$$;
