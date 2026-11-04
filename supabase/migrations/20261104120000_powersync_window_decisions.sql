-- PowerSync sync window: the field-app spec's decisions (Aquafix Capture
-- spec, decisions of 30 Oct 2026, confirmed 4 Nov 2026), replacing the
-- 14-day windows of 20261102120000_powersync_sync_window.sql:
--
--   * An instruction syncs to its assignee while it is open, whatever its
--     due date (the PWA lists every open instruction of mine). Completing it
--     takes it, and its allocations, off the phone.
--   * An activity syncs to its inspector on the day it was inspected (the PWA
--     lists and edits only today's own, IAC-R06). The hourly job takes
--     yesterday's off soon after midnight in the app time zone.
--
-- The triggers, sync_user_id copies and hourly job of the earlier migration
-- stay as they are; only the window tests and the refresh change.

-- ============================================================================
-- Instructions: open, not "due in the last 14 days"
-- ============================================================================
create function public.powersync_instruction_in_window(p_status public.instruction_status)
returns boolean
language sql
immutable
as $$
  select p_status <> 'completed';
$$;

-- Status is set by trigger when allocations complete (an UPDATE of the
-- instruction), so this runs then too.
create or replace function public.instruction_sync_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.in_sync_window := public.powersync_instruction_in_window(new.status);
  if tg_op = 'UPDATE' and public.powersync_only_sync_columns_changed(to_jsonb(old), to_jsonb(new)) then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- Activities: today only
-- ============================================================================
create or replace function public.powersync_activity_in_window(p_inspection_date timestamptz)
returns boolean
language sql
stable
as $$
  select (p_inspection_date at time zone public.app_time_zone())::date >= public.app_today();
$$;

-- ============================================================================
-- The hourly refresh (cron powersync-sync-window, unchanged)
-- ============================================================================
create or replace function public.refresh_powersync_sync_window()
returns void
language sql
security definer
set search_path = public
as $$
  update public.instruction
  set in_sync_window = public.powersync_instruction_in_window(status)
  where in_sync_window is distinct from public.powersync_instruction_in_window(status);

  update public.inspection_activity
  set in_sync_window = public.powersync_activity_in_window(inspection_date)
  where in_sync_window is distinct from public.powersync_activity_in_window(inspection_date);
$$;

-- The date-based helpers are no longer used.
drop function public.powersync_instruction_in_window(date);
drop function public.powersync_window_start();

revoke execute on function public.powersync_instruction_in_window(public.instruction_status) from public, anon, authenticated;

-- Move every flag to the new windows now.
select public.refresh_powersync_sync_window();
