-- Grid redesign, phase 3.2 (docs/grid-redesign-plan.md): Services
-- (Service_Overview, and Service_Overview_PWA as the Open tab) read one page
-- at a time from a flat, security_invoker view, so service RLS still decides
-- what a caller sees. Names come from grid_user_name() (null → 'System').

create view public.service_grid
with (security_invoker = true)
as
select
  s.id,
  s.reference,
  s.asset_id,
  a.code as asset_code,
  a.name as asset_name,
  s.due_date,
  s.service_type,
  s.is_completed,
  s.completed_date,
  s.supplier_id,
  o.name as supplier_name,
  s.performed_by,
  s.invoice_nr,
  s.total_part_cost,
  s.total_labour_cost,
  s.total_cost,
  s.comment,
  s.updated_at as changed_at,
  s.updated_by as changed_by,
  public.grid_user_name(s.updated_by) as changed_by_name
from public.service s
left join public.asset a on a.id = s.asset_id
left join public.organisation o on o.id = s.supplier_id;

grant select on public.service_grid to authenticated;
