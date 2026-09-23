-- Incidents schema rebuild (source: Mendix `AssetManagement` Incident area).
-- Entities: incident, incident_note, incident_image, plus a new
-- incident_status_change history table and a derived location_status view.
-- See spec/incidents/incident.md for the source business rules (rule IDs
-- referenced in comments below).

create type public.incident_status as enum ('new', 'in_progress', 'completed');

-- created_by / updated_by always come from the session, never the client.
-- (auth.uid() is null for service-role writes, which keep what they set.)
create function public.set_incident_audit_fields()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
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
-- incident
-- ============================================================================
create table public.incident (
  id uuid primary key default gen_random_uuid(),
  -- Mendix `_UID`: the human-facing reference number (email subject, email
  -- link, download file names).
  reference bigint generated always as identity (start with 1) not null unique,
  -- ICD-R05: set to "now" at creation and never edited in the source app, so
  -- it equals created_at in practice. Kept as its own column so migrated
  -- Mendix rows keep their IncidentDate; not exposed for editing.
  incident_date timestamptz not null default now(),
  -- ICD-R05: every incident starts as New (Mendix had no domain default).
  status public.incident_status not null default 'new',
  -- Mendix CompletedDate.
  completed_at timestamptz,
  -- ICD-R01: required. Tightened to reject whitespace-only text.
  comment text not null,
  -- ICD-R03 + Incident_Location: deleting a Location is blocked while any
  -- Incident references it.
  location_id uuid not null references public.location (id) on delete restrict,
  -- ICD-R04. Mendix silently cleared the type when an IncidentType was
  -- deleted, orphaning incidents; blocked here instead (migration notes).
  incident_type_id uuid not null references public.incident_type (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint incident_comment_not_blank check (btrim(comment) <> ''),
  -- ICD-R06/R07: completed_at is set exactly while the status is Completed.
  constraint incident_completed_at_check check ((status = 'completed') = (completed_at is not null))
);

-- `_NrOfImages` / `_NrOfNotes` are not stored: counts are computed from the
-- child tables (the second was never written in Mendix anyway).

create index incident_location_id_idx on public.incident (location_id);
create index incident_incident_type_id_idx on public.incident (incident_type_id);
create index incident_created_by_idx on public.incident (created_by);
create index incident_open_idx on public.incident (location_id) where status <> 'completed';

create trigger incident_set_audit_fields
  before insert or update on public.incident
  for each row execute function public.set_incident_audit_fields();

alter table public.incident enable row level security;

-- ============================================================================
-- incident_note — append-only follow-up comments (ICN-R04)
-- ============================================================================
create table public.incident_note (
  id uuid primary key default gen_random_uuid(),
  -- ICN-R02: always belongs to an Incident; cascades from it.
  incident_id uuid not null references public.incident (id) on delete cascade,
  -- ICN-R01: required. Tightened to reject whitespace-only text.
  body text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  constraint incident_note_body_not_blank check (btrim(body) <> '')
);

create index incident_note_incident_id_idx on public.incident_note (incident_id, created_at desc);

create trigger incident_note_set_audit_fields
  before insert or update on public.incident_note
  for each row execute function public.set_incident_audit_fields();

alter table public.incident_note enable row level security;

-- ============================================================================
-- incident_image — a photo on an Incident OR on one of its notes
-- ============================================================================
-- The binaries live in the private Storage bucket `incident-images`; this
-- table holds the paths. Uploads are compressed client-side and get a small
-- thumbnail for the galleries (Mendix's System.Image thumbnail).
create table public.incident_image (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references public.incident (id) on delete cascade,
  incident_note_id uuid references public.incident_note (id) on delete cascade,
  storage_path text not null unique,
  thumbnail_path text unique,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  -- ICI-R02: exactly one parent. Note photos don't count towards the
  -- incident's photos (or ICD-R02), same as the source app.
  constraint incident_image_one_parent check (num_nonnulls(incident_id, incident_note_id) = 1),
  constraint incident_image_mime_type_check check (mime_type like 'image/%'),
  constraint incident_image_size_check check (size_bytes > 0)
);

create index incident_image_incident_id_idx on public.incident_image (incident_id);
create index incident_image_incident_note_id_idx on public.incident_image (incident_note_id);

create trigger incident_image_set_audit_fields
  before insert or update on public.incident_image
  for each row execute function public.set_incident_audit_fields();

alter table public.incident_image enable row level security;

-- ============================================================================
-- incident_status_change — status history (new; Mendix kept only the latest
-- status and CompletedDate). Written by trigger only.
-- ============================================================================
create table public.incident_status_change (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.incident (id) on delete cascade,
  from_status public.incident_status,
  to_status public.incident_status not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users (id) on delete set null
);

create index incident_status_change_incident_id_idx
  on public.incident_status_change (incident_id, changed_at);

alter table public.incident_status_change enable row level security;

create function public.log_incident_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.incident_status_change (incident_id, from_status, to_status, changed_by)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      coalesce(auth.uid(), new.updated_by)
    );
  end if;
  return null;
end;
$$;

create trigger incident_log_status_change
  after insert or update of status on public.incident
  for each row execute function public.log_incident_status_change();

-- ============================================================================
-- location_status — ICD-R10: a Location is not operational while it has an
-- open (not Completed) incident whose type disables locations. Derived, never
-- stored. security_invoker so the caller's RLS on location/incident applies.
-- ============================================================================
create view public.location_status
with (security_invoker = true)
as
select
  l.id as location_id,
  l.name,
  l.active,
  l.is_asset_manager,
  count(i.id)::integer as open_disabling_incident_count,
  count(i.id) = 0 as is_operational
from public.location l
left join (
  public.incident i
  join public.incident_type t
    on t.id = i.incident_type_id
   and t.disables_location
) on i.location_id = l.id
 and i.status <> 'completed'
group by l.id;
