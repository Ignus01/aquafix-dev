-- Grid redesign, phase 3.1 (docs/grid-redesign-plan.md): Incidents
-- (Incident_Overview / Incident_Overview_PWA) read one page at a time from a
-- flat, security_invoker view, so incident RLS still decides what a caller
-- sees. Names come from grid_user_name() (null → 'System').

create view public.incident_grid
with (security_invoker = true)
as
select
  i.id,
  i.reference,
  i.incident_type_id,
  t.name as incident_type_name,
  t.disables_location,
  i.location_id,
  l.name as location_name,
  i.comment,
  -- Only photos on the incident itself (note photos hang off the note).
  (select count(*)::integer from public.incident_image im where im.incident_id = i.id) as image_count,
  (select count(*)::integer from public.incident_note n where n.incident_id = i.id) as note_count,
  i.status,
  i.incident_date,
  i.completed_at,
  i.created_at,
  i.created_by,
  case when i.created_by is null then null else public.grid_user_name(i.created_by) end as created_by_name,
  i.updated_at as changed_at,
  i.updated_by as changed_by,
  public.grid_user_name(i.updated_by) as changed_by_name
from public.incident i
left join public.incident_type t on t.id = i.incident_type_id
left join public.location l on l.id = i.location_id;

grant select on public.incident_grid to authenticated;
