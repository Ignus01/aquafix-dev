-- Offline capture RPCs (Aquafix Capture spec, "Validation, upload and
-- conflicts", "Outbox commands" and "Migration drafts" §3).
--
-- The native field app saves offline and uploads each Save later as a queued
-- command. The PWA keeps calling the same RPCs without the new fields and
-- behaves exactly as before. What changes, and why:
--
--   * Every writing RPC takes an optional command id (client_command,
--     20261104130000): a resent command returns its first result and does
--     nothing twice. Raised rejections roll back and are not stored.
--   * Every writing RPC takes an optional captured_at, the phone's time of
--     the Save. It becomes the inspection / incident / note / stock document
--     date instead of now(). It is refused when more than 5 minutes in the
--     future (the phone's clock is wrong) or older than 7 days. The check is
--     made after the command lookup, so a resend of a stored command still
--     gets its result however old it is.
--   * save_inspection_activity takes a phone activity_id, judges the
--     today-only edit rule on captured_at, compares a cumulative reading only
--     with readings captured earlier, and only moves the cumulative store
--     (offline saves; PWA saves keep golden test T11 [AS-IS]) and
--     asset.last_inspection_date (every save) forward.
--   * save_incident takes a phone client_id; add_incident_note a phone note
--     id; advance_incident_status treats "already at or past the target" as
--     success.
--   * save_stock_document (new) saves a stock document's header and all its
--     lines in one transaction; the PWA saves them one call at a time, which
--     offline could leave a header without lines.
--
-- Client-chosen ids and dates, kept as narrow as possible:
--   * `id` gets a column INSERT grant on incident, incident_note and the
--     seven stock tables the phone creates. A client-chosen UUID is harmless
--     (a clash is a primary-key error), and RLS still decides who may insert.
--   * Stock document dates were already insertable by clients; nothing new.
--   * incident.incident_date and incident_note.created_at stay without client
--     grants (the audit trigger forces created_at to now(), and the PWA never
--     sets incident_date). Instead save_incident / add_incident_note set the
--     transaction-local setting `aquafix.captured_at` around their insert and
--     the audit trigger takes the date from it. Only these RPCs set it, after
--     checking the 7-day / 5-minute bounds, and they clear it straight after
--     the insert. PostgREST callers can't set arbitrary settings, the same
--     guarantee aquafix.skip_incident_notifications relies on.

-- ============================================================================
-- captured_at bounds, shared by every RPC below. Null (the PWA) passes.
-- ============================================================================
create function public.assert_captured_at(p_captured_at timestamptz)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_captured_at is null then
    return;
  end if;
  if p_captured_at > now() + interval '5 minutes' then
    raise exception using errcode = 'P0001',
      message = 'The capture time is in the future. Check the phone''s clock.';
  end if;
  if p_captured_at < now() - interval '7 days' then
    raise exception using errcode = 'P0001',
      message = 'This was captured more than 7 days ago and can''t be saved.';
  end if;
end;
$$;

revoke execute on function public.assert_captured_at(timestamptz) from public, anon;
grant execute on function public.assert_captured_at(timestamptz) to authenticated;

-- ============================================================================
-- Phone-chosen ids (see the header).
-- ============================================================================
grant insert (id) on public.incident to authenticated;
grant insert (id) on public.incident_note to authenticated;
grant insert (id) on public.transfer_main, public.transfer_item, public.work_order, public.work_order_item,
  public.stock_take, public.stock_take_item, public.load to authenticated;

-- ============================================================================
-- Incident audit trigger: unchanged, except that an insert made while
-- `aquafix.captured_at` is set (only by save_incident / add_incident_note,
-- for an offline capture) takes that time as the incident's incident_date or
-- the note's created_at. Images keep created_at = now(). Everything else as
-- in 20260923140000_incidents_schema.sql.
-- ============================================================================
create or replace function public.set_incident_audit_fields()
returns trigger
language plpgsql
as $$
declare
  v_captured_at timestamptz := nullif(current_setting('aquafix.captured_at', true), '')::timestamptz;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    -- Offline capture (new).
    if v_captured_at is not null then
      if tg_table_name = 'incident' then
        new.incident_date := v_captured_at;
      elsif tg_table_name = 'incident_note' then
        new.created_at := v_captured_at;
      end if;
    end if;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if tg_table_name = 'incident' then
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
  end if;
  return new;
end;
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
--   Offline capture (new, all optional; the PWA sends none of them):
--   { command_id,    the phone's command id (client_command): a resend returns
--                    the first result, ok:false included, and does nothing
--     activity_id,   the phone's activity id: edits that activity if it
--                    exists, else creates the new activity with this id
--                    (`id` keeps meaning "edit", and wins if both are sent)
--     captured_at }  the phone's time of the Save: becomes inspection_date
--                    (new and edited activities) and the auto-incident's
--                    date; the today-only rule (IAC-R06) compares its day
--                    with the activity's; A5 compares with readings captured
--                    before it. Refused if > 5 min ahead or > 7 days old.
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
create or replace function public.save_inspection_activity(p_activity jsonb)
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
  -- Offline capture (new).
  v_command_id uuid := nullif(p_activity ->> 'command_id', '')::uuid;
  v_client_id uuid := nullif(p_activity ->> 'activity_id', '')::uuid;
  v_captured_at timestamptz := nullif(p_activity ->> 'captured_at', '')::timestamptz;
  v_new_id uuid;            -- the phone's id for a new activity
  v_stored jsonb;
begin
  -- Offline capture: a command already saved returns its first result.
  v_stored := public.client_command_result(v_command_id, 'save_inspection_activity');
  if v_stored is not null then
    return v_stored;
  end if;

  if not public.is_inspection_writer() then
    raise exception using errcode = '42501', message = 'You don''t have permission to save inspections.';
  end if;
  if jsonb_typeof(v_payload) <> 'array' then
    raise exception using errcode = 'P0001', message = 'The inspection has no values.';
  end if;
  perform public.assert_captured_at(v_captured_at);

  -- Offline capture: the phone's activity id edits that activity if it
  -- exists, else names the new one.
  if v_id is null and v_client_id is not null then
    if exists (select 1 from public.inspection_activity where id = v_client_id) then
      v_id := v_client_id;
    else
      v_new_id := v_client_id;
    end if;
  end if;

  -- --------------------------------------------------------------------------
  -- The activity, the asset and the instruction allocation
  -- --------------------------------------------------------------------------
  if v_id is not null then
    select * into v_activity from public.inspection_activity where id = v_id for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'That inspection no longer exists.';
    end if;
    -- IAC-R06: the inspector's own activities from today. Offline capture:
    -- "today" is the day the edit was captured, not the day it uploads.
    if v_activity.created_by is distinct from v_uid
      or (v_activity.inspection_date at time zone v_tz)::date
         <> coalesce((v_captured_at at time zone v_tz)::date, public.app_today()) then
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
        v_latest := null;
        if v_captured_at is not null then
          -- Offline capture: compare only with readings captured before this
          -- one (another inspector's later, higher reading may already be in
          -- the store: "overtaken meter reading: accept it"). This activity's
          -- own earlier reading doesn't count.
          select max(pv.decimal_value) into v_latest
          from public.inspection_value pv
          join public.inspection_activity pa on pa.id = pv.inspection_activity_id
          where pv.inspection_id = v_insp.id
            and pa.asset_id = v_asset_id
            and pv.is_current
            and pa.inspection_date < v_captured_at
            and pa.id is distinct from coalesce(v_id, v_new_id);
        end if;
        if v_latest is null then
          select latest_value into v_latest
          from public.inspection_cumulative_value
          where inspection_id = v_insp.id and asset_id = v_asset_id;
        end if;
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
                  coalesce(v_captured_at, now())                         -- offline capture
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
    -- Offline capture: stored too, so a resend doesn't auto-create the
    -- incident (C5) a second time.
    return public.client_command_store(v_command_id, 'save_inspection_activity',
      jsonb_build_object('ok', false, 'messages', v_messages, 'retries', v_retries));
  end if;

  -- --------------------------------------------------------------------------
  -- §2 Save: the activity, then each value with its display value, grading,
  -- photos and cumulative reading.
  -- --------------------------------------------------------------------------
  if v_id is null then
    -- Offline capture: the phone's id and capture time when given.
    insert into public.inspection_activity (id, asset_id, instruction_id, inspection_date, created_by, updated_by)
    values (coalesce(v_new_id, gen_random_uuid()), v_asset_id, v_instruction_id,
            coalesce(v_captured_at, now()), v_uid, v_uid)
    returning * into v_activity;
    v_id := v_activity.id;
  else
    -- Offline capture: an edit captured at a given time takes that time.
    update public.inspection_activity
    set updated_by = v_uid,
        inspection_date = coalesce(v_captured_at, inspection_date)
    where id = v_id
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

    -- §5.2 Cumulative store. Offline capture: the store only moves forward,
    -- so an older reading that uploads late never replaces a newer, higher
    -- one. Without captured_at (the PWA) it is unchanged: the reading
    -- replaces the store, so a not-required meter can still go down
    -- (golden test T11 [AS-IS]).
    if v_insp.value_type = 'CUMULATIVE_VALUE' then
      insert into public.inspection_cumulative_value (inspection_id, asset_id, latest_value)
      values (v_insp.id, v_asset_id, v_dec)
      on conflict (inspection_id, asset_id) do update
        set latest_value = case
          when v_captured_at is null then excluded.latest_value
          else greatest(public.inspection_cumulative_value.latest_value, excluded.latest_value)
        end;
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

  -- §5.4. Only moves forward, so a late upload of an older capture (or an
  -- edit of an earlier activity) never moves it back. greatest() ignores a
  -- null (never inspected).
  update public.asset
  set last_inspection_date = greatest(last_inspection_date, v_activity.inspection_date)
  where id = v_asset_id;

  return public.client_command_store(v_command_id, 'save_inspection_activity', jsonb_build_object(
    'ok', true,
    'id', v_id,
    'legacy_uid', v_activity.legacy_uid,
    'removed_paths', to_jsonb(v_removed)
  ));
end;
$$;

revoke execute on function public.save_inspection_activity(jsonb) from public, anon;
grant execute on function public.save_inspection_activity(jsonb) to authenticated;

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
--
-- Offline capture (new, all optional): command_id (a resend returns the first
-- result), client_id (the phone's incident id: creates the incident with this
-- id, or edits it like `id` when it already exists; `id` wins if both are
-- sent) and captured_at (incident_date of a new incident; refused if > 5 min
-- ahead or > 7 days old). incident_date is set through `aquafix.captured_at`
-- and the audit trigger, not a column grant (see the header).
-- ============================================================================
create or replace function public.save_incident(p_incident jsonb)
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
  -- Offline capture (new).
  v_command_id uuid := nullif(p_incident ->> 'command_id', '')::uuid;
  v_client_id uuid := nullif(p_incident ->> 'client_id', '')::uuid;
  v_captured_at timestamptz := nullif(p_incident ->> 'captured_at', '')::timestamptz;
  v_new_id uuid;            -- the phone's id for a new incident
  v_stored jsonb;
begin
  -- Offline capture: a command already saved returns its first result.
  v_stored := public.client_command_result(v_command_id, 'save_incident');
  if v_stored is not null then
    return v_stored;
  end if;
  perform public.assert_captured_at(v_captured_at);
  if v_id is null and v_client_id is not null then
    if exists (select 1 from public.incident where id = v_client_id) then
      v_id := v_client_id;
    else
      v_new_id := v_client_id;
    end if;
  end if;

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
    -- Offline capture: the phone's id, and incident_date = captured_at via
    -- the audit trigger (cleared again straight after the insert).
    if v_captured_at is not null then
      perform set_config('aquafix.captured_at', v_captured_at::text, true);
    end if;
    insert into public.incident (id, location_id, incident_type_id, comment)
    values (coalesce(v_new_id, gen_random_uuid()), v_location_id, v_type_id, v_comment)
    returning id, reference into v_id, v_reference;
    if v_captured_at is not null then
      perform set_config('aquafix.captured_at', '', true);
    end if;
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

  return public.client_command_store(v_command_id, 'save_incident', jsonb_build_object(
    'id', v_id,
    'reference', v_reference,
    'removed_paths', to_jsonb(v_removed)
  ));
end;
$$;

revoke execute on function public.save_incident(jsonb) from public, anon;
grant execute on function public.save_incident(jsonb) to authenticated;

-- ============================================================================
-- add_incident_note — Incident_AddNote's Save (ACT_IncidentNote_Save): the
-- note and its photos in one transaction. Fixes ICI-R05 (note photos were
-- never explicitly committed in Mendix). SECURITY INVOKER.
--
-- Offline capture (new, all optional, appended so the PWA's named-argument
-- call is unchanged): p_note_id (the phone's note id), p_command_id (a resend
-- returns the first note id; stored as a jsonb string) and p_captured_at (the
-- note's created_at, via `aquafix.captured_at` and the audit trigger; refused
-- if > 5 min ahead or > 7 days old). The old 3-argument function is dropped
-- so there is a single overload and PostgREST's named-argument resolution
-- stays unambiguous.
-- ============================================================================
drop function public.add_incident_note(uuid, text, jsonb);

create function public.add_incident_note(
  p_incident_id uuid,
  p_body text,
  p_images jsonb default '[]'::jsonb,
  p_note_id uuid default null,
  p_command_id uuid default null,
  p_captured_at timestamptz default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_status public.incident_status;
  v_note_id uuid;
  r record;
  v_stored jsonb;           -- offline capture (new)
begin
  -- Offline capture: a command already saved returns its first result.
  v_stored := public.client_command_result(p_command_id, 'add_incident_note');
  if v_stored is not null then
    return (v_stored #>> '{}')::uuid;
  end if;
  perform public.assert_captured_at(p_captured_at);

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

  -- Offline capture: the phone's id, and created_at = captured_at via the
  -- audit trigger (cleared again straight after the insert).
  if p_captured_at is not null then
    perform set_config('aquafix.captured_at', p_captured_at::text, true);
  end if;
  insert into public.incident_note (id, incident_id, body)
  values (coalesce(p_note_id, gen_random_uuid()), p_incident_id, btrim(p_body))
  returning id into v_note_id;
  if p_captured_at is not null then
    perform set_config('aquafix.captured_at', '', true);
  end if;

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

  perform public.client_command_store(p_command_id, 'add_incident_note', to_jsonb(v_note_id));
  return v_note_id;
end;
$$;

revoke execute on function public.add_incident_note(uuid, text, jsonb, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.add_incident_note(uuid, text, jsonb, uuid, uuid, timestamptz) to authenticated;

-- ============================================================================
-- advance_incident_status — ICD-R06, the one-tap status badge:
-- New → In Progress → Completed (sets completed_at). Completed: no change.
-- p_expected_status guards against a double tap advancing twice: if the
-- incident has already moved on, nothing changes.
-- SECURITY DEFINER because clients have no UPDATE right on `status`.
--
-- Offline capture (new): a Start or Complete can upload long after the user
-- tapped it, so when the incident is no longer at p_expected_status:
--   * already at or past the target (the status after p_expected_status;
--     enum order new < in_progress < completed) → the tap is done anyway:
--     return the current status, change nothing (as before);
--   * below the target (an admin moved it back) → raise "That incident has
--     changed; reload and try again." instead of silently returning, so the
--     phone puts it in Needs attention. The PWA shows the same message.
-- Optional p_command_id: a resend returns the first result. The old
-- 2-argument function is dropped so there is a single overload.
-- ============================================================================
drop function public.advance_incident_status(uuid, public.incident_status);

create function public.advance_incident_status(
  p_incident_id uuid,
  p_expected_status public.incident_status,
  p_command_id uuid default null
)
returns public.incident_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.incident_status;
  -- Offline capture (new).
  v_target public.incident_status := case p_expected_status
    when 'new' then 'in_progress'
    else 'completed'
  end;
  v_stored jsonb;
begin
  -- Offline capture: a command already saved returns its first result.
  v_stored := public.client_command_result(p_command_id, 'advance_incident_status');
  if v_stored is not null then
    return (v_stored #>> '{}')::public.incident_status;
  end if;

  if not public.is_incident_writer() then
    raise exception using errcode = '42501', message = 'You don''t have permission to change the status.';
  end if;

  select status into v_status from public.incident where id = p_incident_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'That incident no longer exists.';
  end if;
  if v_status is distinct from p_expected_status then
    -- Offline capture: below the target means someone moved it back.
    if v_status < v_target then
      raise exception using errcode = 'P0001', message = 'That incident has changed; reload and try again.';
    end if;
    perform public.client_command_store(p_command_id, 'advance_incident_status', to_jsonb(v_status));
    return v_status;
  end if;

  if v_status = 'new' then
    update public.incident set status = 'in_progress' where id = p_incident_id;
    v_status := 'in_progress';
  elsif v_status = 'in_progress' then
    update public.incident set status = 'completed', completed_at = now() where id = p_incident_id;
    v_status := 'completed';
  end if;
  perform public.client_command_store(p_command_id, 'advance_incident_status', to_jsonb(v_status));
  return v_status;
end;
$$;

revoke execute on function public.advance_incident_status(uuid, public.incident_status, uuid) from public, anon;
grant execute on function public.advance_incident_status(uuid, public.incident_status, uuid) to authenticated;

-- ============================================================================
-- stock_doc_number — a number typed on a stock form, as the PWA's coerce()
-- reads it: required, and a finite number. Raises P0001 "<label> is
-- required." / "<label> must be a number." Used by save_stock_document.
-- ============================================================================
create function public.stock_doc_number(p_value text, p_label text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_number numeric;
begin
  if btrim(coalesce(p_value, '')) = '' then
    raise exception using errcode = 'P0001', message = p_label || ' is required.';
  end if;
  begin
    v_number := btrim(p_value)::numeric;
  exception when invalid_text_representation then
    v_number := 'NaN';
  end;
  if v_number = 'NaN'::numeric then
    raise exception using errcode = 'P0001', message = p_label || ' must be a number.';
  end if;
  return v_number;
end;
$$;

revoke execute on function public.stock_doc_number(text, text) from public, anon;
grant execute on function public.stock_doc_number(text, text) to authenticated;

-- ============================================================================
-- save_stock_document — a new stock document from the field app: the header
-- and all its lines in one transaction (the PWA's doc-form saves the header,
-- then each line, through saveHeader / saveLine; offline that could leave a
-- header without lines). Writes the same columns those actions write.
--
-- SECURITY INVOKER, so the stock RLS and column grants apply as they do to
-- the PWA: transfers, work orders and stock takes for system_admin, admin
-- and user; loads for system_admin only. A refusal is raised as 42501
-- "You don't have permission to save this document."
--
-- Payload:
--   { command_id?,   the phone's command id: a resend returns the first result
--     captured_at?,  the phone's time of the Save (> 5 min ahead or > 7 days
--                    old is refused); the document date when the header has
--                    none
--     kind,          'transfers' | 'work-orders' | 'stock-takes' | 'loads'
--     header: { id?, (the phone's id)
--       transfers:   transfer_type (SEND | RECEIVE | BOTH), transfer_date?,
--                    from_storage_area_id (not RECEIVE), to_storage_area_id
--                    (not SEND), comment?
--       work-orders: storage_area_id, order_date?, comment?
--       stock-takes: storage_area_id, take_date?, comment?
--       loads:       load_date?, driver?, vehicle_reg_nr?, comment? },
--     lines: [ { id?, (the phone's id)
--       transfers:   item_id, qty
--       work-orders: item_id, qty, is_return?, transaction_date?
--       stock-takes: item_id, counted_qty } ] }   loads have no lines
--
-- The document date is the header's date if given, else captured_at, else
-- the table default (now(); a load's date is captured_at's day in the app
-- time zone, else current_date). A work-order line's transaction_date the
-- same way. As on the PWA, a transfer's hidden area is cleared (no from-area
-- on a RECEIVE, no to-area on a SEND) and a blank comment is stored as null.
--
-- The negative-stock guard (a deferred constraint trigger) is checked before
-- returning, so "Not enough stock: …" is raised by this call, not at commit.
--
-- Returns { id, reference }.
-- ============================================================================
create function public.save_stock_document(p_doc jsonb)
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
        insert into public.work_order (id, order_date, storage_area_id, comment)
        values (
          v_id,
          coalesce(nullif(v_header ->> 'order_date', '')::timestamptz, v_captured_at, now()),
          (v_header ->> 'storage_area_id')::uuid,
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

    -- Raise "Not enough stock" now rather than at commit, then put the guard
    -- back to its declared (deferred) mode for the rest of the transaction.
    set constraints public.item_transaction_guard immediate;
    set constraints public.item_transaction_guard deferred;

  -- Database errors become messages the phone can show in Needs attention
  -- (anything else would be retried for ever). The PWA's friendlyError()
  -- wording where it has one.
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

revoke execute on function public.save_stock_document(jsonb) from public, anon;
grant execute on function public.save_stock_document(jsonb) to authenticated;
