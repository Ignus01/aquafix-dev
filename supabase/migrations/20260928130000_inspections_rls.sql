-- RLS, RPCs and Storage for inspections (spec/inspections/access-matrix.md,
-- "Rebuild recommendation"). The Mendix module roles map onto the existing
-- `masterdata_role` assignments, as the other sections do.
--
-- Mendix had no row-level constraints, and field users could read and edit
-- every activity and instruction through the client API. The rebuild:
--   scheduled_instruction, public_holiday   read: every role · write: admins
--   instruction, instruction_asset_allocation
--                   read: admins and viewers see all; field users see the
--                   instructions assigned to them · write: admins. Progress
--                   (allocation ticks, status) only changes through the
--                   inspection save.
--   inspection_activity / _value / _image
--                   read: every role (as incidents) · write: only through
--                   save_inspection_activity (field users: new inspections,
--                   and their own from today) · delete: admins, through
--                   delete_inspection_activity.
--   inspection_cumulative_value
--                   read: every role · manual override: admins (audited).
--   Issuing: the pg_cron job, plus the admin-only run_instruction_schedule.

create function public.is_inspection_reader()
returns boolean
language sql
stable
as $$
  select public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[]);
$$;

create function public.is_inspection_writer()
returns boolean
language sql
stable
as $$
  select public.has_masterdata_role(array['system_admin','admin','user']::public.masterdata_role[]);
$$;

create function public.is_inspection_admin()
returns boolean
language sql
stable
as $$
  select public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]);
$$;

-- Admins and viewers read every instruction; a field user only their own.
create function public.can_read_all_instructions()
returns boolean
language sql
stable
as $$
  select public.has_masterdata_role(array['system_admin','admin','viewer']::public.masterdata_role[]);
$$;

-- ============================================================================
-- public_holiday, scheduled_instruction, scheduled_instruction_asset
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['public_holiday', 'scheduled_instruction', 'scheduled_instruction_asset']
  loop
    execute format(
      $sql$
        create policy %1$I_select on public.%1$I for select
          to authenticated
          using (public.is_inspection_reader());

        create policy %1$I_insert on public.%1$I for insert
          to authenticated
          with check (public.is_inspection_admin());

        create policy %1$I_update on public.%1$I for update
          to authenticated
          using (public.is_inspection_admin())
          with check (public.is_inspection_admin());

        create policy %1$I_delete on public.%1$I for delete
          to authenticated
          using (public.is_inspection_admin());
      $sql$,
      t
    );
  end loop;
end;
$$;

-- ============================================================================
-- instruction
-- ============================================================================
create policy instruction_select on public.instruction for select
  to authenticated
  using (
    public.can_read_all_instructions()
    or (public.is_inspection_writer() and account_id = auth.uid())
  );

create policy instruction_insert on public.instruction for insert
  to authenticated
  with check (public.is_inspection_admin());

create policy instruction_update on public.instruction for update
  to authenticated
  using (public.is_inspection_admin())
  with check (public.is_inspection_admin());

create policy instruction_delete on public.instruction for delete
  to authenticated
  using (public.is_inspection_admin());

-- Status and counters are derived (refresh_instruction_progress); the
-- schedule link and issue day are set by the issuing job.
revoke insert, update on public.instruction from anon, authenticated;
grant insert (name, comment, required_completed_date, account_id) on public.instruction to authenticated;
grant update (name, comment, required_completed_date, account_id) on public.instruction to authenticated;

-- ============================================================================
-- instruction_asset_allocation
-- ============================================================================
create policy instruction_asset_allocation_select on public.instruction_asset_allocation for select
  to authenticated
  using (
    public.can_read_all_instructions()
    or exists (
      select 1 from public.instruction i
      where i.id = instruction_asset_allocation.instruction_id
        and i.account_id = auth.uid()
        and public.is_inspection_writer()
    )
  );

create policy instruction_asset_allocation_insert on public.instruction_asset_allocation for insert
  to authenticated
  with check (public.is_inspection_admin());

create policy instruction_asset_allocation_delete on public.instruction_asset_allocation for delete
  to authenticated
  using (public.is_inspection_admin());

-- is_completed is only set by save_inspection_activity.
revoke insert, update on public.instruction_asset_allocation from anon, authenticated;
grant insert (instruction_id, asset_id) on public.instruction_asset_allocation to authenticated;

-- ============================================================================
-- inspection_activity, inspection_value, inspection_image — read-only for
-- clients; written by save_inspection_activity / delete_inspection_activity.
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['inspection_activity', 'inspection_value', 'inspection_image']
  loop
    execute format(
      $sql$
        create policy %1$I_select on public.%1$I for select
          to authenticated
          using (public.is_inspection_reader());

        revoke insert, update, delete on public.%1$I from anon, authenticated;
      $sql$,
      t
    );
  end loop;
end;
$$;

-- ============================================================================
-- inspection_cumulative_value — admins can override latest_value
-- (InspectionCumulativeValue_Edit); the trigger audits every change.
-- ============================================================================
create policy inspection_cumulative_value_select on public.inspection_cumulative_value for select
  to authenticated
  using (public.is_inspection_reader());

