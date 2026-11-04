-- PowerSync: incidents, stock documents, services, names and roles
-- (Aquafix Capture spec, Migration drafts §1; decisions of 4 Nov 2026).
--
-- Same model as 20261102120000_powersync_sync_window.sql: child rows carry a
-- copied column kept by triggers, so every stream filters on the user id or
-- on nothing (powersync/sync-config.yaml).
--
--   * incident.incident_open = status is not completed (open_incidents: every
--     open incident goes to every phone). Copied to incident_note and
--     incident_image; a photo on a note copies through the note.
--   * incident.sync_user_id = created_by while the incident is open or was
--     completed in the last 7 days, else null (my_incidents). Copied the same
--     way.
--   * transfer_main, work_order, stock_take, load: sync_user_id = created_by
--     while the document date is in the last 7 days (my_stock). Copied to
--     transfer_item, work_order_item and stock_take_item.
--
-- "The last 7 days" is today and the 6 days before it, in the app time zone
-- (app_today()); a document dated in the future counts too. The hourly
-- refresh (cron powersync-sync-window, unchanged) moves sync_user_id as days
-- pass.
--
-- A write that only changes sync columns has no side effects: it keeps
-- updated_at (and updated_by, which only a signed-in session changes; the
-- refresh runs without one), writes no incident status history (that
-- trigger fires on UPDATE OF status only), sends no notifications (they fire
-- on INSERT only), and posts nothing to the stock ledger (the line triggers
-- below skip it).

-- incident_open is a sync column too.
create or replace function public.powersync_only_sync_columns_changed(p_old jsonb, p_new jsonb)
returns boolean
language sql
immutable
as $$
  select p_old - array['updated_at', 'in_sync_window', 'sync_user_id', 'incident_open']
       = p_new - array['updated_at', 'in_sync_window', 'sync_user_id', 'incident_open'];
$$;

-- The 7-day window: on or after app_today() - 6, in the app time zone.
create function public.powersync_in_recent_window(p_at timestamptz)
returns boolean
language sql
stable
as $$
  select (p_at at time zone public.app_time_zone())::date >= public.app_today() - 6;
$$;

create function public.powersync_in_recent_window(p_date date)
returns boolean
language sql
stable
as $$
  select p_date >= public.app_today() - 6;
$$;

create function public.powersync_incident_sync_user(
  p_status public.incident_status, p_completed_at timestamptz, p_created_by uuid)
returns uuid
language sql
stable
as $$
  select case
    when p_status <> 'completed' or public.powersync_in_recent_window(p_completed_at) then p_created_by
  end;
$$;

-- ============================================================================
-- incident → incident_note → incident_image
-- ============================================================================
alter table public.incident
  add column incident_open boolean not null default false,
  add column sync_user_id uuid;

alter table public.incident_note
  add column incident_open boolean not null default false,
  add column sync_user_id uuid;

alter table public.incident_image
  add column incident_open boolean not null default false,
  add column sync_user_id uuid;

-- BEFORE triggers fire in name order: *_sync_user runs after
-- *_set_audit_fields (which sets created_by and updated_at), so it sees the
-- final created_by and can put updated_at back.
create function public.incident_sync_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.incident_open := new.status <> 'completed';
  new.sync_user_id := public.powersync_incident_sync_user(new.status, new.completed_at, new.created_by);
  if tg_op = 'UPDATE' and public.powersync_only_sync_columns_changed(to_jsonb(old), to_jsonb(new)) then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create trigger incident_sync_user
  before insert or update on public.incident
  for each row execute function public.incident_sync_user();

create function public.incident_sync_user_propagate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.incident_note
  set incident_open = new.incident_open, sync_user_id = new.sync_user_id
  where incident_id = new.id
    and (incident_open is distinct from new.incident_open
         or sync_user_id is distinct from new.sync_user_id);

  update public.incident_image
  set incident_open = new.incident_open, sync_user_id = new.sync_user_id
  where incident_id = new.id
    and (incident_open is distinct from new.incident_open
         or sync_user_id is distinct from new.sync_user_id);
  return null;
end;
$$;

create trigger incident_sync_user_propagate
  after update on public.incident
  for each row
  when (old.incident_open is distinct from new.incident_open
        or old.sync_user_id is distinct from new.sync_user_id)
  execute function public.incident_sync_user_propagate();

create function public.incident_note_sync_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select i.incident_open, i.sync_user_id
  into new.incident_open, new.sync_user_id
  from public.incident i
  where i.id = new.incident_id;
  return new;
end;
$$;

create trigger incident_note_sync_user
  before insert or update on public.incident_note
  for each row execute function public.incident_note_sync_user();

