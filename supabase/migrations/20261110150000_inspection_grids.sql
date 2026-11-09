-- Grid redesign, phase 2 (docs/grid-redesign-plan.md): flat, security_invoker
-- views for the rest of the Inspections back office, so each tab loads one
-- page at a time. Joins are left joins: a row whose asset or location the
-- caller can't read (RLS) still shows, with that name blank, exactly as the
-- table itself would. Names come from grid_user_name() (null → 'System').

-- ============================================================================
-- inspection_activity_grid — Inspection_Overview → Inspection Activities.
-- ============================================================================
create view public.inspection_activity_grid
with (security_invoker = true)
as
select
  a.id,
  a.legacy_uid as uid,
  a.instruction_id,
  i.legacy_uid as instruction_uid,
  coalesce(i.name, 'Ad hoc') as instruction_name,
  a.asset_id,
  s.name as asset_name,
  s.asset_type_id,
  t.name as asset_type_name,
  s.location_id,
  l.name as location_name,
  a.inspection_date,
  a.created_by as inspected_by,
  case when a.created_by is null then null else public.grid_user_name(a.created_by) end as inspected_by_name,
  a.grading_id,
  g.name as grading_name,
  c.hex_colour as grading_colour,
  a.updated_at as changed_at,
  a.updated_by as changed_by,
  public.grid_user_name(a.updated_by) as changed_by_name
from public.inspection_activity a
left join public.instruction i on i.id = a.instruction_id
left join public.asset s on s.id = a.asset_id
left join public.asset_type t on t.id = s.asset_type_id
left join public.location l on l.id = s.location_id
left join public.grading g on g.id = a.grading_id
left join public.colour_container c on c.id = g.colour_container_id;

grant select on public.inspection_activity_grid to authenticated;

-- ============================================================================
-- inspection_value_grid — Inspection_Overview → Inspection Values.
-- inspection_value has no updated_by: Changed by is the activity's last
-- editor (values are only written through their activity, or by an admin's
-- value edit, which also touches the activity).
-- ============================================================================
create view public.inspection_value_grid
with (security_invoker = true)
as
select
  v.id,
  v.legacy_uid as uid,
  v.inspection_activity_id as activity_id,
  a.legacy_uid as activity_uid,
  a.inspection_date,
  s.name as asset_name,
  s.asset_type_id,
  t.name as asset_type_name,
  s.location_id,
  l.name as location_name,
  v.inspection_id,
  n.name as inspection_name,
  v.display_value,
  v.is_current,
  v.grading_id,
  g.name as grading_name,
  c.hex_colour as grading_colour,
  (select count(*) from public.inspection_image m where m.inspection_value_id = v.id)::integer as image_count,
  v.updated_at as changed_at,
  a.updated_by as changed_by,
  public.grid_user_name(a.updated_by) as changed_by_name
from public.inspection_value v
join public.inspection_activity a on a.id = v.inspection_activity_id
left join public.asset s on s.id = a.asset_id
left join public.asset_type t on t.id = s.asset_type_id
left join public.location l on l.id = s.location_id
left join public.inspection n on n.id = v.inspection_id
left join public.grading g on g.id = v.grading_id
left join public.colour_container c on c.id = g.colour_container_id;

grant select on public.inspection_value_grid to authenticated;

-- ============================================================================
-- inspection_cumulative_value_grid — Inspection_Overview → Cumulative Values.
-- ============================================================================
create view public.inspection_cumulative_value_grid
with (security_invoker = true)
as
select
  cv.id,
  cv.legacy_uid as uid,
  cv.asset_id,
  s.name as asset_name,
  s.asset_type_id,
  t.name as asset_type_name,
  s.location_id,
  l.name as location_name,
  cv.inspection_id,
  n.name as inspection_name,
  cv.latest_value,
  cv.updated_at as changed_at,
  cv.updated_by as changed_by,
  public.grid_user_name(cv.updated_by) as changed_by_name
from public.inspection_cumulative_value cv
left join public.asset s on s.id = cv.asset_id
left join public.asset_type t on t.id = s.asset_type_id
left join public.location l on l.id = s.location_id
left join public.inspection n on n.id = cv.inspection_id;

grant select on public.inspection_cumulative_value_grid to authenticated;

-- ============================================================================
-- scheduled_instruction_grid — Instructions → Scheduled Instructions.
-- ============================================================================
create view public.scheduled_instruction_grid
with (security_invoker = true)
as
select
  si.id,
  si.legacy_uid as uid,
  si.name,
  si.comment,
  si.account_id,
  case when si.account_id is null then null else public.grid_user_name(si.account_id) end as account_name,
  si.schedule_type,
  si.include_weekends,
  si.include_public_holidays,
  si.day_of_month,
  si.week_days,
  si.days_to_complete,
  (select count(*) from public.scheduled_instruction_asset sa where sa.scheduled_instruction_id = si.id)::integer
    as asset_count,
  si.active,
  si.updated_at as changed_at,
  si.updated_by as changed_by,
  public.grid_user_name(si.updated_by) as changed_by_name
from public.scheduled_instruction si;

grant select on public.scheduled_instruction_grid to authenticated;