create policy inspection_cumulative_value_update on public.inspection_cumulative_value for update
  to authenticated
  using (public.is_inspection_admin())
  with check (public.is_inspection_admin());

revoke insert, update, delete on public.inspection_cumulative_value from anon, authenticated;
grant update (latest_value) on public.inspection_cumulative_value to authenticated;

create policy inspection_cumulative_value_change_select on public.inspection_cumulative_value_change for select
  to authenticated
  using (public.is_inspection_admin());

revoke insert, update, delete on public.inspection_cumulative_value_change from anon, authenticated;

-- ============================================================================
-- instruction_schedule_run — admins can see the issuing log
-- ============================================================================
create policy instruction_schedule_run_select on public.instruction_schedule_run for select
  to authenticated
  using (public.is_inspection_admin());

revoke insert, update, delete on public.instruction_schedule_run from anon, authenticated;

-- ============================================================================
-- Auto-created incidents send no email (validation §3.4: they bypass
-- ACT_Incident_Save, and so Incident_SendEmail). save_inspection_activity
-- sets this transaction-local flag before inserting one.
-- ============================================================================
create or replace function public.queue_incident_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.system_settings;
  v_type_name text;
  v_reason text;
  v_recipients integer;
begin
  if current_setting('aquafix.skip_incident_notifications', true) = 'on' then
    return null;
  end if;

  select name into v_type_name from public.incident_type where id = new.incident_type_id;

  select count(*) into v_recipients
  from public.incident_notification_recipients(new.incident_type_id);
  -- Nobody subscribed: nothing to send and nothing to log (as in Mendix).
  if v_recipients = 0 then
    return null;
  end if;

  -- EML-R03: kill switch and configuration check.
  select * into v_settings from public.system_settings where id = 1;
  if not coalesce(v_settings.email_enabled, false) then
    v_reason := 'email disabled';
  elsif v_settings.brevo_secret_id is null then
    v_reason := 'no api key';
  elsif coalesce(v_settings.sender_email, '') = '' then
    v_reason := 'no sender email';
  end if;

  if v_reason is not null then
    insert into public.email_log (incident_id, subject, status, error_reason, response_body)
    values (
      new.id,
      v_type_name || ': ' || new.reference,
      'skipped',
      v_reason,
      format('%s subscriber(s) not notified.', v_recipients)
    );
    return null;
  end if;

  insert into public.email_outbox (incident_id, recipient_email, recipient_name)
  select new.id, r.email, r.name
  from public.incident_notification_recipients(new.incident_type_id) r
  on conflict (incident_id, recipient_email, template) do nothing;

  return null;
end;
$$;

-- ============================================================================
-- Number formatting shared by the save: Mendix toString(Decimal) has no
-- trailing zeros ("7.5", "12", "0.6").
-- ============================================================================
create function public.format_inspection_number(p_value numeric)
returns text
language sql
immutable
as $$
  select trim_scale(p_value)::text;
$$;

