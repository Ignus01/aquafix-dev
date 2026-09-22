-- Profile data (display username, phone) for the user-management section.
-- Supabase Auth itself is email/password based; `username` here is a display
-- label shown in the admin UI, not a separate login mechanism.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_not_blank check (btrim(username) <> ''),
  constraint profiles_username_key unique (username)
);

alter table public.profiles enable row level security;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- A user can read their own profile...
create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

-- ...and system_admin/admin can read everyone's, for the user-management list.
create policy profiles_select_admin
  on public.profiles for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]));

-- No insert/update/delete policies: profiles are created/edited by server-side
-- admin actions using the service role (same pattern as user_masterdata_roles).
