-- Logger report (Admin → Home → Loggers): every figure on the home page's
-- logger tab in one call, with the same period and region / organisation /
-- site filters as home_dashboard().
--
-- Security invoker: the logger tables are readable by system admins only
-- (RLS), and the function says so up front rather than returning zeros.
--
-- Loggers measure different things (kPa, m, l/s, …), so values are only ever
-- summarised per logger; across loggers the report counts readings, days and
-- pulls.
--
--   * Days with data: calendar days (app time zone) with at least one
--     reading, out of the days from the period start (or the logger's first
--     reading, if later) up to yesterday — today is still being pulled.
--   * Silent: an active logger with no reading in the last 48 hours. The daily
--     pull covers up to 06:00, so a healthy logger's latest reading is at most
--     ~24 hours old.
--   * Longest gap: the longest time between two consecutive readings in the
--     period.

-- The logger tables' RLS check ran once per row (has_masterdata_role() is a
-- function call); as an initplan it runs once per query. A report over a
-- few months reads tens of thousands of readings.
alter policy logger_pull_run_select on public.logger_pull_run
  using ((select public.has_masterdata_role(array['system_admin']::public.masterdata_role[])));
alter policy logger_pull_result_select on public.logger_pull_result
  using ((select public.has_masterdata_role(array['system_admin']::public.masterdata_role[])));
alter policy logger_reading_select on public.logger_reading
  using ((select public.has_masterdata_role(array['system_admin']::public.masterdata_role[])));