-- ============================================================================
-- save_inspection_activity — ACT_InspectionActivity_Save, the normative
-- algorithm in spec/inspections/inspection-value-validation.md (§2–§5).
--
-- The capture page holds the activity in memory, as Mendix does, and sends
-- all of it here on Save. Nothing is written unless every value is valid,
-- except an auto-created Incident (C5), which is kept even when the save
-- then fails [AS-IS, V6].
--
-- Payload:
--   { id?            existing activity (edit, IAC-R06) — omit for a new one,
--     asset_id,      new only
--     instruction_id new only; null for an ad-hoc inspection
--     values: [ {    in page order (the association order)
--       id,          client-generated uuid for new rows
--       inspection_id, is_current,
--       text_value, decimal_value, date_value, drop_down_option_id,
--       images: [ { id } | { storage_path, thumbnail_path, mime_type, size_bytes } ] } ] }
--
-- Returns
--   { ok: true, id, legacy_uid, removed_paths }        saved
--   { ok: false, messages: [ { kind: 'field' | 'popup', value_id, field?, message } ],
--     retries: [ { superseded_id, new_id, inspection_id } ] }
-- On ok:false the client marks each superseded value read-only and adds a
-- blank current value with new_id after it (C4).
--
-- Deviations from Mendix, signed off: V1 ("Required" for DATETIME/TEXT is
-- reported against date_value/text_value), V8 (a superseded value with no
-- matching rule needs 0 images instead of raising) and V9 (checks B and D
-- both use the number of images in the payload). V2 cannot occur: an
-- inspection's value_type is NOT NULL here.
--
-- SECURITY DEFINER: field users have no direct write rights on activities,
-- instructions or the cumulative store. Every check is made here.
-- ============================================================================
create function public.save_inspection_activity(p_activity jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := nullif(p_activity ->> 'id', '')::uuid;
  v_asset_id uuid := nullif(p_activity ->> 'asset_id', '')::uuid;
  v_instruction_id uuid := nullif(p_activity ->> 'instruction_id', '')::uuid;
  v_payload jsonb := coalesce(p_activity -> 'values', '[]'::jsonb);
  v_values jsonb := '[]'::jsonb;
  v_activity public.inspection_activity;
  v_asset public.asset;
  v_allocation public.instruction_asset_allocation;
  v_existing public.inspection_value;
  v_insp public.inspection;
  v_rule public.inspection_rule;
  v_fb public.feedback;
  v_option public.inspection_drop_down_option;
  v jsonb;
  img jsonb;
  v_value_id uuid;
  v_is_current boolean;
  v_dec numeric;
  v_latest numeric;
  v_image_count integer;
  v_req integer;
  v_attempts integer;
  v_ok boolean;
  v_valid boolean := true;
  v_messages jsonb := '[]'::jsonb;
  v_retries jsonb := '[]'::jsonb;
  v_retry_counts jsonb := '{}'::jsonb;
  v_grading_id uuid;
  v_gradings uuid[] := '{}';
  v_display text;
  v_keep uuid[];
  v_removed text[] := '{}';
  v_paths text[];
  v_order integer := 0;
  v_tz text := public.app_time_zone();
begin
  if not public.is_inspection_writer() then
    raise exception using errcode = '42501', message = 'You don''t have permission to save inspections.';
  end if;
  if jsonb_typeof(v_payload) <> 'array' then
    raise exception using errcode = 'P0001', message = 'The inspection has no values.';
  end if;

  -- --------------------------------------------------------------------------
  -- The activity, the asset and the instruction allocation
  -- --------------------------------------------------------------------------
  if v_id is not null then
    select * into v_activity from public.inspection_activity where id = v_id for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'That inspection no longer exists.';
    end if;
    -- IAC-R06: the inspector's own activities from today.
    if v_activity.created_by is distinct from v_uid
      or (v_activity.inspection_date at time zone v_tz)::date <> public.app_today() then
      raise exception using errcode = '42501',
        message = 'You can only edit your own inspections from today.';
    end if;
    v_asset_id := v_activity.asset_id;
    v_instruction_id := v_activity.instruction_id;
  elsif v_asset_id is null then
    raise exception using errcode = 'P0001', message = 'Asset is required.';
  end if;

  select * into v_asset from public.asset where id = v_asset_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'That asset no longer exists.';
  end if;

  if v_id is null and v_instruction_id is not null then
    select * into v_allocation
    from public.instruction_asset_allocation
    where instruction_id = v_instruction_id and asset_id = v_asset_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'This asset is not on that instruction.';
    end if;
    -- INS-R07: a completed allocation can't be inspected again.
    if v_allocation.is_completed then
      raise exception using errcode = 'P0001',
        message = format('%s has already been Inspected.', v_asset.name);
    end if;
  end if;

  -- --------------------------------------------------------------------------
  -- Normalise the payload. Existing superseded values stay superseded and
  -- keep their reading (read-only on the page); ids and images must belong
  -- where they claim to.
  -- --------------------------------------------------------------------------
  for v in select value from jsonb_array_elements(v_payload)
  loop
    v_value_id := nullif(v ->> 'id', '')::uuid;
    if v_value_id is null then
      raise exception using errcode = 'P0001', message = 'Every value needs an id.';
    end if;

    select * into v_insp from public.inspection where id = nullif(v ->> 'inspection_id', '')::uuid;
    if not found then
      raise exception using errcode = 'P0001', message = 'An inspection on this form no longer exists — reload and try again.';
    end if;

    v_existing := null;
    select * into v_existing from public.inspection_value where id = v_value_id;
    if found and v_existing.inspection_activity_id is distinct from v_id then
      raise exception using errcode = 'P0001', message = 'A value on this form belongs to another inspection.';
    end if;
    if v_existing.id is not null and v_existing.inspection_id <> v_insp.id then
      raise exception using errcode = 'P0001', message = 'A value on this form changed inspection — reload and try again.';
    end if;

    if nullif(v ->> 'drop_down_option_id', '') is not null and not exists (
      select 1 from public.inspection_drop_down_option o
      where o.id = (v ->> 'drop_down_option_id')::uuid and o.inspection_id = v_insp.id
    ) then
      raise exception using errcode = 'P0001',
        message = format('The option chosen for "%s" no longer exists.', v_insp.name);
    end if;

    for img in select value from jsonb_array_elements(coalesce(v -> 'images', '[]'::jsonb))
    loop
      if nullif(img ->> 'id', '') is not null then
        if not exists (
          select 1 from public.inspection_image i
          where i.id = (img ->> 'id')::uuid and i.inspection_value_id = v_value_id
        ) then
          raise exception using errcode = 'P0001', message = 'A photo on this form no longer exists — reload and try again.';
        end if;
      elsif split_part(coalesce(img ->> 'storage_path', ''), '/', 1) <> v_uid::text
        or (nullif(img ->> 'thumbnail_path', '') is not null
            and split_part(img ->> 'thumbnail_path', '/', 1) <> v_uid::text)
        or coalesce(img ->> 'mime_type', '') not like 'image/%' then
        raise exception using errcode = '42501', message = 'You can only attach photos you uploaded yourself.';
      end if;
    end loop;

    v_is_current := case
      when v_existing.id is not null and not v_existing.is_current then false
      else coalesce((v ->> 'is_current')::boolean, true)
    end;

    v_values := v_values || jsonb_build_object(
      'id', v_value_id,
      'inspection_id', v_insp.id,
      'value_type', v_insp.value_type,
      'is_new', v_existing.id is null,
      'is_current', v_is_current,
      'text_value', coalesce(v ->> 'text_value', ''),
      'decimal_value', case
        when v_existing.id is not null and not v_existing.is_current then v_existing.decimal_value
        else coalesce(nullif(v ->> 'decimal_value', '')::numeric, 0)
      end,
      'date_value', nullif(v ->> 'date_value', ''),
      'drop_down_option_id', nullif(v ->> 'drop_down_option_id', ''),
      'images', coalesce(v -> 'images', '[]'::jsonb)
    );
  end loop;

  -- --------------------------------------------------------------------------
  -- §3 Validation. Every value is validated, even after one has failed, so
  -- all messages and side effects happen in one Save (§3.1).
  -- --------------------------------------------------------------------------
  for v in select value from jsonb_array_elements(v_values)
  loop
    v_ok := true;
    select * into v_insp from public.inspection where id = (v ->> 'inspection_id')::uuid;
    v_dec := (v ->> 'decimal_value')::numeric;
    v_image_count := jsonb_array_length(v -> 'images');

    -- A. Answer present / monotonic — only when the Inspection is required.
    if v_insp.is_required then
      if v_insp.value_type = 'DROP_DOWN' and v ->> 'drop_down_option_id' is null then
        v_ok := false;                                                            -- A1
        v_messages := v_messages || jsonb_build_object(
          'kind', 'field', 'value_id', v ->> 'id', 'field', 'drop_down_option_id', 'message', 'Required');
      elsif v_insp.value_type = 'DATETIME' and v ->> 'date_value' is null then
        v_ok := false;                                                            -- A2 (V1)
        v_messages := v_messages || jsonb_build_object(
          'kind', 'field', 'value_id', v ->> 'id', 'field', 'date_value', 'message', 'Required');
      elsif v_insp.value_type = 'TEXT' and v ->> 'text_value' = '' then
        v_ok := false;                                                            -- A3 (V1)
        v_messages := v_messages || jsonb_build_object(
          'kind', 'field', 'value_id', v ->> 'id', 'field', 'text_value', 'message', 'Required');
      elsif v_insp.value_type = 'CUMULATIVE_VALUE' then
        select latest_value into v_latest
        from public.inspection_cumulative_value
        where inspection_id = v_insp.id and asset_id = v_asset_id;
        v_latest := coalesce(v_latest, 0);
        if not (v_dec >= v_latest) then
          v_ok := false;                                                          -- A5
          v_messages := v_messages || jsonb_build_object(
            'kind', 'field', 'value_id', v ->> 'id', 'field', 'decimal_value',
            'message', 'Must be >= to previous value of ' || public.format_inspection_number(v_latest));
        end if;
      end if;
      -- A4 (DECIMAL_VALUE "Required") never fires: the value defaults to 0.
    end if;

    -- B. Inspection-level minimum images (every type, required or not).
    if v_image_count < v_insp.nr_of_images_required then
      v_ok := false;                                                              -- B1
      v_messages := v_messages || jsonb_build_object(
        'kind', 'popup', 'value_id', v ->> 'id',
        'message', v_insp.name || E' Image Required.\n' || v_image_count
          || ' were taken but ' || v_insp.nr_of_images_required || ' are required.');
    end if;

    if v_ok then
      -- C. Grading-driven requirements.
      v_req := 0;
      if v_insp.value_type = 'DROP_DOWN' then
        v_req := v_insp.nr_of_images_required;                                    -- C1 [AS-IS]
      elsif v_insp.value_type = 'DECIMAL_VALUE' then
        v_rule := null;
        select * into v_rule
        from public.inspection_rule
        where inspection_id = v_insp.id
          and lower_limit <= v_dec
          and v_dec < upper_limit
        order by legacy_uid
        limit 1;

        if (v ->> 'is_current')::boolean then
          if v_rule.id is not null then                                           -- (C2: no rule, valid)
            v_fb := null;
            select * into v_fb from public.feedback where inspection_rule_id = v_rule.id;
            if v_fb.id is null then
              v_req := v_rule.nr_of_images_required;                              -- C3
            else
              -- attempts(v): every value for this Inspection on the form, plus
              -- retries created earlier in this same Save.
              select count(*) into v_attempts
              from jsonb_array_elements(v_values) e
              where e ->> 'inspection_id' = v_insp.id::text;
              v_attempts := v_attempts + coalesce((v_retry_counts ->> v_insp.id::text)::integer, 0);

              if v_attempts <= v_fb.max_nr_of_retries then                        -- C4: force a retry
                v_ok := false;
                v_retries := v_retries || jsonb_build_object(
                  'superseded_id', v ->> 'id',
                  'new_id', gen_random_uuid(),
                  'inspection_id', v_insp.id);
                v_retry_counts := v_retry_counts || jsonb_build_object(
                  v_insp.id::text, coalesce((v_retry_counts ->> v_insp.id::text)::integer, 0) + 1);
                v_messages := v_messages || jsonb_build_object(
                  'kind', 'popup', 'value_id', v ->> 'id', 'message', v_fb.feedback);
              elsif v_fb.auto_create_incident then                                -- C5: accepted
                -- Committed now, even if this Save fails [AS-IS, V6]. No
                -- validation and no email (§3.4).
                perform set_config('aquafix.skip_incident_notifications', 'on', true);
                insert into public.incident (location_id, incident_type_id, comment, status, incident_date)
                values (
                  v_asset.location_id,
                  v_fb.incident_type_id,
                  'Auto Created Incident: ' || v_asset.name || ' ' || v_insp.name
                    || ' is ' || public.format_inspection_number(v_dec),
                  'new',
                  now()
                );
              end if;
            end if;
          end if;
        else
          v_req := coalesce(v_rule.nr_of_images_required, 0);                     -- C6 (V8)
        end if;
      end if;
      -- C7: CUMULATIVE_VALUE, DATETIME and TEXT have no grading requirements.

      -- D. Grading-driven images.
      if v_ok and v_image_count < v_req then
        v_ok := false;                                                            -- D1
        v_messages := v_messages || jsonb_build_object(
          'kind', 'popup', 'value_id', v ->> 'id',
          'message', v_insp.name || E' Image Required due to Grading!\n' || v_image_count
            || ' were taken but ' || v_req || ' are required.');
      end if;
    end if;

    v_valid := v_valid and v_ok;
  end loop;

  if not v_valid then
    return jsonb_build_object('ok', false, 'messages', v_messages, 'retries', v_retries);
  end if;

  -- --------------------------------------------------------------------------
  -- §2 Save: the activity, then each value with its display value, grading,
  -- photos and cumulative reading.
  -- --------------------------------------------------------------------------
  if v_id is null then
    insert into public.inspection_activity (asset_id, instruction_id, inspection_date, created_by, updated_by)
    values (v_asset_id, v_instruction_id, now(), v_uid, v_uid)
    returning * into v_activity;
    v_id := v_activity.id;
  else
    update public.inspection_activity set updated_by = v_uid where id = v_id
    returning * into v_activity;
  end if;

  -- The cumulative-store audit attributes its changes to this activity.
  perform set_config('aquafix.inspection_activity_id', v_id::text, true);

  for v in select value from jsonb_array_elements(v_values)
  loop
    v_order := v_order + 1;
    v_value_id := (v ->> 'id')::uuid;
    select * into v_insp from public.inspection where id = (v ->> 'inspection_id')::uuid;
    v_dec := (v ->> 'decimal_value')::numeric;

    -- §4 Grading of the value. Other types return null and leave the value's
    -- grading unchanged.
    v_grading_id := null;
    v_option := null;
    if v ->> 'drop_down_option_id' is not null then
      select * into v_option from public.inspection_drop_down_option
      where id = (v ->> 'drop_down_option_id')::uuid;
    end if;
    if v_insp.value_type = 'DROP_DOWN' then
      v_grading_id := v_option.grading_id;
    elsif v_insp.value_type = 'DECIMAL_VALUE' then
      select grading_id into v_grading_id
      from public.inspection_rule
      where inspection_id = v_insp.id
        and lower_limit <= v_dec
        and v_dec < upper_limit
      order by legacy_uid
      limit 1;
    end if;
    if v_grading_id is not null then
      -- Superseded values count too [AS-IS, V7].
      v_gradings := v_gradings || v_grading_id;
    end if;

    -- §5.1 Display value.
    v_display := case v_insp.value_type
      when 'CUMULATIVE_VALUE' then public.format_inspection_number(round(v_dec, 2))
      when 'DECIMAL_VALUE' then public.format_inspection_number(round(v_dec, 2))
      when 'DATETIME' then coalesce(
        to_char(((v ->> 'date_value')::timestamptz) at time zone v_tz, 'DD Mon YYYY, HH24:MI'), '')
      when 'DROP_DOWN' then coalesce(v_option.name, '')
      when 'TEXT' then v ->> 'text_value'
    end;

    insert into public.inspection_value (
      id, inspection_activity_id, inspection_id, inspection_drop_down_option_id, grading_id,
      text_value, decimal_value, date_value, display_value, is_current, sort_order
    ) values (
      v_value_id, v_id, v_insp.id, (v ->> 'drop_down_option_id')::uuid, v_grading_id,
      v ->> 'text_value', v_dec, (v ->> 'date_value')::timestamptz, left(v_display, 200),
      (v ->> 'is_current')::boolean, v_order
    )
    on conflict (id) do update set
      inspection_drop_down_option_id = excluded.inspection_drop_down_option_id,
      grading_id = case
        when v_insp.value_type in ('DROP_DOWN', 'DECIMAL_VALUE') then excluded.grading_id
        else public.inspection_value.grading_id
      end,
      text_value = excluded.text_value,
      decimal_value = excluded.decimal_value,
      date_value = excluded.date_value,
      display_value = excluded.display_value,
      is_current = excluded.is_current,
      sort_order = excluded.sort_order;

    -- Photos removed from the value, then new ones.
    select coalesce(array_agg((e ->> 'id')::uuid), '{}')
    into v_keep
    from jsonb_array_elements(v -> 'images') e
    where nullif(e ->> 'id', '') is not null;

    with d as (
      delete from public.inspection_image
      where inspection_value_id = v_value_id and id <> all (v_keep)
      returning storage_path, thumbnail_path
    )
    select coalesce(array_agg(x.p) filter (where x.p is not null), '{}')
    into v_paths
    from d
    cross join lateral unnest(array[d.storage_path, d.thumbnail_path]) as x(p);
    v_removed := v_removed || v_paths;

    insert into public.inspection_image (
      inspection_value_id, storage_path, thumbnail_path, mime_type, size_bytes, created_by
    )
    select v_value_id, x.storage_path, x.thumbnail_path, x.mime_type, x.size_bytes, v_uid
    from jsonb_to_recordset(v -> 'images') as x(
      id uuid, storage_path text, thumbnail_path text, mime_type text, size_bytes bigint
    )
    where x.id is null;

    -- §5.2 Cumulative store.
    if v_insp.value_type = 'CUMULATIVE_VALUE' then
      insert into public.inspection_cumulative_value (inspection_id, asset_id, latest_value)
      values (v_insp.id, v_asset_id, v_dec)
      on conflict (inspection_id, asset_id) do update set latest_value = excluded.latest_value;
    end if;
  end loop;

  -- §4 Activity grading: the value grading with the highest priority number
  -- (the one lowest in the admin's Grading list).
  update public.inspection_activity a
  set grading_id = (
    select g.id
    from public.grading g
    where g.id = any (v_gradings)
    order by g.priority desc, g.legacy_uid
    limit 1
  )
  where a.id = v_id;

  -- §5.3 Instruction progress (status and counts follow by trigger).
  if v_instruction_id is not null then
    update public.instruction_asset_allocation
    set is_completed = true
    where instruction_id = v_instruction_id
      and asset_id = v_asset_id
      and not is_completed;
  end if;

  -- §5.4
  update public.asset set last_inspection_date = v_activity.inspection_date where id = v_asset_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'legacy_uid', v_activity.legacy_uid,
    'removed_paths', to_jsonb(v_removed)
  );
end;
$$;

revoke execute on function public.save_inspection_activity(jsonb) from public, anon;
grant execute on function public.save_inspection_activity(jsonb) to authenticated;

-- ============================================================================
-- delete_inspection_activity — IAC-R05, admins only. Cascades to values and
-- photos, then (fix, signed off) un-ticks the instruction allocation when no
-- other activity covers it and recomputes the asset's last-inspection date.
-- The cumulative store is left as it is (admins can correct it by hand).
-- Returns { removed_paths } for the caller to delete from Storage.
-- ============================================================================
create function public.delete_inspection_activity(p_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity public.inspection_activity;
  v_paths text[];
begin
  if not public.is_inspection_admin() then
    raise exception using errcode = '42501', message = 'Only admins can delete inspections.';
  end if;

  select * into v_activity from public.inspection_activity where id = p_activity_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'That inspection no longer exists.';
  end if;

  select coalesce(array_agg(x.p) filter (where x.p is not null), '{}')
  into v_paths
  from public.inspection_image i
  join public.inspection_value iv on iv.id = i.inspection_value_id
  cross join lateral unnest(array[i.storage_path, i.thumbnail_path]) as x(p)
  where iv.inspection_activity_id = p_activity_id;

  delete from public.inspection_activity where id = p_activity_id;

  if v_activity.instruction_id is not null and not exists (
    select 1 from public.inspection_activity
    where instruction_id = v_activity.instruction_id and asset_id = v_activity.asset_id
  ) then
    update public.instruction_asset_allocation
    set is_completed = false
    where instruction_id = v_activity.instruction_id and asset_id = v_activity.asset_id;
  end if;

  update public.asset
  set last_inspection_date = (
    select max(inspection_date) from public.inspection_activity where asset_id = v_activity.asset_id
  )
  where id = v_activity.asset_id;

  return jsonb_build_object('removed_paths', to_jsonb(v_paths));
end;
$$;

revoke execute on function public.delete_inspection_activity(uuid) from public, anon;
grant execute on function public.delete_inspection_activity(uuid) to authenticated;

-- ============================================================================
-- save_instruction — ACT_Instruction_Save (INS-R01..R04), admins. The
-- instruction and its asset list in one transaction. SECURITY INVOKER (RLS).
--
-- Payload: { id?, name, comment, required_completed_date, account_id, asset_ids: [] }
-- asset_ids is the full list (fixes INS-R04): missing assets are removed,
-- unless they have already been inspected.
-- ============================================================================
create function public.save_instruction(p_instruction jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := nullif(p_instruction ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p_instruction ->> 'name', ''));
  v_account uuid := nullif(p_instruction ->> 'account_id', '')::uuid;
  v_date date := nullif(p_instruction ->> 'required_completed_date', '')::date;
  v_assets uuid[];
  v_inspected text;
begin
  select coalesce(array_agg(distinct e::uuid), '{}')
  into v_assets
  from jsonb_array_elements_text(coalesce(p_instruction -> 'asset_ids', '[]'::jsonb)) e;

  -- INS-R02
  if v_name = '' then
    raise exception using errcode = 'P0001', message = 'Name is required.';
  end if;
  if v_account is null then
    raise exception using errcode = 'P0001', message = 'Assigned to is required.';
  end if;
  if v_date is null then
    raise exception using errcode = 'P0001', message = 'Required completed date is required.';
  end if;
  -- [AS-IS] an overdue instruction can't be re-saved without moving its date.
  if v_date < public.app_today() then
    raise exception using errcode = 'P0001', message = 'Must be today or in the future.';
  end if;

  if v_id is null then
    -- INS-R01: status New, not scheduled.
    insert into public.instruction (name, comment, required_completed_date, account_id)
    values (v_name, coalesce(p_instruction ->> 'comment', ''), v_date, v_account)
    returning id into v_id;
  else
    update public.instruction set
      name = v_name,
      comment = coalesce(p_instruction ->> 'comment', ''),
      required_completed_date = v_date,
      account_id = v_account
    where id = v_id;
    if not found then
      raise exception using errcode = '42501',
        message = 'Instruction not found, or you don''t have permission to edit it.';
    end if;
  end if;

  select string_agg(a.name, ', ' order by a.name)
  into v_inspected
  from public.instruction_asset_allocation ia
  join public.asset a on a.id = ia.asset_id
  where ia.instruction_id = v_id
    and ia.is_completed
    and ia.asset_id <> all (v_assets);
  if v_inspected is not null then
    raise exception using errcode = 'P0001', message = format('%s has already been Inspected.', v_inspected);
  end if;

  delete from public.instruction_asset_allocation
  where instruction_id = v_id and asset_id <> all (v_assets);

  insert into public.instruction_asset_allocation (instruction_id, asset_id)
  select v_id, a from unnest(v_assets) a
  on conflict (instruction_id, asset_id) do nothing;

  return v_id;
end;
$$;

revoke execute on function public.save_instruction(jsonb) from public, anon;
grant execute on function public.save_instruction(jsonb) to authenticated;

-- ============================================================================
-- delete_instruction_allocation — ACT_InstructionAssetAllocation_Delete
-- (INS-R06), from Instruction_ViewProgress. An inspected allocation is kept;
-- deleting the last allocation deletes the instruction. SECURITY INVOKER.
-- Returns { instruction_deleted }.
-- ============================================================================
create function public.delete_instruction_allocation(p_allocation_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_instruction_id uuid;
  v_completed boolean;
  v_asset_name text;
begin
  select ia.instruction_id, ia.is_completed, a.name
  into v_instruction_id, v_completed, v_asset_name
  from public.instruction_asset_allocation ia
  join public.asset a on a.id = ia.asset_id
  where ia.id = p_allocation_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'That asset is no longer on the instruction.';
  end if;
  if v_completed then
    raise exception using errcode = 'P0001', message = format('%s has already been Inspected.', v_asset_name);
  end if;

  delete from public.instruction_asset_allocation where id = p_allocation_id;
  if not found then
    raise exception using errcode = '42501', message = 'You don''t have permission to do that.';
  end if;

  if not exists (select 1 from public.instruction_asset_allocation where instruction_id = v_instruction_id) then
    delete from public.instruction where id = v_instruction_id;
    return jsonb_build_object('instruction_deleted', true);
  end if;
  return jsonb_build_object('instruction_deleted', false);
end;
$$;

revoke execute on function public.delete_instruction_allocation(uuid) from public, anon;
grant execute on function public.delete_instruction_allocation(uuid) to authenticated;

-- ============================================================================
-- save_scheduled_instruction — ACT_ScheduledInstruction_Save with
-- ScheduledInstruction_Validate (SCH-R01..R08), admins. SECURITY INVOKER.
--
-- Payload: { id?, name, comment, schedule_type, include_weekends,
--   include_public_holidays, day_of_month, week_days: [1..7],
--   days_to_complete, active, account_id, asset_ids: [] }
-- Settings that don't apply to the schedule type are cleared.
-- ============================================================================
create function public.save_scheduled_instruction(p_schedule jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := nullif(p_schedule ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p_schedule ->> 'name', ''));
  v_account uuid := nullif(p_schedule ->> 'account_id', '')::uuid;
  v_type public.instruction_schedule_type := nullif(p_schedule ->> 'schedule_type', '')::public.instruction_schedule_type;
  v_day integer := nullif(p_schedule ->> 'day_of_month', '')::integer;
  v_days_to_complete integer := coalesce(nullif(p_schedule ->> 'days_to_complete', '')::integer, 1);
  v_week_days smallint[];
  v_assets uuid[];
begin
  select coalesce(array_agg(distinct e::uuid), '{}')
  into v_assets
  from jsonb_array_elements_text(coalesce(p_schedule -> 'asset_ids', '[]'::jsonb)) e;
  select coalesce(array_agg(distinct e::smallint order by e::smallint), '{}')
  into v_week_days
  from jsonb_array_elements_text(coalesce(p_schedule -> 'week_days', '[]'::jsonb)) e;

  -- SCH-R01..R04
  if v_name = '' then
    raise exception using errcode = 'P0001', message = 'Name is required.';
  end if;
  if v_account is null then
    raise exception using errcode = 'P0001', message = 'Assigned to is required.';
  end if;
  if cardinality(v_assets) = 0 then
    raise exception using errcode = 'P0001', message = 'Please assign Assets.';
  end if;
  if v_type is null then
    raise exception using errcode = 'P0001', message = 'Schedule type is required.';
  end if;
  -- SCH-R05 (30 is accepted, 31 is not; the Mendix text said "< 30").
  if v_type = 'monthly' and v_day is null then
    raise exception using errcode = 'P0001', message = 'Day of month is required.';
  end if;
  if v_type = 'monthly' and v_day not between 1 and 30 then
    raise exception using errcode = 'P0001', message = 'Day of month must be between 1 and 30.';
  end if;
  -- SCH-R06
  if v_type = 'weekly' and cardinality(v_week_days) = 0 then
    raise exception using errcode = 'P0001', message = 'Choose at least one day.';
  end if;
  if v_days_to_complete < 0 then
    raise exception using errcode = 'P0001', message = 'Days to complete must be 0 or more.';
  end if;

  if v_type <> 'monthly' then v_day := null; end if;
  if v_type <> 'weekly' then v_week_days := '{}'; end if;

  if v_id is null then
    insert into public.scheduled_instruction (
      name, comment, schedule_type, include_weekends, include_public_holidays,
      day_of_month, week_days, days_to_complete, active, account_id
    ) values (
      v_name,
      coalesce(p_schedule ->> 'comment', ''),
      v_type,
      v_type = 'daily' and coalesce((p_schedule ->> 'include_weekends')::boolean, false),
      v_type = 'daily' and coalesce((p_schedule ->> 'include_public_holidays')::boolean, false),
      v_day,
      v_week_days,
      v_days_to_complete,
      coalesce((p_schedule ->> 'active')::boolean, true),
      v_account
    )
    returning id into v_id;
  else
    update public.scheduled_instruction set
      name = v_name,
      comment = coalesce(p_schedule ->> 'comment', ''),
      schedule_type = v_type,
      include_weekends = v_type = 'daily' and coalesce((p_schedule ->> 'include_weekends')::boolean, false),
      include_public_holidays = v_type = 'daily' and coalesce((p_schedule ->> 'include_public_holidays')::boolean, false),
      day_of_month = v_day,
      week_days = v_week_days,
      days_to_complete = v_days_to_complete,
      active = coalesce((p_schedule ->> 'active')::boolean, true),
      account_id = v_account
    where id = v_id;
    if not found then
      raise exception using errcode = '42501',
        message = 'Scheduled instruction not found, or you don''t have permission to edit it.';
    end if;
  end if;

  -- SCH-R08: the picker's selection replaces the asset set.
  delete from public.scheduled_instruction_asset
  where scheduled_instruction_id = v_id and asset_id <> all (v_assets);
  insert into public.scheduled_instruction_asset (scheduled_instruction_id, asset_id)
  select v_id, a from unnest(v_assets) a
  on conflict do nothing;

  return v_id;
end;
$$;

revoke execute on function public.save_scheduled_instruction(jsonb) from public, anon;
grant execute on function public.save_scheduled_instruction(jsonb) to authenticated;

-- ============================================================================
-- Storage: private bucket `inspection-images`, same model as
-- incident-images. Clients upload into their own folder
-- (`<auth.uid()>/<uuid>.jpg`) before saving; save_inspection_activity links
-- the path. A file is readable by its uploader, and by every role once an
-- inspection_image row points at it.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inspection-images',
  'inspection-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy inspection_images_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'inspection-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_inspection_writer()
  );

create policy inspection_images_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'inspection-images'
    and (
      owner_id = auth.uid()::text
      or exists (
        select 1 from public.inspection_image ii
        where ii.storage_path = objects.name
           or ii.thumbnail_path = objects.name
      )
    )
  );

-- The uploader can remove their own files (cancelled forms, removed photos);
-- admins can remove any (deleting an activity).
create policy inspection_images_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'inspection-images'
    and (owner_id = auth.uid()::text or public.is_inspection_admin())
  );
