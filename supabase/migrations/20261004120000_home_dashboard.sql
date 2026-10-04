-- Home dashboard (Admin → Home): every figure on the landing page in one call,
-- modelled on the AquaFix Power BI "Overview" page and the board report.
--
-- Security invoker, so the caller's RLS applies as it does on the section
-- pages (e.g. a field user only counts the instructions assigned to them).
--
-- Grading bands come from the grading's colour container — the colours the app
-- already shows on every grading badge: green → good, yellow → fair,
-- orange → warning, red → critical. "Needs attention" = warning + critical.
-- A grading whose colour isn't one of the four has no band (shown in the mix,
-- never counted as attention).

-- Activities are read by date range across all assets.
create index inspection_activity_inspection_date_idx on public.inspection_activity (inspection_date);

create function public.grading_band(p_colour_container_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when c.class_name ilike '%green%' or c.name ilike '%green%' then 'good'
    when c.class_name ilike '%yellow%' or c.name ilike '%yellow%' then 'fair'
    when c.class_name ilike '%orange%' or c.name ilike '%orange%' then 'warning'
    when c.class_name ilike '%red%' or c.name ilike '%red%' then 'critical'
  end
  from public.colour_container c
  where c.id = p_colour_container_id;
$$;

revoke execute on function public.grading_band(uuid) from public, anon;
grant execute on function public.grading_band(uuid) to authenticated;

-- p_from / p_to: inclusive calendar days in the app time zone. The previous
-- period is the same number of days immediately before p_from. Filters are
-- optional and combine (region AND organisation AND location).
create function public.home_dashboard(
  p_from date,
  p_to date,
  p_region_id uuid default null,
  p_organisation_id uuid default null,
  p_location_id uuid default null
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_tz text := public.app_time_zone();
  v_today date := public.app_today();
  v_days integer;
  v_from timestamptz;
  v_to timestamptz;
  v_prev_from timestamptz;
  v_bucket text;
  v_filtered boolean := p_region_id is not null or p_organisation_id is not null or p_location_id is not null;
  v_result jsonb;
begin
  if not public.is_inspection_reader() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid date range.' using errcode = '22023';
  end if;

  v_days := p_to - p_from + 1;
  v_from := p_from::timestamp at time zone v_tz;
  v_to := (p_to + 1)::timestamp at time zone v_tz;
  v_prev_from := (p_from - v_days)::timestamp at time zone v_tz;
  -- Roughly 5–30 points whatever the range.
  v_bucket := case when v_days <= 31 then 'day' when v_days <= 200 then 'week' else 'month' end;

  with loc as (
    select l.id, l.name, l.active, l.is_asset_manager, r.name as region, o.name as organisation
    from public.location l
    join public.region r on r.id = l.region_id
    join public.organisation o on o.id = l.organisation_id
    where (p_region_id is null or l.region_id = p_region_id)
      and (p_organisation_id is null or l.organisation_id = p_organisation_id)
      and (p_location_id is null or l.id = p_location_id)
  ),
  ast as (
    select a.id, a.location_id, a.active
    from public.asset a
    join loc on loc.id = a.location_id
  ),
  grd as (
    select g.id, g.name, g.priority, c.hex_colour, public.grading_band(g.colour_container_id) as band
    from public.grading g
    left join public.colour_container c on c.id = g.colour_container_id
  ),
  -- Activities in the current and previous period.
  act as (
    select ia.id, ia.asset_id, ast.location_id, ia.inspection_date, ia.created_by,
           ia.inspection_date >= v_from as cur,
           grd.band in ('warning', 'critical') as attention
    from public.inspection_activity ia
    join ast on ast.id = ia.asset_id
    left join grd on grd.id = ia.grading_id
    where ia.inspection_date >= v_prev_from and ia.inspection_date < v_to
  ),
  -- Graded readings (current attempts only) in the current and previous period.
  val as (
    select act.location_id, act.inspection_date, act.cur, grd.id as grading_id, grd.band,
           grd.band in ('warning', 'critical') as attention
    from public.inspection_value v
    join act on act.id = v.inspection_activity_id
    join grd on grd.id = v.grading_id
    where v.is_current
  ),
  -- Each active asset's latest inspection (up to the end of the period) and
  -- its grading: "where things stand now".
  latest as (
    select distinct on (ia.asset_id) ia.asset_id, ast.location_id, ia.inspection_date, ia.grading_id
    from public.inspection_activity ia
    join ast on ast.id = ia.asset_id and ast.active
    where ia.inspection_date < v_to
    order by ia.asset_id, ia.inspection_date desc
  ),
  latest_g as (
    select latest.*, grd.name, grd.priority, grd.hex_colour, grd.band,
           grd.band in ('warning', 'critical') as attention
    from latest
    left join grd on grd.id = latest.grading_id
  ),
  inc as (
    select i.id, i.reference, i.status, i.incident_date, i.completed_at, i.comment, i.location_id,
           loc.name as location, t.name as type,
           i.incident_date >= v_from and i.incident_date < v_to as cur,
           i.incident_date >= v_prev_from and i.incident_date < v_from as prev
    from public.incident i
    join loc on loc.id = i.location_id
    join public.incident_type t on t.id = i.incident_type_id
  ),
  ins as (
    select n.id, n.legacy_uid, n.name, n.status, n.required_completed_date, n.nr_completed,
           n.nr_of_allocations, n.account_id
    from public.instruction n
    where not v_filtered
       or exists (
         select 1 from public.instruction_asset_allocation x
         join ast on ast.id = x.asset_id
         where x.instruction_id = n.id
       )
  ),
  bk as (
    select b::date as b
    from generate_series(
      date_trunc(v_bucket, p_from::timestamp),
      date_trunc(v_bucket, p_to::timestamp),
      ('1 ' || v_bucket)::interval
    ) b
  ),
  s_act as (
    select date_trunc(v_bucket, inspection_date at time zone v_tz)::date as b,
           count(*) as n, count(*) filter (where attention) as attention
    from act where cur group by 1
  ),
  s_val as (
    select date_trunc(v_bucket, inspection_date at time zone v_tz)::date as b,
           count(*) filter (where band = 'good') as good,
           count(*) filter (where band = 'fair') as fair,
           count(*) filter (where band = 'warning') as warning,
           count(*) filter (where band = 'critical') as critical,
           count(*) filter (where band is null) as other
    from val where cur group by 1
  ),
  s_inc as (
    select date_trunc(v_bucket, incident_date at time zone v_tz)::date as b, count(*) as n
    from inc where cur group by 1
  ),
  s_ins as (
    select date_trunc(v_bucket, required_completed_date::timestamp)::date as b,
           count(*) as due, count(*) filter (where status = 'completed') as completed
    from ins where required_completed_date between p_from and p_to group by 1
  ),
  resolved as (
    select extract(epoch from completed_at - incident_date) / 86400.0 as days
    from inc
    where completed_at >= v_from and completed_at < v_to
  ),
  loc_rows as (
    select loc.id, loc.name, loc.region, loc.organisation,
      (select count(*) from ast where ast.location_id = loc.id and ast.active) as assets,
      (select count(*) from act where act.location_id = loc.id and act.cur) as inspections,
      (select count(distinct act.asset_id) from act where act.location_id = loc.id and act.cur) as assets_inspected,
      (select max(l.inspection_date) from latest l where l.location_id = loc.id) as last_inspection,
      (select count(*) from val where val.location_id = loc.id and val.cur) as graded,
      (select count(*) from val where val.location_id = loc.id and val.cur and val.attention) as attention,
      (select count(*) from latest_g lg where lg.location_id = loc.id and lg.attention) as attention_assets,
      (select count(*) from inc where inc.location_id = loc.id and inc.cur) as incidents,
      (select count(*) from inc where inc.location_id = loc.id and inc.status <> 'completed') as open_incidents,
      (select jsonb_build_object('name', lg.name, 'colour', lg.hex_colour, 'band', lg.band)
         from latest_g lg where lg.location_id = loc.id and lg.name is not null
         order by lg.priority desc limit 1) as grading
    from loc
    where loc.active and loc.is_asset_manager
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'from', p_from, 'to', p_to, 'days', v_days,
      'prev_from', p_from - v_days, 'prev_to', p_from - 1,
      'bucket', v_bucket, 'today', v_today, 'time_zone', v_tz),
    'scope', jsonb_build_object(
      'sites', (select count(*) from loc where active and is_asset_manager),
      'assets', (select count(*) from ast where active)),
    'inspections', jsonb_build_object(
      'count', (select count(*) from act where cur),
      'prev', (select count(*) from act where not cur),
      'assets_inspected', (select count(distinct asset_id) from act where cur),
      'inspectors', (select count(distinct created_by) from act where cur)),
    'readings', jsonb_build_object(
      'graded', (select count(*) from val where cur),
      'attention', (select count(*) from val where cur and attention),
      'prev_graded', (select count(*) from val where not cur),
      'prev_attention', (select count(*) from val where not cur and attention),
      'assets_graded', (select count(*) from latest_g where name is not null),
      'assets_attention', (select count(*) from latest_g where attention)),
    'incidents', jsonb_build_object(
      'logged', (select count(*) from inc where cur),
      'prev_logged', (select count(*) from inc where prev),
      'open', (select count(*) from inc where status <> 'completed'),
      'open_new', (select count(*) from inc where status = 'new'),
      'open_in_progress', (select count(*) from inc where status = 'in_progress'),
      'resolved', (select count(*) from resolved),
      'median_days', (select percentile_cont(0.5) within group (order by days) from resolved),
      'p90_days', (select percentile_cont(0.9) within group (order by days) from resolved)),
    'instructions', jsonb_build_object(
      'due', (select count(*) from ins where required_completed_date between p_from and p_to),
      'due_completed', (select count(*) from ins where required_completed_date between p_from and p_to and status = 'completed'),
      'open', (select count(*) from ins where status <> 'completed'),
      'overdue', (select count(*) from ins where status <> 'completed' and required_completed_date < v_today)),
    'gradings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', grd.id, 'name', grd.name, 'priority', grd.priority, 'colour', grd.hex_colour,
          'band', grd.band, 'count', c.n)
        order by grd.priority, grd.name)
      from grd
      join (select grading_id, count(*) as n from val where cur group by 1) c on c.grading_id = grd.id
    ), '[]'::jsonb),
    'series', (
      select jsonb_agg(jsonb_build_object(
          'bucket', bk.b,
          'inspections', coalesce(a.n, 0), 'attention_inspections', coalesce(a.attention, 0),
          'good', coalesce(v.good, 0), 'fair', coalesce(v.fair, 0), 'warning', coalesce(v.warning, 0),
          'critical', coalesce(v.critical, 0), 'other', coalesce(v.other, 0),
          'incidents', coalesce(i.n, 0),
          'due', coalesce(d.due, 0), 'due_completed', coalesce(d.completed, 0))
        order by bk.b)
      from bk
      left join s_act a on a.b = bk.b
      left join s_val v on v.b = bk.b
      left join s_inc i on i.b = bk.b
      left join s_ins d on d.b = bk.b
    ),
    'incident_types', coalesce((
      select jsonb_agg(jsonb_build_object('name', type, 'count', n) order by n desc, type)
      from (select type, count(*) as n from inc where cur group by type) t
    ), '[]'::jsonb),
    'incident_status', jsonb_build_object(
      'new', (select count(*) from inc where cur and status = 'new'),
      'in_progress', (select count(*) from inc where cur and status = 'in_progress'),
      'completed', (select count(*) from inc where cur and status = 'completed')),
    'inspectors', coalesce((
      select jsonb_agg(jsonb_build_object('id', created_by, 'count', n) order by n desc)
      from (select created_by, count(*) as n from act where cur and created_by is not null
            group by created_by order by n desc limit 6) t
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(to_jsonb(loc_rows) order by loc_rows.name) from loc_rows
    ), '[]'::jsonb),
    'open_incidents', coalesce((
      select jsonb_agg(jsonb_build_object(
          'reference', reference, 'location', location, 'type', type, 'status', status,
          'incident_date', incident_date, 'comment', left(comment, 160))
        order by incident_date)
      from (select * from inc where status <> 'completed' order by incident_date limit 8) t
    ), '[]'::jsonb),
    'overdue_instructions', coalesce((
      select jsonb_agg(jsonb_build_object(
          'legacy_uid', legacy_uid, 'name', name, 'status', status,
          'required_completed_date', required_completed_date,
          'nr_completed', nr_completed, 'nr_of_allocations', nr_of_allocations,
          'account_id', account_id)
        order by required_completed_date, legacy_uid)
      from (select * from ins where status <> 'completed' and required_completed_date < v_today
            order by required_completed_date, legacy_uid limit 8) t
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.home_dashboard(date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.home_dashboard(date, date, uuid, uuid, uuid) to authenticated;
