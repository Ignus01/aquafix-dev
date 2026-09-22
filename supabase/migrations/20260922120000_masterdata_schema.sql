-- Masterdata schema rebuild (source: Mendix `Masterdata` module).
-- Entities: region, organisation, colour_container (stub), asset_type, location, grading, asset.
-- See spec/masterfiles/*.md for the source business rules (rule IDs referenced in comments below).

create extension if not exists pgcrypto with schema extensions;

create type public.asset_classification as enum ('FLEET', 'OTHER');
create type public.location_transfer_type as enum ('AUTO', 'MANUAL');

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================================
-- region
-- ============================================================================
create table public.region (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint region_name_not_blank check (btrim(name) <> ''),
  constraint region_name_key unique (name)
);

create trigger region_set_updated_at
  before update on public.region
  for each row execute function public.set_updated_at();

alter table public.region enable row level security;

-- ============================================================================
-- organisation
-- ============================================================================
create table public.organisation (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  name text not null,
  active boolean not null default true,
  is_supplier boolean not null default false,
  is_service_supplier boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint organisation_name_not_blank check (btrim(name) <> ''),
  constraint organisation_name_key unique (name)
);

-- ORG-R02: Mendix normalizes Name to uppercase before the uniqueness check and commit.
create function public.normalize_organisation_name()
returns trigger
language plpgsql
as $$
begin
  new.name := upper(new.name);
  return new;
end;
$$;

create trigger organisation_normalize_name
  before insert or update on public.organisation
  for each row execute function public.normalize_organisation_name();

create trigger organisation_set_updated_at
  before update on public.organisation
  for each row execute function public.set_updated_at();

alter table public.organisation enable row level security;

-- ============================================================================
-- colour_container (stub — not one of the six in-scope entities; only the
-- fields grading.md names are modelled, since Grading requires this FK)
-- ============================================================================
create table public.colour_container (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hex_colour text,
  class_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger colour_container_set_updated_at
  before update on public.colour_container
  for each row execute function public.set_updated_at();

alter table public.colour_container enable row level security;

-- ============================================================================
-- asset_type
-- ============================================================================
create table public.asset_type (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  name text not null,
  classification public.asset_classification not null default 'OTHER',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint asset_type_name_not_blank check (btrim(name) <> ''),
  constraint asset_type_name_key unique (name)
);

create trigger asset_type_set_updated_at
  before update on public.asset_type
  for each row execute function public.set_updated_at();

alter table public.asset_type enable row level security;

-- ============================================================================
-- location
-- ============================================================================
create table public.location (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  name text not null,
  active boolean not null default true,
  transfer_type public.location_transfer_type not null default 'AUTO',
  is_stock_manager boolean not null default true,
  is_asset_manager boolean not null default true,
  -- LOC-R03/LOC-R04: required in Mendix but not delete-protected there (a flagged
  -- pre-existing gap). Fixed here with NOT NULL + RESTRICT rather than replicated.
  region_id uuid not null references public.region (id) on delete restrict,
  organisation_id uuid not null references public.organisation (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint location_name_not_blank check (btrim(name) <> ''),
  constraint location_name_key unique (name)
);

create index location_region_id_idx on public.location (region_id);
create index location_organisation_id_idx on public.location (organisation_id);

create trigger location_set_updated_at
  before update on public.location
  for each row execute function public.set_updated_at();

alter table public.location enable row level security;

-- ============================================================================
-- grading
-- ============================================================================
create table public.grading (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  name text not null,
  priority integer not null default 0,
  class_name text not null default '',
  -- GRD-R03: required in Mendix but not delete-protected there (flagged gap).
  -- Fixed here with NOT NULL + RESTRICT rather than replicated.
  colour_container_id uuid not null references public.colour_container (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint grading_name_not_blank check (btrim(name) <> ''),
  constraint grading_name_key unique (name)
);

create index grading_colour_container_id_idx on public.grading (colour_container_id);

-- GRD-R04: class_name is mirrored from the linked ColourContainer on every save.
create function public.sync_grading_class_name()
returns trigger
language plpgsql
as $$
begin
  select cc.class_name into new.class_name
  from public.colour_container cc
  where cc.id = new.colour_container_id;
  return new;
end;
$$;

create trigger grading_sync_class_name
  before insert or update on public.grading
  for each row execute function public.sync_grading_class_name();

create trigger grading_set_updated_at
  before update on public.grading
  for each row execute function public.set_updated_at();

alter table public.grading enable row level security;

-- ============================================================================
-- asset
-- ============================================================================
create table public.asset (
  id uuid primary key default gen_random_uuid(),
  legacy_uid bigint generated always as identity (start with 1) not null unique,
  name text not null,
  code text not null,
  purchase_date timestamptz,
  active boolean not null default true,
  last_inspection_date timestamptz,
  has_service_plan boolean not null default false,
  service_interval numeric not null default 0,
  asset_type_id uuid not null references public.asset_type (id) on delete restrict,
  location_id uuid not null references public.location (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint asset_name_not_blank check (btrim(name) <> ''),
  constraint asset_code_not_blank check (btrim(code) <> ''),
  -- AST-R03: Name unique per Location.
  constraint asset_name_location_key unique (location_id, name),
  -- AST-R04: Code unique globally.
  constraint asset_code_key unique (code),
  -- AST-R07: ServiceInterval required and > 0 when HasServicePlan is true.
  constraint asset_service_interval_check check (
    has_service_plan = false or service_interval > 0
  )
);

create index asset_asset_type_id_idx on public.asset (asset_type_id);
create index asset_location_id_idx on public.asset (location_id);

create trigger asset_set_updated_at
  before update on public.asset
  for each row execute function public.set_updated_at();

alter table public.asset enable row level security;
