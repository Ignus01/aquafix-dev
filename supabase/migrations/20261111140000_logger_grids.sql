-- Grid redesign, phase 3.3 (docs/grid-redesign-plan.md): Admin → Logger
-- Data's readings and run log read one page at a time from flat,
-- security_invoker views, so the logger tables' RLS (system admins) still
-- decides what a caller sees.

-- ============================================================================
-- logger_reading_grid — the readings. logger_reading has no updated_at (a
-- re-pull overwrites a reading in place, and nobody edits one), so this grid
-- has no Changed / Changed by: it sorts by reading time
-- (logger_reading_time_idx) and counts by estimate until filtered.
-- ============================================================================
create view public.logger_reading_grid
with (security_invoker = true)
as
select
  r.id,
  r.reading_at,
  r.asset_id,
  a.name as asset_name,
  a.code as asset_code,
  a.location_id,
  l.name as location_name,
  r.logger_type,
  r.logger_code,
  r.value,
  r.unit,
  r.run_id,
  r.pulled_at
from public.logger_reading r
left join public.asset a on a.id = r.asset_id
left join public.location l on l.id = a.location_id;

grant select on public.logger_reading_grid to authenticated;

-- ============================================================================
-- logger_pull_run_grid — the run log. A run is never edited: Changed is when
-- it last moved (finished, else started), Changed by whoever asked for it
-- (null for the daily cron run: 'System').
-- ============================================================================
create view public.logger_pull_run_grid
with (security_invoker = true)
as
select
  r.id,
  r.trigger,
  r.logger_type,
  r.range_start,
  r.range_end,
  cardinality(r.asset_ids) as asset_count,
  r.created_at,
  r.finished_at,
  r.loggers,
  r.pending,
  r.succeeded,
  r.failed,
  r.readings_saved,
  r.status,
  coalesce(r.finished_at, r.created_at) as changed_at,
  r.requested_by as changed_by,
  public.grid_user_name(r.requested_by) as changed_by_name
from public.logger_pull_run_overview r;

grant select on public.logger_pull_run_grid to authenticated;
