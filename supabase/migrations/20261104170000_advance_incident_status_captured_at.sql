-- advance_incident_status takes captured_at (Aquafix Capture spec, "Outbox
-- commands").
--
-- An offline Start or Complete can upload hours after the user tapped it. The
-- time that matters is the tap, not the upload, so:
--   * advance_incident_status gets an optional p_captured_at, the phone's time
--     of the tap, checked with assert_captured_at (5 minutes ahead / 7 days
--     old) after the command lookup, so a resend of a stored command still
--     gets its result however old it is.
--   * Complete sets completed_at = coalesce(p_captured_at, now()).
--   * The incident_status_change history row takes changed_at from the same
--     transaction-local setting `aquafix.captured_at` that save_incident and
--     add_incident_note already use (20261104140000): advance_incident_status
--     sets it around its update and clears it straight after. The history
--     trigger reads it on insert too, so an offline-created incident's "new"
--     row is dated at capture like its incident_date; otherwise an offline
--     Start (dated at the tap) could sort before the creation (dated at the
--     upload). Unset (the PWA, set_incident_status), changed_at stays now().
--     PostgREST callers can't set arbitrary settings.
-- The PWA calls without the new parameter and behaves exactly as before. The
-- 3-argument function is dropped so there is a single overload.

-- ============================================================================
-- Status history trigger: unchanged, except changed_at comes from
-- `aquafix.captured_at` when it is set. As in 20260923140000_incidents_schema.sql.
-- ============================================================================
create or replace function public.log_incident_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.incident_status_change (incident_id, from_status, to_status, changed_by, changed_at)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      coalesce(auth.uid(), new.updated_by),
      -- Offline capture (new).
      coalesce(nullif(current_setting('aquafix.captured_at', true), '')::timestamptz, now())
    );
  end if;
  return null;
end;
$$;

-- ============================================================================
-- advance_incident_status — as in 20261104140000_offline_capture_rpcs.sql,
-- plus p_captured_at (see the header).
-- ============================================================================
drop function public.advance_incident_status(uuid, public.incident_status, uuid);

create function public.advance_incident_status(
  p_incident_id uuid,
  p_expected_status public.incident_status,
  p_command_id uuid default null,
  p_captured_at timestamptz default null
)
returns public.incident_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.incident_status;
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

  -- Offline capture: the tap's time must be plausible.
  perform public.assert_captured_at(p_captured_at);

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

  -- Offline capture: the history row is dated at the tap (cleared straight after).
  if p_captured_at is not null then
    perform set_config('aquafix.captured_at', p_captured_at::text, true);
  end if;
  if v_status = 'new' then
    update public.incident set status = 'in_progress' where id = p_incident_id;
    v_status := 'in_progress';
  elsif v_status = 'in_progress' then
    update public.incident set status = 'completed', completed_at = coalesce(p_captured_at, now())
    where id = p_incident_id;
    v_status := 'completed';
  end if;
  if p_captured_at is not null then
    perform set_config('aquafix.captured_at', '', true);
  end if;

  perform public.client_command_store(p_command_id, 'advance_incident_status', to_jsonb(v_status));
  return v_status;
end;
$$;

revoke execute on function public.advance_incident_status(uuid, public.incident_status, uuid, timestamptz) from public, anon;
grant execute on function public.advance_incident_status(uuid, public.incident_status, uuid, timestamptz) to authenticated;