create function public.incident_note_sync_user_propagate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.incident_image
  set incident_open = new.incident_open, sync_user_id = new.sync_user_id
  where incident_note_id = new.id
    and (incident_open is distinct from new.incident_open
         or sync_user_id is distinct from new.sync_user_id);
  return null;
end;
$$;

create trigger incident_note_sync_user_propagate
  after update on public.incident_note
  for each row
  when (old.incident_open is distinct from new.incident_open
        or old.sync_user_id is distinct from new.sync_user_id)
  execute function public.incident_note_sync_user_propagate();

-- A photo has exactly one parent: the incident, or one of its notes.
create function public.incident_image_sync_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.incident_id is not null then
    select i.incident_open, i.sync_user_id
    into new.incident_open, new.sync_user_id
    from public.incident i
    where i.id = new.incident_id;
  else
    select n.incident_open, n.sync_user_id
    into new.incident_open, new.sync_user_id
    from public.incident_note n
    where n.id = new.incident_note_id;
  end if;
  return new;
end;
$$;

create trigger incident_image_sync_user
  before insert or update on public.incident_image
  for each row execute function public.incident_image_sync_user();

-- ============================================================================
-- Stock documents: header → lines (load has no lines)
-- ============================================================================
alter table public.transfer_main add column sync_user_id uuid;
alter table public.work_order add column sync_user_id uuid;
alter table public.stock_take add column sync_user_id uuid;
alter table public.load add column sync_user_id uuid;
alter table public.transfer_item add column sync_user_id uuid;
alter table public.work_order_item add column sync_user_id uuid;
alter table public.stock_take_item add column sync_user_id uuid;

-- Runs after <table>_audit (name order), which sets created_by and updated_at.
create function public.stock_doc_sync_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent boolean;
begin
  if tg_table_name = 'transfer_main' then
    v_recent := public.powersync_in_recent_window(new.transfer_date);
  elsif tg_table_name = 'work_order' then
    v_recent := public.powersync_in_recent_window(new.order_date);
  elsif tg_table_name = 'stock_take' then
    v_recent := public.powersync_in_recent_window(new.take_date);
  elsif tg_table_name = 'load' then
    v_recent := public.powersync_in_recent_window(new.load_date);
  end if;
  new.sync_user_id := case when v_recent then new.created_by end;
  if tg_op = 'UPDATE' and public.powersync_only_sync_columns_changed(to_jsonb(old), to_jsonb(new)) then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create function public.stock_doc_sync_user_propagate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'transfer_main' then
    update public.transfer_item set sync_user_id = new.sync_user_id
    where transfer_id = new.id and sync_user_id is distinct from new.sync_user_id;
  elsif tg_table_name = 'work_order' then
    update public.work_order_item set sync_user_id = new.sync_user_id
    where work_order_id = new.id and sync_user_id is distinct from new.sync_user_id;
  elsif tg_table_name = 'stock_take' then
    update public.stock_take_item set sync_user_id = new.sync_user_id
    where stock_take_id = new.id and sync_user_id is distinct from new.sync_user_id;
  end if;
  return null;
end;
$$;

