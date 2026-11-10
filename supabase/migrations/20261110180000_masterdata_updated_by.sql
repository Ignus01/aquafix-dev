-- Master data and inspection setup record who last changed a row.
--
-- These tables have had updated_by since they were created, but nothing set
-- it (only updated_at, through set_updated_at), so the grids' Changed by
-- column (docs/grid-redesign-plan.md) would show "System" for every edit.
-- Same rule as the stock, incident and quality audit triggers: the signed-in
-- user, or the value the writer gave when there is none (system writes).

create function public.set_updated_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

revoke execute on function public.set_updated_by() from public, anon, authenticated;

create trigger region_set_updated_by
  before insert or update on public.region
  for each row execute function public.set_updated_by();

create trigger organisation_set_updated_by
  before insert or update on public.organisation
  for each row execute function public.set_updated_by();

create trigger asset_type_set_updated_by
  before insert or update on public.asset_type
  for each row execute function public.set_updated_by();

create trigger location_set_updated_by
  before insert or update on public.location
  for each row execute function public.set_updated_by();

create trigger grading_set_updated_by
  before insert or update on public.grading
  for each row execute function public.set_updated_by();

create trigger asset_set_updated_by
  before insert or update on public.asset
  for each row execute function public.set_updated_by();

create trigger inspection_set_updated_by
  before insert or update on public.inspection
  for each row execute function public.set_updated_by();

create trigger incident_type_set_updated_by
  before insert or update on public.incident_type
  for each row execute function public.set_updated_by();
