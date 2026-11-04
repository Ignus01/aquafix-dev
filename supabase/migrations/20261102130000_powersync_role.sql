-- powersync_role — the database login PowerSync replicates with.
--
-- REPLICATION to read the WAL and BYPASSRLS so RLS doesn't hide rows from it:
-- powersync/sync-config.yaml, not RLS, decides what each phone receives. It
-- can read only the tables that config syncs. Add a table here, to the
-- publication (next migration) and to the sync config together.
--
-- Created NOLOGIN with no password, so no secret is in git and the migration
-- runs on a fresh database. Once per Supabase project, after `db push`, run
-- this in the SQL Editor with a strong password (kept in
-- powersync/powersync_role.local.sql, which git ignores):
--
--   alter role powersync_role with login password '<password>';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'powersync_role') then
    create role powersync_role with replication bypassrls nologin;
  end if;
end;
$$;

grant usage on schema public to powersync_role;

grant select on
  -- Per inspector: my_instructions, my_inspections
  public.instruction,
  public.instruction_asset_allocation,
  public.inspection_activity,
  public.inspection_value,
  public.inspection_image,
  -- Everyone who captures: reference_data
  public.asset,
  public.asset_type,
  public.location,
  public.grading,
  public.colour_container,
  public.inspection,
  public.inspection_drop_down_option,
  public.inspection_rule,
  public.feedback,
  public.inspection_allocation,
  public.quality_parameter,
  public.inspection_cumulative_value,
  -- Who may sync at all (every stream checks the user's role)
  public.user_masterdata_roles
to powersync_role;