create function public.stock_line_sync_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'transfer_item' then
    new.sync_user_id := (select h.sync_user_id from public.transfer_main h where h.id = new.transfer_id);
  elsif tg_table_name = 'work_order_item' then
    new.sync_user_id := (select h.sync_user_id from public.work_order h where h.id = new.work_order_id);
  elsif tg_table_name = 'stock_take_item' then
    new.sync_user_id := (select h.sync_user_id from public.stock_take h where h.id = new.stock_take_id);
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['transfer_main', 'work_order', 'stock_take', 'load'] loop
    execute format('create trigger %1$s_sync_user before insert or update on public.%1$I
                    for each row execute function public.stock_doc_sync_user()', t);
  end loop;
  foreach t in array array['transfer_main', 'work_order', 'stock_take'] loop
    execute format('create trigger %1$s_sync_user_propagate after update on public.%1$I
                    for each row when (old.sync_user_id is distinct from new.sync_user_id)
                    execute function public.stock_doc_sync_user_propagate()', t);
  end loop;
  foreach t in array array['transfer_item', 'work_order_item', 'stock_take_item'] loop
    execute format('create trigger %1$s_sync_user before insert or update on public.%1$I
                    for each row execute function public.stock_line_sync_user()', t);
  end loop;
end;
$$;

-- The line triggers that post to the ledger (and the stock take's
-- recount) would run again on a sync-only update of a line: a recount
-- against today's ledger would change a saved adjustment. Split each into an
-- INSERT trigger and an UPDATE trigger that skips sync-only updates (a WHEN
-- on an INSERT OR UPDATE trigger can't read OLD). Same functions, same
-- order (BEFORE: <line>_audit, <line>_before_*, <line>_sync_user).
-- "Sync-only" means sync_user_id changed and nothing else did: an update
-- that changes nothing at all still runs them (stock_take_after_update
-- recounts its lines with `set counted_qty = counted_qty`).
drop trigger stock_take_item_before on public.stock_take_item;
create trigger stock_take_item_before_insert
  before insert on public.stock_take_item
  for each row execute function public.stock_take_item_before();
create trigger stock_take_item_before_update
  before update on public.stock_take_item
  for each row
  when (old.sync_user_id is not distinct from new.sync_user_id
        or not public.powersync_only_sync_columns_changed(to_jsonb(old), to_jsonb(new)))
  execute function public.stock_take_item_before();

drop trigger transfer_item_after on public.transfer_item;
create trigger transfer_item_after_insert
  after insert on public.transfer_item
  for each row execute function public.transfer_item_after();
create trigger transfer_item_after_update
  after update on public.transfer_item
  for each row
  when (old.sync_user_id is not distinct from new.sync_user_id
        or not public.powersync_only_sync_columns_changed(to_jsonb(old), to_jsonb(new)))
  execute function public.transfer_item_after();

drop trigger work_order_item_after on public.work_order_item;
create trigger work_order_item_after_insert
  after insert on public.work_order_item
  for each row execute function public.work_order_item_after();
create trigger work_order_item_after_update
  after update on public.work_order_item
  for each row
  when (old.sync_user_id is not distinct from new.sync_user_id
        or not public.powersync_only_sync_columns_changed(to_jsonb(old), to_jsonb(new)))
  execute function public.work_order_item_after();

drop trigger stock_take_item_after on public.stock_take_item;
create trigger stock_take_item_after_insert
  after insert on public.stock_take_item
  for each row execute function public.stock_take_item_after();
create trigger stock_take_item_after_update
  after update on public.stock_take_item
  for each row
  when (old.sync_user_id is not distinct from new.sync_user_id
        or not public.powersync_only_sync_columns_changed(to_jsonb(old), to_jsonb(new)))
  execute function public.stock_take_item_after();

-- ============================================================================
-- The hourly refresh (cron powersync-sync-window, unchanged): the body of
-- 20261104120000_powersync_window_decisions.sql plus incidents and stock.
-- Only rows whose value changes are written; the triggers above carry the
-- change down to the child rows.
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

  update public.incident
  set incident_open = status <> 'completed',
      sync_user_id = public.powersync_incident_sync_user(status, completed_at, created_by)
  where incident_open is distinct from (status <> 'completed')
     or sync_user_id is distinct from public.powersync_incident_sync_user(status, completed_at, created_by);

  update public.transfer_main
  set sync_user_id = case when public.powersync_in_recent_window(transfer_date) then created_by end
  where sync_user_id is distinct from (case when public.powersync_in_recent_window(transfer_date) then created_by end);

  update public.work_order
  set sync_user_id = case when public.powersync_in_recent_window(order_date) then created_by end
  where sync_user_id is distinct from (case when public.powersync_in_recent_window(order_date) then created_by end);

  update public.stock_take
  set sync_user_id = case when public.powersync_in_recent_window(take_date) then created_by end
  where sync_user_id is distinct from (case when public.powersync_in_recent_window(take_date) then created_by end);

  update public.load
  set sync_user_id = case when public.powersync_in_recent_window(load_date) then created_by end
  where sync_user_id is distinct from (case when public.powersync_in_recent_window(load_date) then created_by end);
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'powersync_in_recent_window(timestamptz)',
    'powersync_in_recent_window(date)',
    'powersync_incident_sync_user(public.incident_status, timestamptz, uuid)',
    'refresh_powersync_sync_window()'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- ============================================================================
-- powersync_role and the powersync publication (see
-- 20261102130000_powersync_role.sql): the same tables in both.
-- profiles and organisation sync named columns only (sync-config.yaml), but
-- PowerSync reads whole tables, so the grants are table-wide.
-- ============================================================================
grant select on
  -- open_incidents, my_incidents
  public.incident,
  public.incident_note,
  public.incident_image,
  -- open_services
  public.service,
  public.organisation,
  -- my_stock
  public.transfer_main,
  public.transfer_item,
  public.work_order,
  public.work_order_item,
  public.stock_take,
  public.stock_take_item,
  public.load,
  -- reference_data
  public.incident_type,
  public.profiles,
  public.storage_area,
  public.item
to powersync_role;

alter publication powersync add table
  public.incident,
  public.incident_note,
  public.incident_image,
  public.service,
  public.organisation,
  public.transfer_main,
  public.transfer_item,
  public.work_order,
  public.work_order_item,
  public.stock_take,
  public.stock_take_item,
  public.load,
  public.incident_type,
  public.profiles,
  public.storage_area,
  public.item;

-- Backfill: every row starts closed and unsynced; set them now.
select public.refresh_powersync_sync_window();
