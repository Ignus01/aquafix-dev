-- RLS policies implementing the Mendix `Masterdata` module access matrix
-- (spec/masterfiles/access-matrix.md). Four module roles: system_admin, admin,
-- user, viewer — all role-based only, no row-level (XPath) constraints existed
-- in the source app, so none are added here either.
--
-- Role assignment: `public.user_masterdata_roles` maps an auth.users row to
-- zero or more masterdata roles (mirrors Mendix's ability to hold multiple
-- module roles). `service_role` (server-side) bypasses RLS entirely, as usual.

create type public.masterdata_role as enum ('system_admin', 'admin', 'user', 'viewer');

create table public.user_masterdata_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.masterdata_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table public.user_masterdata_roles enable row level security;

create policy user_masterdata_roles_select_own
  on public.user_masterdata_roles for select
  to authenticated
  using (user_id = auth.uid());

-- No insert/update/delete policies: role assignment is a service_role-only
-- (admin/back-office) operation, not something users manage via the API.

create function public.has_masterdata_role(roles public.masterdata_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_masterdata_roles umr
    where umr.user_id = auth.uid()
      and umr.role = any (roles)
  );
$$;

-- ============================================================================
-- Asset, AssetType, Location, Organisation — identical pattern:
-- system_admin/admin/user can read+write, only system_admin/admin can delete,
-- viewer is read-only. (access-matrix.md CRUD matrix)
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['asset', 'asset_type', 'location', 'organisation']
  loop
    execute format(
      $sql$
        create policy %1$I_select on public.%1$I for select
          to authenticated
          using (public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[]));

        create policy %1$I_insert on public.%1$I for insert
          to authenticated
          with check (public.has_masterdata_role(array['system_admin','admin','user']::public.masterdata_role[]));

        create policy %1$I_update on public.%1$I for update
          to authenticated
          using (public.has_masterdata_role(array['system_admin','admin','user']::public.masterdata_role[]))
          with check (public.has_masterdata_role(array['system_admin','admin','user']::public.masterdata_role[]));

        create policy %1$I_delete on public.%1$I for delete
          to authenticated
          using (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]));
      $sql$,
      t
    );
  end loop;
end;
$$;

-- ============================================================================
-- Region — `user` has NO access at all (no Masterdata.user rule exists in the
-- source app; see region.md / access-matrix.md open question). Replicated
-- verbatim rather than "fixed", since this needs a product-owner decision.
-- ============================================================================
create policy region_select on public.region for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin','viewer']::public.masterdata_role[]));

create policy region_insert on public.region for insert
  to authenticated
  with check (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]));

create policy region_update on public.region for update
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]))
  with check (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]));

create policy region_delete on public.region for delete
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]));

-- ============================================================================
-- Grading — `user` can read and UPDATE existing rows but cannot INSERT or
-- DELETE (access-matrix.md: allowCreate=false, allowDelete=false for user).
-- ============================================================================
create policy grading_select on public.grading for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[]));

create policy grading_insert on public.grading for insert
  to authenticated
  with check (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]));

create policy grading_update on public.grading for update
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin','user']::public.masterdata_role[]))
  with check (public.has_masterdata_role(array['system_admin','admin','user']::public.masterdata_role[]));

create policy grading_delete on public.grading for delete
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]));

-- ============================================================================
-- colour_container — not one of the six in-scope entities, so the source app
-- has no documented access rule for it. Treated as admin-managed reference
-- data (needed to read/select when editing a Grading), readable by anyone
-- holding any masterdata role. Revisit if the business has an actual rule.
-- ============================================================================
create policy colour_container_select on public.colour_container for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[]));

create policy colour_container_insert on public.colour_container for insert
  to authenticated
  with check (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]));

create policy colour_container_update on public.colour_container for update
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]))
  with check (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]));

create policy colour_container_delete on public.colour_container for delete
  to authenticated
  using (public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]));
