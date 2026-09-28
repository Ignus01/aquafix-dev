-- Inspections schema rebuild (source: Mendix `AssetManagement` inspection area).
-- Entities: public_holiday (replaces the Masterdata.Days calendar),
-- scheduled_instruction (+ its asset set), instruction,
-- instruction_asset_allocation, inspection_activity, inspection_value,
-- inspection_image, inspection_cumulative_value (+ an audit of changes) and
-- instruction_schedule_run (issuing log).
-- See spec/inspections/*.md for the source business rules (rule IDs
-- referenced in comments below).
--
-- Decisions signed off for the rebuild (2026-09-28):
--   * Ad-hoc inspections have no instruction (instruction_id is null) instead
--     of a fake "AdHoc" Instruction per inspection.
--   * One allocation per (instruction, asset); the picker sets the list
--     (fixes the INS-R04 duplicate allocations).
--   * Deleting an activity recomputes the allocation tick and the asset's
--     last-inspection date (fixes IAC-R05).
--   * Schedules get an Active flag.
--   * Validation replicates Mendix except V1, V8 and V9 (see
--     save_inspection_activity in the next migration).

create type public.instruction_schedule_type as enum ('daily', 'weekly', 'monthly');

-- AssetManagement.ENUM_Status (the same captions as incident_status).
create type public.instruction_status as enum ('new', 'in_progress', 'completed');

-- The app's "today": midnight in the configured time zone (system_settings,
-- default Africa/Johannesburg). Instruction due dates and the issuing day
-- are calendar days in that zone.
create function public.app_today()
returns date
language sql
stable
as $$
  select (now() at time zone public.app_time_zone())::date;
$$;

revoke execute on function public.app_today() from public, anon;
grant execute on function public.app_today() to authenticated;

-- ============================================================================
-- public_holiday — replaces the Masterdata.Days calendar rows. Weekends come
-- from the date itself; a date with no row is a normal working day (the
-- Mendix issuing flow errored when today's Days row was missing).
-- ============================================================================
create table public.public_holiday (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint public_holiday_name_not_blank check (btrim(name) <> ''),
  constraint public_holiday_date_key unique (holiday_date)
);

create trigger public_holiday_set_updated_at
  before update on public.public_holiday
  for each row execute function public.set_updated_at();

alter table public.public_holiday enable row level security;

-- ============================================================================
-- scheduled_instruction — a recurring instruction template
-- ============================================================================
create table public.scheduled_instruction (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  -- SCH-R01
  name text not null,
  comment text not null default '',
  -- SCH-R04
  schedule_type public.instruction_schedule_type not null,
  -- Daily only.
  include_weekends boolean not null default false,
  include_public_holidays boolean not null default false,
  -- SCH-R05: Monthly only, 1–30 (31 is rejected, as in Mendix; 29/30 never
  -- fire in February).
  day_of_month integer,
  -- SCH-R06: Weekly only. ISO weekdays, 1 = Monday … 7 = Sunday (replaces the
  -- Masterdata.WeekDays reference set).
  week_days smallint[] not null default '{}',
  -- SCH-R07: 1 when created through the UI. RequiredCompletedDate = issue day
  -- + this.
  days_to_complete integer not null default 1,
  -- New: pause a schedule without deleting it.
  active boolean not null default true,
  -- SCH-R02: the assignee. Mendix cleared the reference when the Account was
  -- deleted; kept that way (issuing skips a schedule with no assignee and
  -- logs it) so deleting a user isn't blocked.
  account_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint scheduled_instruction_name_not_blank check (btrim(name) <> ''),
  constraint scheduled_instruction_day_of_month_check check (
    schedule_type <> 'monthly' or day_of_month between 1 and 30
  ),
  constraint scheduled_instruction_week_days_check check (
    week_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    and (schedule_type <> 'weekly' or cardinality(week_days) > 0)
  ),
  constraint scheduled_instruction_days_to_complete_check check (days_to_complete >= 0)
);

create index scheduled_instruction_account_id_idx on public.scheduled_instruction (account_id);

create trigger scheduled_instruction_set_updated_at
  before update on public.scheduled_instruction
  for each row execute function public.set_updated_at();

alter table public.scheduled_instruction enable row level security;

-- SCH-R03: the assets to inspect (Mendix reference set, no delete
-- protection: deleting an Asset just removes it from the set).
create table public.scheduled_instruction_asset (
  scheduled_instruction_id uuid not null references public.scheduled_instruction (id) on delete cascade,
  asset_id uuid not null references public.asset (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (scheduled_instruction_id, asset_id)
);

create index scheduled_instruction_asset_asset_id_idx on public.scheduled_instruction_asset (asset_id);

alter table public.scheduled_instruction_asset enable row level security;

-- ============================================================================
-- instruction — one work order for one Account
-- ============================================================================
create table public.instruction (
  id uuid primary key default gen_random_uuid(),
  -- Mendix `_UID` (the PDF is INS-{legacy_uid}.pdf).
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  -- INS-R02: required. Tightened to reject whitespace-only names.
  name text not null,
  comment text not null default '',
  -- INS-R05: derived from the allocations by trigger (see
  -- refresh_instruction_progress); never written by clients.
  status public.instruction_status not null default 'new',
  nr_of_allocations integer not null default 0,
  nr_completed integer not null default 0,
  is_scheduled boolean not null default false,
  -- Mendix RequiredCompletedDate (a DateTime that always held midnight).
  required_completed_date date not null,
  -- The assignee. Required on save (INS-R02); cleared if the user is deleted.
  account_id uuid references auth.users (id) on delete set null,
  -- Scheduled instructions only: the issuing schedule and day (replaces the
  -- Instruction_Days link). Deleting the schedule keeps its instructions.
  scheduled_instruction_id uuid references public.scheduled_instruction (id) on delete set null,
  issue_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint instruction_name_not_blank check (btrim(name) <> ''),
  constraint instruction_counts_check check (nr_completed between 0 and nr_of_allocations),
  -- One instruction per schedule per day, so the daily job, its retries and
  -- the manual "Run Schedule" button are idempotent (migration notes).
  constraint instruction_schedule_day_key unique (scheduled_instruction_id, issue_date)
);

create index instruction_account_open_idx on public.instruction (account_id, required_completed_date)
  where status <> 'completed';
create index instruction_scheduled_instruction_id_idx on public.instruction (scheduled_instruction_id);

create trigger instruction_set_updated_at
  before update on public.instruction
  for each row execute function public.set_updated_at();

alter table public.instruction enable row level security;

-- ============================================================================
-- instruction_asset_allocation — one asset on an instruction
-- ============================================================================
create table public.instruction_asset_allocation (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  instruction_id uuid not null references public.instruction (id) on delete cascade,
  -- Mendix had no delete protection (deleting an Asset silently cleared the
  -- reference); blocked here (migration notes).
  asset_id uuid not null references public.asset (id) on delete restrict,
  is_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Fixes INS-R04: an asset can only be allocated once per instruction.
  constraint instruction_asset_allocation_instruction_asset_key unique (instruction_id, asset_id)
);

create index instruction_asset_allocation_asset_id_idx on public.instruction_asset_allocation (asset_id);

create trigger instruction_asset_allocation_set_updated_at
  before update on public.instruction_asset_allocation
  for each row execute function public.set_updated_at();

alter table public.instruction_asset_allocation enable row level security;

-- INS-R05 as one rule: New while nothing is completed, Completed once every
-- allocation is, In Progress in between. (Mendix only recalculated on an
-- inspection save or an allocation delete; derived on every change here, as
-- the migration notes recommend.)
create function public.refresh_instruction_progress(p_instruction_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  with c as (
    select
      count(*)::integer as total,
      (count(*) filter (where is_completed))::integer as done
    from public.instruction_asset_allocation
    where instruction_id = p_instruction_id
  ), s as (
    select
      total,
      done,
      (case
        when total > 0 and done = total then 'completed'
        when done = 0 then 'new'
        else 'in_progress'
      end)::public.instruction_status as status
    from c
  )
  update public.instruction i
  set nr_of_allocations = s.total, nr_completed = s.done, status = s.status
  from s
  where i.id = p_instruction_id
    and (i.nr_of_allocations, i.nr_completed, i.status) is distinct from (s.total, s.done, s.status);
$$;

revoke execute on function public.refresh_instruction_progress(uuid) from public, anon, authenticated;

create function public.instruction_asset_allocation_refresh()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_instruction_progress(new.instruction_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or old.instruction_id <> new.instruction_id) then
    perform public.refresh_instruction_progress(old.instruction_id);
  end if;
  return null;
end;
$$;

create trigger instruction_asset_allocation_refresh
  after insert or delete or update of is_completed, instruction_id on public.instruction_asset_allocation
  for each row execute function public.instruction_asset_allocation_refresh();

-- ============================================================================
-- inspection_activity — one inspection of one asset
-- ============================================================================
create table public.inspection_activity (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  -- Deleting an Asset is blocked once inspected ("Cannot delete this Asset as
  -- there are inspections done on it.").
  asset_id uuid not null references public.asset (id) on delete restrict,
  -- Null for ad-hoc inspections. Deleting an Instruction is blocked while
  -- activities exist ("Instruction already has Inspection Activities linked
  -- to it.").
  instruction_id uuid references public.instruction (id) on delete restrict,
  -- The worst value grading, set on save (validation §4).
  grading_id uuid references public.grading (id) on delete restrict,
  inspection_date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Mendix System.owner, shown as "Inspected By".
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null
);

create index inspection_activity_asset_id_idx on public.inspection_activity (asset_id, inspection_date desc);
create index inspection_activity_instruction_id_idx on public.inspection_activity (instruction_id, asset_id);
create index inspection_activity_created_by_idx on public.inspection_activity (created_by, inspection_date desc);
create index inspection_activity_grading_id_idx on public.inspection_activity (grading_id);

create trigger inspection_activity_set_updated_at
  before update on public.inspection_activity
  for each row execute function public.set_updated_at();

alter table public.inspection_activity enable row level security;

-- ============================================================================
-- inspection_value — the answer to one Inspection within an activity
-- ============================================================================
create table public.inspection_value (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  inspection_activity_id uuid not null references public.inspection_activity (id) on delete cascade,
  -- "Cannot delete this Inspection as there has been inspections taken,
  -- rather mark it as Inactive."
  inspection_id uuid not null references public.inspection (id) on delete restrict,
  -- DROP_DOWN answer. "This drop down option has been selected in an
  -- inspection - rather mark it as inactive."
  inspection_drop_down_option_id uuid references public.inspection_drop_down_option (id) on delete restrict,
  -- "This Grading has already been applied to an Inspection Value."
  grading_id uuid references public.grading (id) on delete restrict,
  text_value text not null default '',
  -- Mendix default 0, so a DECIMAL_VALUE answer is never "empty" (A4).
  decimal_value numeric not null default 0,
  date_value timestamptz,
  -- Set on save (validation §5.1).
  display_value varchar(200) not null default '',
  -- false = a superseded Feedback attempt (validation §1).
  is_current boolean not null default true,
  -- Order within the activity (Mendix association order: allocation
  -- _Priority at creation, retries after the attempt they replace).
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mendix's BoleanValue (unused) and the never-populated InspectionRule link
-- are not carried over (migration notes).

create index inspection_value_activity_idx on public.inspection_value (inspection_activity_id, sort_order);
create index inspection_value_inspection_id_idx on public.inspection_value (inspection_id);
create index inspection_value_option_id_idx on public.inspection_value (inspection_drop_down_option_id);
create index inspection_value_grading_id_idx on public.inspection_value (grading_id);

create trigger inspection_value_set_updated_at
  before update on public.inspection_value
  for each row execute function public.set_updated_at();

alter table public.inspection_value enable row level security;

-- ============================================================================
-- inspection_image — a photo on a value. Binaries live in the private
-- Storage bucket `inspection-images` (real MIME type kept; migration notes).
-- ============================================================================
create table public.inspection_image (
  id uuid primary key default gen_random_uuid(),
  inspection_value_id uuid not null references public.inspection_value (id) on delete cascade,
  storage_path text not null unique,
  thumbnail_path text unique,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  constraint inspection_image_mime_type_check check (mime_type like 'image/%'),
  constraint inspection_image_size_check check (size_bytes > 0)
);

create index inspection_image_value_id_idx on public.inspection_image (inspection_value_id);

alter table public.inspection_image enable row level security;

-- ============================================================================
-- inspection_cumulative_value — the latest reading per (Inspection, Asset)
-- for CUMULATIVE_VALUE inspections (validation §3.3 / §5.2)
-- ============================================================================
create table public.inspection_cumulative_value (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  inspection_id uuid not null references public.inspection (id) on delete cascade,
  asset_id uuid not null references public.asset (id) on delete cascade,
  latest_value numeric not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint inspection_cumulative_value_inspection_asset_key unique (inspection_id, asset_id)
);

create index inspection_cumulative_value_asset_id_idx on public.inspection_cumulative_value (asset_id);

alter table public.inspection_cumulative_value enable row level security;

-- New: every change to a latest value, so manual overrides are audited
-- (migration notes). Written by trigger only.
create table public.inspection_cumulative_value_change (
  id bigint generated always as identity primary key,
  cumulative_value_id uuid not null references public.inspection_cumulative_value (id) on delete cascade,
  old_value numeric,
  new_value numeric not null,
  -- 'inspection' (a saved activity) or 'manual' (an admin override).
  source text not null,
  inspection_activity_id uuid references public.inspection_activity (id) on delete set null,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users (id) on delete set null,
  constraint inspection_cumulative_value_change_source_check check (source in ('inspection', 'manual'))
);

create index inspection_cumulative_value_change_value_idx
  on public.inspection_cumulative_value_change (cumulative_value_id, changed_at desc);

alter table public.inspection_cumulative_value_change enable row level security;

-- The activity that caused a change is passed in a transaction-local setting
-- by save_inspection_activity; anything else is a manual change.
create function public.log_inspection_cumulative_value_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity uuid := nullif(current_setting('aquafix.inspection_activity_id', true), '')::uuid;
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if new.latest_value is distinct from old.latest_value then
    insert into public.inspection_cumulative_value_change (
      cumulative_value_id, old_value, new_value, source, inspection_activity_id, changed_by
    ) values (
      new.id,
      old.latest_value,
      new.latest_value,
      case when v_activity is null then 'manual' else 'inspection' end,
      v_activity,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

-- BEFORE so updated_at/updated_by are stamped. An inserted row doesn't exist
-- yet in a BEFORE trigger, so inserts are logged by the AFTER trigger below.
create trigger inspection_cumulative_value_log_update
  before update on public.inspection_cumulative_value
  for each row execute function public.log_inspection_cumulative_value_change();

create function public.log_inspection_cumulative_value_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity uuid := nullif(current_setting('aquafix.inspection_activity_id', true), '')::uuid;
begin
  insert into public.inspection_cumulative_value_change (
    cumulative_value_id, old_value, new_value, source, inspection_activity_id, changed_by
  ) values (
    new.id, null, new.latest_value,
    case when v_activity is null then 'manual' else 'inspection' end,
    v_activity,
    auth.uid()
  );
  return null;
end;
$$;

create trigger inspection_cumulative_value_log_insert
  after insert on public.inspection_cumulative_value
  for each row execute function public.log_inspection_cumulative_value_insert();

-- ============================================================================
-- instruction_schedule_run — one row per issuing run (migration notes: make
-- a missed or failed day visible).
-- ============================================================================
create table public.instruction_schedule_run (
  id bigint generated always as identity primary key,
  run_date date not null,
  -- 'cron' (the daily job) or 'manual' (the admin "Run Schedule" button).
  trigger text not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  issued_count integer not null default 0,
  -- [{ schedule_id, name, reason }] for schedules that were due but not
  -- issued, or that failed.
  problems jsonb not null default '[]'::jsonb,
  triggered_by uuid references auth.users (id) on delete set null,
  constraint instruction_schedule_run_trigger_check check (trigger in ('cron', 'manual')),
  constraint instruction_schedule_run_status_check check (status in ('running', 'success', 'partial', 'failed'))
);

create index instruction_schedule_run_date_idx on public.instruction_schedule_run (run_date desc, started_at desc);

alter table public.instruction_schedule_run enable row level security;