create function public.logger_dashboard(
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
  -- Days with data are counted up to here (inclusive).
  v_last_day date;
  v_silent_before timestamptz := now() - interval '48 hours';
  v_result jsonb;
begin
  if not public.has_masterdata_role(array['system_admin']::public.masterdata_role[]) then
    raise exception 'Only system admins can see logger data.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid date range.' using errcode = '22023';
  end if;

  v_days := p_to - p_from + 1;
  v_from := p_from::timestamp at time zone v_tz;
  v_to := (p_to + 1)::timestamp at time zone v_tz;
  v_prev_from := (p_from - v_days)::timestamp at time zone v_tz;
  v_bucket := case when v_days <= 31 then 'day' when v_days <= 200 then 'week' else 'month' end;
  v_last_day := least(p_to, v_today - 1);

  with lg as (
    -- Loggers in scope: assets with a logger code, and any asset (e.g. one
    -- whose logger was removed) with readings in the period.
    select a.id, a.name, a.code, a.logger_code, a.logger_type, a.active, l.name as location
    from public.asset a
    join public.location l on l.id = a.location_id
    where (p_region_id is null or l.region_id = p_region_id)
      and (p_organisation_id is null or l.organisation_id = p_organisation_id)
      and (p_location_id is null or l.id = p_location_id)
      and (
        a.logger_code is not null
        -- One pass over the period's readings, not a lookup per asset.
        or a.id in (
          select r.asset_id from public.logger_reading r
          where r.reading_at >= v_from and r.reading_at < v_to
        )
      )
  ),
  -- Readings in the current and previous period.
  rd as (
    select r.asset_id, r.reading_at, r.value, r.reading_at >= v_from as cur,
           (r.reading_at at time zone v_tz)::date as day
    from public.logger_reading r
    join lg on lg.id = r.asset_id
    where r.reading_at >= v_prev_from and r.reading_at < v_to
  ),
  cur as (
    select rd.*,
           reading_at - lag(reading_at) over (partition by asset_id order by reading_at) as gap
    from rd
    where rd.cur
  ),
  stats as (
    select asset_id,
           count(*) as readings,
           min(value) as min, max(value) as max, avg(value) as avg, stddev_samp(value) as stddev,
           count(*) filter (where value = 0) as zeros,
           count(distinct day) filter (where day <= v_last_day) as days_with_data,
           max(gap) as longest_gap
    from cur
    group by asset_id
  ),
  prev as (
    select asset_id, count(*) as readings, avg(value) as avg
    from rd
    where not rd.cur
    group by asset_id
  ),
  -- Each logger's first and latest reading ever, and its latest unit.
  edges as (
    select lg.id as asset_id, f.first_at, l.reading_at as last_at, l.value as last_value, u.unit
    from lg
    left join lateral (
      select r.reading_at as first_at from public.logger_reading r
      where r.asset_id = lg.id order by r.reading_at limit 1
    ) f on true
    left join lateral (
      select r.reading_at, r.value from public.logger_reading r
      where r.asset_id = lg.id order by r.reading_at desc limit 1
    ) l on true
    left join lateral (
      select r.unit from public.logger_reading r
      where r.asset_id = lg.id and r.unit is not null order by r.reading_at desc limit 1
    ) u on true
  ),
  -- This logger's part in every pull started in the period.
  pulls as (
    select res.asset_id, res.status, res.error, run.created_at
    from public.logger_pull_result res
    join public.logger_pull_run run on run.id = res.run_id
    join lg on lg.id = res.asset_id
    where run.created_at >= v_from and run.created_at < v_to
  ),
  pull_stats as (
    select asset_id,
           count(*) filter (where status = 'success') as succeeded,
           count(*) filter (where status = 'failed') as failed,
           (array_agg(error order by created_at desc) filter (where status = 'failed'))[1] as last_error
    from pulls
    group by asset_id
  ),
  bk as (
    select b::date as b
    from generate_series(
      date_trunc(v_bucket, p_from::timestamp),
      date_trunc(v_bucket, p_to::timestamp),
      ('1 ' || v_bucket)::interval
    ) b
  ),
  s_all as (
    select date_trunc(v_bucket, day::timestamp)::date as b,
           count(*) as readings, count(distinct asset_id) as loggers
    from cur
    group by 1
  ),
  s_lg as (
    select asset_id, date_trunc(v_bucket, day::timestamp)::date as b, avg(value) as avg
    from cur
    group by 1, 2
  ),
  -- Each logger's average per bucket, null where it sent nothing.
  lg_series as (
    select lg.id as asset_id, jsonb_agg(sl.avg order by bk.b) as series
    from lg
    cross join bk
    left join s_lg sl on sl.asset_id = lg.id and sl.b = bk.b
    group by lg.id
  ),
  lgr as (
    select lg.*, e.unit, e.first_at, e.last_at, e.last_value,
           coalesce(s.readings, 0) as readings, s.min, s.max, s.avg, s.stddev,
           coalesce(s.zeros, 0) as zeros,
           coalesce(s.days_with_data, 0) as days_with_data,
           greatest(0, v_last_day - greatest(p_from, (e.first_at at time zone v_tz)::date) + 1) as days_expected,
           extract(epoch from s.longest_gap) / 3600.0 as longest_gap_hours,
           coalesce(p.readings, 0) as prev_readings, p.avg as prev_avg,
           coalesce(ps.succeeded, 0) as pulls_succeeded, coalesce(ps.failed, 0) as pulls_failed,
           ps.last_error, ls.series,
           case
             when not lg.active or lg.logger_code is null then 'inactive'
             when e.last_at is null then 'never'
             when e.last_at < v_silent_before then 'silent'
             else 'ok'
           end as status
    from lg
    join edges e on e.asset_id = lg.id
    left join stats s on s.asset_id = lg.id
    left join prev p on p.asset_id = lg.id
    left join pull_stats ps on ps.asset_id = lg.id
    join lg_series ls on ls.asset_id = lg.id
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'from', p_from, 'to', p_to, 'days', v_days,
      'prev_from', p_from - v_days, 'prev_to', p_from - 1,
      'bucket', v_bucket, 'today', v_today, 'time_zone', v_tz, 'last_day', v_last_day),
    'scope', jsonb_build_object(
      'loggers', (select count(*) from lgr where status <> 'inactive'),
      'reporting', (select count(*) from lgr where readings > 0),
      'ok', (select count(*) from lgr where status = 'ok'),
      'silent', (select count(*) from lgr where status = 'silent'),
      'never', (select count(*) from lgr where status = 'never')),
    'readings', jsonb_build_object(
      'count', (select coalesce(sum(readings), 0) from lgr),
      'prev', (select coalesce(sum(prev_readings), 0) from lgr),
      'days_with_data', (select coalesce(sum(days_with_data), 0) from lgr where status <> 'inactive'),
      'days_expected', (select coalesce(sum(days_expected), 0) from lgr where status <> 'inactive')),
    'pulls', jsonb_build_object(
      'succeeded', (select count(*) from pulls where status = 'success'),
      'failed', (select count(*) from pulls where status = 'failed'),
      'pending', (select count(*) from pulls where status in ('pending', 'running')),
      'loggers_failed', (select count(distinct asset_id) from pulls where status = 'failed')),
    -- The latest daily run, whatever the filters: is the schedule running?
    'latest_run', (
      select jsonb_build_object(
          'id', o.id, 'created_at', o.created_at, 'range_end', o.range_end, 'status', o.status,
          'loggers', o.loggers, 'succeeded', o.succeeded, 'failed', o.failed,
          'readings_saved', o.readings_saved)
      from public.logger_pull_run_overview o
      where o.trigger = 'cron'
      order by o.range_end desc
      limit 1
    ),
    'series', (
      select jsonb_agg(jsonb_build_object(
          'bucket', bk.b, 'readings', coalesce(s.readings, 0), 'loggers', coalesce(s.loggers, 0))
        order by bk.b)
      from bk
      left join s_all s on s.b = bk.b
    ),
    'loggers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.id, 'name', r.name, 'code', r.code, 'logger_code', r.logger_code,
          'logger_type', r.logger_type, 'location', r.location, 'status', r.status, 'unit', r.unit,
          'first_at', r.first_at, 'last_at', r.last_at, 'last_value', r.last_value,
          'readings', r.readings, 'min', r.min, 'max', r.max, 'avg', r.avg, 'stddev', r.stddev,
          'zeros', r.zeros, 'days_with_data', r.days_with_data, 'days_expected', r.days_expected,
          'longest_gap_hours', r.longest_gap_hours,
          'prev_readings', r.prev_readings, 'prev_avg', r.prev_avg,
          'pulls_succeeded', r.pulls_succeeded, 'pulls_failed', r.pulls_failed, 'last_error', r.last_error,
          'series', r.series)
        order by r.name)
      from lgr r
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.logger_dashboard(date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.logger_dashboard(date, date, uuid, uuid, uuid) to authenticated;
