-- Grid redesign, phase 1.6 (docs/grid-redesign-plan.md).
--
-- Server-mode grids read one page at a time from a flat `<thing>_grid` view
-- that exposes every displayed, filtered and sorted value as a plain column,
-- plus Changed (changed_at / changed_by / changed_by_name). The views are
-- security_invoker, so the base tables' RLS still decides what a caller sees.

-- ============================================================================
-- grid_user_name — "Changed by" / "Assigned to" names in grid views.
-- Views can't read auth.users under security_invoker, so this is SECURITY
-- DEFINER, with the same name expression and role check as get_user_names.
-- System writes leave updated_by null: shown as 'System'.
-- (public.user_display_name already exists for the services trigger, which
-- relies on it returning null, so this is a separate function.)
-- ============================================================================
create function public.grid_user_name(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_id is null then 'System'
    else (
      select coalesce(nullif(btrim(p.username), ''), split_part(u.email::text, '@', 1))
      from auth.users u
      left join public.profiles p on p.id = u.id
      where u.id = p_id
        and public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[])
    )
  end;
$$;

revoke execute on function public.grid_user_name(uuid) from public, anon;
grant execute on function public.grid_user_name(uuid) to authenticated;

-- ============================================================================
-- instruction_grid — Inspections → Instructions.
-- ============================================================================
create view public.instruction_grid
with (security_invoker = true)
as
select
  i.id,
  i.legacy_uid as uid,
  i.name,
  i.comment,
  i.account_id,
  case when i.account_id is null then null else public.grid_user_name(i.account_id) end as account_name,
  i.nr_completed,
  i.nr_of_allocations,
  i.status,
  i.required_completed_date,
  i.is_scheduled,
  i.updated_at as changed_at,
  i.updated_by as changed_by,
  public.grid_user_name(i.updated_by) as changed_by_name
from public.instruction i;

grant select on public.instruction_grid to authenticated;
