-- Inspection setup schema rebuild (source: Mendix `InspectionSetup` module).
-- Entities: inspection, inspection_rule, inspection_drop_down_option, feedback,
-- incident_type, incident_subscription, inspection_allocation.
-- See spec/inspection-setup/*.md for the source business rules (rule IDs
-- referenced in comments below).

create type public.inspection_value_type as enum (
  'CUMULATIVE_VALUE',
  'DATETIME',
  'DROP_DOWN',
  'DECIMAL_VALUE',
  'TEXT'
);

-- ============================================================================
-- inspection
-- ============================================================================
create table public.inspection (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  -- INS-R01: Name required (not unique in the source app).
  name text not null,
  description text not null default '',
  -- INS-R02: ValueType required. INS-R04: it decides which child table applies
  -- (DROP_DOWN → inspection_drop_down_option, DECIMAL_VALUE → inspection_rule).
  -- Kept as a loose convention like Mendix — no constraint stops stale child
  -- rows from surviving a ValueType change.
  value_type public.inspection_value_type not null,
  is_required boolean not null default true,
  active boolean not null default true,
  nr_of_images_required integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint inspection_name_not_blank check (btrim(name) <> ''),
  constraint inspection_nr_of_images_required_check check (nr_of_images_required >= 0)
);

create trigger inspection_set_updated_at
  before update on public.inspection
  for each row execute function public.set_updated_at();

alter table public.inspection enable row level security;

-- ============================================================================
-- incident_type
-- ============================================================================
create table public.incident_type (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  name text not null,
  is_image_required boolean not null default false,
  -- Runtime effect lives in AssetManagement.Incident (out of scope) — stored only.
  disables_location boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  -- INC-R01 / INC-R02: Name required and globally unique.
  constraint incident_type_name_not_blank check (btrim(name) <> ''),
  constraint incident_type_name_key unique (name)
);

create trigger incident_type_set_updated_at
  before update on public.incident_type
  for each row execute function public.set_updated_at();

alter table public.incident_type enable row level security;

-- ============================================================================
-- incident_subscription — one Account (auth.users) subscribed to one IncidentType
-- ============================================================================
create table public.incident_subscription (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  -- Cascades both ways, as in Mendix (IncidentType deleted / Account deleted).
  incident_type_id uuid not null references public.incident_type (id) on delete cascade,
  -- INCSUB-R01: Account required.
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  -- INCSUB-R02: an Account can only be subscribed once per IncidentType.
  constraint incident_subscription_type_user_key unique (incident_type_id, user_id)
);

create index incident_subscription_user_id_idx on public.incident_subscription (user_id);

create trigger incident_subscription_set_updated_at
  before update on public.incident_subscription
  for each row execute function public.set_updated_at();

alter table public.incident_subscription enable row level security;

-- ============================================================================
-- inspection_drop_down_option — choices for a DROP_DOWN inspection
-- ============================================================================
create table public.inspection_drop_down_option (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  inspection_id uuid not null references public.inspection (id) on delete cascade,
  -- IDO-R01: Name required.
  name text not null,
  nr_of_images_required integer not null default 0,
  priority integer not null default 0,
  active boolean not null default true,
  -- IDO-R02: Grading required. Deleting a referenced Grading is blocked
  -- ("This Grading has already been allocated to a Drop Down Option.").
  grading_id uuid not null references public.grading (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint inspection_drop_down_option_name_not_blank check (btrim(name) <> ''),
  constraint inspection_drop_down_option_nr_of_images_required_check check (nr_of_images_required >= 0)
);

create index inspection_drop_down_option_inspection_id_idx
  on public.inspection_drop_down_option (inspection_id);
create index inspection_drop_down_option_grading_id_idx
  on public.inspection_drop_down_option (grading_id);

create trigger inspection_drop_down_option_set_updated_at
  before update on public.inspection_drop_down_option
  for each row execute function public.set_updated_at();

alter table public.inspection_drop_down_option enable row level security;

-- ============================================================================
-- inspection_rule — a [lower_limit, upper_limit] band for a DECIMAL_VALUE inspection
-- ============================================================================
create table public.inspection_rule (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  inspection_id uuid not null references public.inspection (id) on delete cascade,
  lower_limit numeric not null default 0,
  upper_limit numeric not null default 0,
  nr_of_images_required integer not null default 0,
  -- IRR-R01: system-managed by save_inspection() — true only on the rule with
  -- the lowest bound.
  is_first boolean not null default false,
  -- Not validated as required in the source app, but deleting a referenced
  -- Grading is blocked ("This Grading has already been allocated to a Rule.").
  grading_id uuid references public.grading (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  -- IRR-R02: Mendix auto-corrects reversed ranges (save_inspection() does the
  -- same); this is the hard backstop for writes that bypass it.
  constraint inspection_rule_limits_check check (lower_limit <= upper_limit),
  constraint inspection_rule_nr_of_images_required_check check (nr_of_images_required >= 0)
);

create index inspection_rule_inspection_id_idx on public.inspection_rule (inspection_id);
create index inspection_rule_grading_id_idx on public.inspection_rule (grading_id);

create trigger inspection_rule_set_updated_at
  before update on public.inspection_rule
  for each row execute function public.set_updated_at();

alter table public.inspection_rule enable row level security;

-- ============================================================================
-- feedback — optional guidance attached 1:1 to an inspection_rule
-- ============================================================================
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  -- Mendix InspectionRule_Feedback (owner Both): deleting the Rule deletes its
  -- Feedback. Stored as a unique FK on this side.
  inspection_rule_id uuid not null unique references public.inspection_rule (id) on delete cascade,
  feedback text not null,
  max_nr_of_retries integer not null default 1,
  auto_create_incident boolean not null default false,
  -- Mendix clears this reference when the IncidentType is deleted, which would
  -- leave an auto-create Feedback invalid (FBK-R03). Blocked here instead.
  incident_type_id uuid references public.incident_type (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  -- FBK-R01: at least 5 characters.
  constraint feedback_feedback_length_check check (char_length(feedback) >= 5),
  -- FBK-R02: at least one retry.
  constraint feedback_max_nr_of_retries_check check (max_nr_of_retries >= 1),
  -- FBK-R03: IncidentType required when AutoCreateIncident is on.
  constraint feedback_incident_type_required check (
    auto_create_incident = false or incident_type_id is not null
  )
);

create index feedback_incident_type_id_idx on public.feedback (incident_type_id);

create trigger feedback_set_updated_at
  before update on public.feedback
  for each row execute function public.set_updated_at();

alter table public.feedback enable row level security;

-- ============================================================================
-- inspection_allocation — which inspections apply to which asset types
-- ============================================================================
-- Mendix's FromAssetType flag only chose which picker the popup showed; it is
-- presentation state and is not persisted here.
create table public.inspection_allocation (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  -- Cascades from both parents, as in Mendix.
  inspection_id uuid not null references public.inspection (id) on delete cascade,
  asset_type_id uuid not null references public.asset_type (id) on delete cascade,
  -- Order of an AssetType's inspections (see set_inspection_allocation_priority).
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  -- IAA-R02 / IAA-R04: the same Inspection + AssetType pair can't be allocated twice.
  constraint inspection_allocation_inspection_asset_type_key unique (inspection_id, asset_type_id)
);

create index inspection_allocation_asset_type_id_idx on public.inspection_allocation (asset_type_id);

-- New allocations go to the end of their AssetType's list (max + 1). Mendix
-- seeded this from the global max across all AssetTypes (flagged as a likely
-- defect in asset-type.md) and not at all from the Inspection side; scoped
-- per AssetType here.
create function public.set_inspection_allocation_priority()
returns trigger
language plpgsql
as $$
begin
  if new.priority is null or new.priority = 0 then
    select coalesce(max(ia.priority), 0) + 1 into new.priority
    from public.inspection_allocation ia
    where ia.asset_type_id = new.asset_type_id;
  end if;
  return new;
end;
$$;

create trigger inspection_allocation_set_priority
  before insert on public.inspection_allocation
  for each row execute function public.set_inspection_allocation_priority();

create trigger inspection_allocation_set_updated_at
  before update on public.inspection_allocation
  for each row execute function public.set_updated_at();

alter table public.inspection_allocation enable row level security;
