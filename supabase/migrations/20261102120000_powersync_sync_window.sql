-- PowerSync sync window (powersync/sync-config.yaml).
--
-- powersync_role bypasses RLS, so the sync config alone decides what each
-- phone receives. Two things it can't do by itself:
--
--   * Time filters. Stream queries must be deterministic (no now()), so
--     "recent" is a stored flag, in_sync_window, on instruction and
--     inspection_activity. Triggers set it on every write and an hourly job
--     moves it as days pass.
--   * Stay within PowerSync's 1,000 buckets per user. A stream makes one
--     bucket per value of the column it filters on, so filtering child rows
--     through their parent (allocation → instruction, value → activity,
--     image → value) would make a bucket per parent. The child rows carry
--     sync_user_id instead: the user the row syncs to, null outside the
--     window. Every per-user stream then filters on the one user id.
--
-- The window: an instruction until 14 days after its required completed date,
-- open or not (open instructions overdue by more than that are left out:
-- the migrated data has hundreds per inspector); an activity for 14 days
-- after its inspection date. Days are in the app time zone, like
-- app_today(). To change it, edit powersync_window_start() and run
-- refresh_powersync_sync_window().
--
-- A write that only changes these columns leaves updated_at as it was (the
-- web app shows instruction.updated_at).

create function public.powersync_window_start()
returns date
language sql
stable
as $$
  select public.app_today() - 14;
$$;

create function public.powersync_instruction_in_window(p_required_completed_date date)
returns boolean
language sql
stable
as $$
  select p_required_completed_date >= public.powersync_window_start();
$$;

create function public.powersync_activity_in_window(p_inspection_date timestamptz)
returns boolean
language sql
stable
as $$
  select (p_inspection_date at time zone public.app_time_zone())::date >= public.powersync_window_start();
$$;

-- True when an UPDATE changed nothing but the sync columns (and updated_at).
create function public.powersync_only_sync_columns_changed(p_old jsonb, p_new jsonb)
returns boolean
language sql
immutable
as $$
  select p_old - array['updated_at', 'in_sync_window', 'sync_user_id']
       = p_new - array['updated_at', 'in_sync_window', 'sync_user_id'];
$$;

-- ============================================================================
-- instruction.in_sync_window → instruction_asset_allocation.sync_user_id
-- ============================================================================
alter table public.instruction
  add column in_sync_window boolean not null default false;

alter table public.instruction_asset_allocation
  add column sync_user_id uuid;

-- BEFORE triggers fire in name order: *_sync_* runs after *_set_updated_at,
-- so it can put updated_at back.
create function public.instruction_sync_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.in_sync_window := public.powersync_instruction_in_window(new.required_completed_date);
  if tg_op = 'UPDATE' and public.powersync_only_sync_columns_changed(to_jsonb(old), to_jsonb(new)) then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create trigger instruction_sync_window
  before insert or update on public.instruction
  for each row execute function public.instruction_sync_window();

create function public.instruction_sync_window_propagate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.instruction_asset_allocation
  set sync_user_id = case when new.in_sync_window then new.account_id end
  where instruction_id = new.id
    and sync_user_id is distinct from (case when new.in_sync_window then new.account_id end);
  return null;
end;
$$;

-- Not "UPDATE OF": in_sync_window is usually changed by the BEFORE trigger,
-- not by the statement.
create trigger instruction_sync_window_propagate
  after update on public.instruction
  for each row
  when (old.in_sync_window is distinct from new.in_sync_window
        or old.account_id is distinct from new.account_id)
  execute function public.instruction_sync_window_propagate();

create function public.instruction_asset_allocation_sync_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.sync_user_id := (
    select case when i.in_sync_window then i.account_id end
    from public.instruction i
    where i.id = new.instruction_id
  );
  if tg_op = 'UPDATE' and public.powersync_only_sync_columns_changed(to_jsonb(old), to_jsonb(new)) then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create trigger instruction_asset_allocation_sync_user
  before insert or update on public.instruction_asset_allocation
  for each row execute function public.instruction_asset_allocation_sync_user();

