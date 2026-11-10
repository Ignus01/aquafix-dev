-- Grid redesign, phase 3.4 (docs/grid-redesign-plan.md): Quality → Lab
-- Results' samples and imports read one page at a time from flat,
-- security_invoker views, so the lab tables' RLS still decides what a caller
-- sees. Names come from grid_user_name() (null → 'System').

-- ============================================================================
-- lab_sample_grid — the samples. A sample is written once, by its import, and
-- never edited (a re-import replaces it): Changed is the import's
-- imported_at, Changed by who imported it.
-- ============================================================================
create view public.lab_sample_grid
with (security_invoker = true)
as
select
  o.id,
  o.lab_no,
  o.sampled_on,
  o.location_id,
  o.location_name,
  o.region_id,
  r.name as region_name,
  o.organisation_id,
  g.name as organisation_name,
  o.lab_id,
  o.lab_name,
  o.lab_locality,
  o.batch_no,
  o.client_name,
  o.sample_type,
  o.import_id,
  o.file_name,
  o.results,
  o.out_of_spec,
  o.inconclusive,
  o.out_of_spec_names,
  o.imported_at as changed_at,
  o.imported_by as changed_by,
  public.grid_user_name(o.imported_by) as changed_by_name
from public.lab_sample_overview o
left join public.region r on r.id = o.region_id
left join public.organisation g on g.id = o.organisation_id;

grant select on public.lab_sample_grid to authenticated;

-- ============================================================================
-- lab_import_grid — the imported files. lab_import has no updated_at:
-- Changed is when it was imported (else uploaded), Changed by who did that.
-- ============================================================================
create view public.lab_import_grid
with (security_invoker = true)
as
select
  i.id,
  i.file_name,
  i.lab_id,
  i.lab_name,
  i.batch_no,
  i.client_name,
  i.status,
  i.samples_imported,
  i.samples_skipped,
  i.created_at,
  i.imported_at,
  coalesce(i.imported_at, i.created_at) as changed_at,
  case when i.imported_at is not null then i.imported_by else i.created_by end as changed_by,
  public.grid_user_name(case when i.imported_at is not null then i.imported_by else i.created_by end) as changed_by_name
from public.lab_import i;

grant select on public.lab_import_grid to authenticated;