-- ============================================================================
-- inspection_activity.in_sync_window → inspection_value.sync_user_id
--                                    → inspection_image.sync_user_id
-- An activity syncs to the inspector who captured it (created_by).
-- ============================================================================
alter table public.inspection_activity
  add column in_sync_window boolean not null default false;

alter table public.inspection_value
  add column sync_user_id uuid;

alter table public.inspection_image
  add column sync_user_id uuid;

create function public.inspection_activity_sync_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.in_sync_window := public.powersync_activity_in_window(new.inspection_date);
  if tg_op = 'UPDATE' and public.powersync_only_sync_columns_changed(to_jsonb(old), to_jsonb(new)) then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create trigger inspection_activity_sync_window
  before insert or update on public.inspection_activity
  for each row execute function public.inspection_activity_sync_window();

create function public.inspection_activity_sync_window_propagate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.inspection_value
  set sync_user_id = case when new.in_sync_window then new.created_by end
  where inspection_activity_id = new.id
    and sync_user_id is distinct from (case when new.in_sync_window then new.created_by end);
  return null;
end;
$$;

create trigger inspection_activity_sync_window_propagate
  after update on public.inspection_activity
  for each row
  when (old.in_sync_window is distinct from new.in_sync_window
        or old.created_by is distinct from new.created_by)
  execute function public.inspection_activity_sync_window_propagate();

create function public.inspection_value_sync_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.sync_user_id := (
    select case when a.in_sync_window then a.created_by end
    from public.inspection_activity a
    where a.id = new.inspection_activity_id
  );
  if tg_op = 'UPDATE' and public.powersync_only_sync_columns_changed(to_jsonb(old), to_jsonb(new)) then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create trigger inspection_value_sync_user
  before insert or update on public.inspection_value
  for each row execute function public.inspection_value_sync_user();

create function public.inspection_value_sync_user_propagate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.inspection_image
  set sync_user_id = new.sync_user_id
  where inspection_value_id = new.id
    and sync_user_id is distinct from new.sync_user_id;
  return null;
end;
$$;

create trigger inspection_value_sync_user_propagate
  after update on public.inspection_value
  for each row
  when (old.sync_user_id is distinct from new.sync_user_id)
  execute function public.inspection_value_sync_user_propagate();

create function public.inspection_image_sync_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.sync_user_id := (
    select v.sync_user_id from public.inspection_value v where v.id = new.inspection_value_id
  );
  return new;
end;
$$;

create trigger inspection_image_sync_user
  before insert or update on public.inspection_image
  for each row execute function public.inspection_image_sync_user();

-- ============================================================================
-- Moving the window. Only rows whose flag changes are written; the triggers
-- above carry the change down to the child rows. Hourly, so the window moves
-- soon after midnight in the app time zone.
-- ============================================================================
create function public.refresh_powersync_sync_window()
returns void
language sql
security definer
set search_path = public
as $$
  update public.instruction
  set in_sync_window = public.powersync_instruction_in_window(required_completed_date)
  where in_sync_window is distinct from public.powersync_instruction_in_window(required_completed_date);

  update public.inspection_activity
  set in_sync_window = public.powersync_activity_in_window(inspection_date)
  where in_sync_window is distinct from public.powersync_activity_in_window(inspection_date);
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'powersync_window_start()',
    'powersync_instruction_in_window(date)',
    'powersync_activity_in_window(timestamptz)',
    'powersync_only_sync_columns_changed(jsonb, jsonb)',
    'refresh_powersync_sync_window()'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end;
$$;

select cron.schedule(
  'powersync-sync-window',
  '17 * * * *',
  $$select public.refresh_powersync_sync_window()$$
);

-- Backfill: flag what's in the window now (everything starts outside it).
select public.refresh_powersync_sync_window();
