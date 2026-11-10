-- Home → Overview: the figures the Overview tab adds to home_dashboard().
--
-- Three functions, so the page can stream each part as it arrives:
--
--   overview_attention()  what needs someone now, whatever the period
--   overview_extras()     services, quality, billing and incident-closure
--                         figures for the period
--   overview_sites()      the site scorecard's columns that home_dashboard()
--                         doesn't have (water, lab quality, loggers, services)
--
-- All are security invoker: the caller's RLS applies. Figures a role may not
-- read come back null, and the page leaves them out:
--   water (daily usage)  system admins and admins
--   loggers (readings)   system admins
--   billing              system admins and admins
--
-- Thresholds are fixed here and returned with the figures, so the page's
-- labels can't drift from them.

-- Open services by due date, and incidents by the day they were closed.
create index if not exists service_open_due_idx on public.service (due_date) where not is_completed;
create index if not exists incident_completed_at_idx on public.incident (completed_at) where completed_at is not null;

-- ============================================================================
-- overview_water_sites — each site's treated water against its target and its
-- borehole usage against its limit, over a period
-- ============================================================================
-- Reads water_target_matrix() and water_borehole_matrix(), so a day counts
-- exactly as it does on the Water usage tab (a day has a figure only when
-- every meter has one). No rows for callers who may not read water usage.
--
--   target_pct      average daily usage as a % of the target
--   target_colour   the site's band for target_pct
--   target_days     days with a figure; target_days_on those in a band that
--                   isn't red or orange
--   borehole_pct    average daily usage as a % of the limit
--   borehole_days   days with a figure; borehole_days_over those above the limit
create function public.overview_water_sites(
  p_from date,
  p_to date,
  p_region_id uuid default null,
  p_organisation_id uuid default null,
  p_location_id uuid default null
)
returns table (
  location_id uuid,
  target_pct numeric,
  target_colour text,
  target_days integer,
  target_days_on integer,
  borehole_pct numeric,
  borehole_days integer,
  borehole_days_over integer
)
language plpgsql
stable
set search_path = public
as $$
begin
  if not public.has_masterdata_role(array['system_admin', 'admin']::public.masterdata_role[]) then
    return;
  end if;

  return query
  with t as (
    select (x ->> 'id')::uuid as id, (x ->> 'target')::numeric as target, x -> 'usage' as usage
    from jsonb_array_elements(
      public.water_target_matrix(p_from, p_to, p_region_id, p_organisation_id, p_location_id) -> 'locations') x
    where x ->> 'target' is not null
  ),
  td as (
    select t.id, t.target, (u.v #>> '{}')::numeric as usage
    from t
    cross join lateral jsonb_array_elements(t.usage) u(v)
    where jsonb_typeof(u.v) = 'number'
  ),
  ts as (
    select td.id,
           round(avg(td.usage) / max(td.target) * 100, 1) as pct,
           count(*)::integer as days,
           (count(*) filter (where coalesce(b.colour::text, '') not in ('red', 'orange')))::integer as days_on
    from td
    left join lateral (
      select lb.colour from public.location_target_band lb
      where lb.location_id = td.id and lb.from_pct <= td.usage / td.target * 100
      order by lb.from_pct desc limit 1
    ) b on true
    group by td.id
  ),
  bh as (
    select (x ->> 'id')::uuid as id, (x ->> 'limit')::numeric as lim, x -> 'usage' as usage
    from jsonb_array_elements(
      public.water_borehole_matrix(p_from, p_to, p_region_id, p_organisation_id, p_location_id) -> 'locations') x
    where x ->> 'limit' is not null
  ),
  bd as (
    select bh.id, bh.lim, (u.v #>> '{}')::numeric as usage
    from bh
    cross join lateral jsonb_array_elements(bh.usage) u(v)
    where jsonb_typeof(u.v) = 'number'
  ),
  bs as (
    select bd.id,
           round(avg(bd.usage) / max(bd.lim) * 100, 1) as pct,
           count(*)::integer as days,
           (count(*) filter (where bd.usage > bd.lim))::integer as days_over
    from bd
    group by bd.id
  )
  select coalesce(ts.id, bs.id),
         ts.pct,
         (select lb.colour::text from public.location_target_band lb
          where lb.location_id = ts.id and lb.from_pct <= ts.pct
          order by lb.from_pct desc limit 1),
         ts.days, ts.days_on,
         bs.pct, bs.days, bs.days_over
  from ts
  full join bs on bs.id = ts.id;
end;
$$;

revoke execute on function public.overview_water_sites(date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.overview_water_sites(date, date, uuid, uuid, uuid) to authenticated;

-- ============================================================================
-- overview_attention — what needs someone now
-- ============================================================================
-- Not tied to a period: an overdue service is overdue whatever range the page
-- shows. The region / organisation / site filters apply.
create function public.overview_attention(
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
  v_filtered boolean := p_region_id is not null or p_organisation_id is not null or p_location_id is not null;
  v_water boolean := public.has_masterdata_role(array['system_admin', 'admin']::public.masterdata_role[]);
  v_loggers boolean := public.has_masterdata_role(array['system_admin']::public.masterdata_role[]);
  v_billing boolean := public.is_billing_admin();
  -- An open incident is stale after this many days.
  v_incident_days constant integer := 14;
  -- An asset is uninspected after this many days without an inspection.
  v_inspection_days constant integer := 60;
  -- Water is judged over this many complete days.
  v_water_days constant integer := 7;
  -- As logger_dashboard(): a logger is silent after this long without a reading.
  v_silent_before timestamptz := now() - interval '48 hours';
  v_result jsonb;
begin
  if not public.is_inspection_reader() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  with loc as (
    select l.id, l.active and l.is_asset_manager as live
    from public.location l
    where (p_region_id is null or l.region_id = p_region_id)
      and (p_organisation_id is null or l.organisation_id = p_organisation_id)
      and (p_location_id is null or l.id = p_location_id)
  ),
  ast as (
    select a.id, a.asset_type_id, a.logger_code, a.active, loc.live
    from public.asset a
    join loc on loc.id = a.location_id
  ),
  water as (
    select w.* from public.overview_water_sites(
      v_today - v_water_days, v_today - 1, p_region_id, p_organisation_id, p_location_id) w
    where v_water
  )
  select jsonb_build_object(
    'thresholds', jsonb_build_object(
      'incident_days', v_incident_days, 'inspection_days', v_inspection_days,
      'water_days', v_water_days, 'logger_hours', 48),
    'overdue_instructions', (
      select count(*) from public.instruction n
      where n.status <> 'completed' and n.required_completed_date < v_today
        and (not v_filtered or exists (
          select 1 from public.instruction_asset_allocation x
          join ast on ast.id = x.asset_id
          where x.instruction_id = n.id))),
    'stale_incidents', (
      select count(*) from public.incident i
      join loc on loc.id = i.location_id
      where i.status <> 'completed'
        and i.incident_date < now() - make_interval(days => v_incident_days)),
    'services_overdue', (
      select count(*) from public.service s
      join ast on ast.id = s.asset_id
      where not s.is_completed and s.due_date < v_today::timestamp at time zone v_tz),
    -- Active assets on live sites whose type has inspections set up.
    'uninspected_assets', (
      select count(*) from ast
      where ast.active and ast.live
        and exists (select 1 from public.inspection_allocation al where al.asset_type_id = ast.asset_type_id)
        and not exists (
          select 1 from public.inspection_activity ia
          where ia.asset_id = ast.id
            and ia.inspection_date >= now() - make_interval(days => v_inspection_days))),
    -- Sites whose latest lab sample has a result outside its limits.
    'lab_out_sites', (
      select count(*)
      from (
        select distinct on (s.location_id) s.id
        from public.lab_sample s
        join loc on loc.id = s.location_id
        order by s.location_id, s.sampled_on desc, s.lab_no desc
      ) latest
      join public.lab_sample_overview o on o.id = latest.id
      where o.out_of_spec > 0),
    'borehole_over_sites', case when v_water then (select count(*) from water where borehole_pct > 100) end,
    'target_red_sites', case when v_water then (select count(*) from water where target_colour = 'red') end,
    'silent_loggers', case when v_loggers then (
      select count(*) from ast
      where ast.active and ast.logger_code is not null
        and (select max(r.reading_at) from public.logger_reading r where r.asset_id = ast.id) < v_silent_before) end,
    'draft_invoices', case when v_billing then (
      select count(*) from public.invoice v
      join loc on loc.id = v.location_id
      where v.status = 'draft') end
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.overview_attention(uuid, uuid, uuid) from public, anon;
grant execute on function public.overview_attention(uuid, uuid, uuid) to authenticated;

-- ============================================================================
-- overview_extras — period figures home_dashboard() doesn't have
-- ============================================================================
-- Same period, buckets and filters as home_dashboard(), so `series` lines up
-- with its series point for point.
--
-- Service spend is counted in the period a service was completed. A service
-- is on time when it was completed on or before its due day.
create function public.overview_extras(
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
  v_today_start timestamptz;
  v_bucket text;
  v_water boolean := public.has_masterdata_role(array['system_admin', 'admin']::public.masterdata_role[]);
  v_billing boolean := public.is_billing_admin();
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
  v_today_start := v_today::timestamp at time zone v_tz;
  v_bucket := case when v_days <= 31 then 'day' when v_days <= 200 then 'week' else 'month' end;

  with loc as (
    select l.id, l.name
    from public.location l
    where (p_region_id is null or l.region_id = p_region_id)
      and (p_organisation_id is null or l.organisation_id = p_organisation_id)
      and (p_location_id is null or l.id = p_location_id)
  ),
  svc as (
    select s.reference, s.service_type, s.due_date, s.is_completed, s.completed_date,
           s.total_part_cost, s.total_labour_cost, a.name as asset, loc.name as location
    from public.service s
    join public.asset a on a.id = s.asset_id
    join loc on loc.id = a.location_id
  ),
  done as (
    select * from svc where completed_date >= v_from and completed_date < v_to
  ),
  bk as (
    select b::date as b
    from generate_series(
      date_trunc(v_bucket, p_from::timestamp),
      date_trunc(v_bucket, p_to::timestamp),
      ('1 ' || v_bucket)::interval
    ) b
  ),
  s_svc as (
    select date_trunc(v_bucket, completed_date at time zone v_tz)::date as b,
           sum(total_part_cost) as parts, sum(total_labour_cost) as labour
    from done group by 1
  ),
  s_closed as (
    select date_trunc(v_bucket, i.completed_at at time zone v_tz)::date as b, count(*) as n
    from public.incident i
    join loc on loc.id = i.location_id
    where i.completed_at >= v_from and i.completed_at < v_to
    group by 1
  ),
  water as (
    select w.* from public.overview_water_sites(p_from, p_to, p_region_id, p_organisation_id, p_location_id) w
    where v_water
  ),
  lab as (
    select v.status
    from public.lab_sample s
    join loc on loc.id = s.location_id
    join public.lab_result_view v on v.sample_id = s.id
    where s.sampled_on between p_from and p_to
  ),
  run as (
    select r.id, r.period from public.billing_run r where v_billing order by r.period desc limit 1
  ),
  inv as (
    select v.status, v.amount, v.treated_usage
    from public.invoice v
    join run on run.id = v.billing_run_id
    join loc on loc.id = v.location_id
    where v.status <> 'void'
  )
  select jsonb_build_object(
    'services', jsonb_build_object(
      'overdue', (select count(*) from svc where not is_completed and due_date < v_today_start),
      'due_soon', (select count(*) from svc
                   where not is_completed and due_date >= v_today_start
                     and due_date < (v_today + 31)::timestamp at time zone v_tz),
      'completed', (select count(*) from done),
      'on_time', (select count(*) from done
                  where (completed_date at time zone v_tz)::date <= (due_date at time zone v_tz)::date),
      'parts', (select coalesce(sum(total_part_cost), 0) from done),
      'labour', (select coalesce(sum(total_labour_cost), 0) from done),
      'prev_spend', (select coalesce(sum(total_part_cost + total_labour_cost), 0) from svc
                     where completed_date >= v_prev_from and completed_date < v_from)),
    'series', (
      select jsonb_agg(jsonb_build_object(
          'bucket', bk.b, 'parts', coalesce(s.parts, 0), 'labour', coalesce(s.labour, 0),
          'closed', coalesce(c.n, 0))
        order by bk.b)
      from bk
      left join s_svc s on s.b = bk.b
      left join s_closed c on c.b = bk.b
    ),
    -- Open services already late or due within 30 days, soonest first.
    'service_queue', coalesce((
      select jsonb_agg(jsonb_build_object(
          'reference', reference, 'asset', asset, 'location', location,
          'service_type', service_type, 'due_date', (due_date at time zone v_tz)::date)
        order by due_date, reference)
      from (select * from svc
            where not is_completed and due_date < (v_today + 31)::timestamp at time zone v_tz
            order by due_date, reference limit 8) q
    ), '[]'::jsonb),
    'water', case when v_water then jsonb_build_object(
      'sites', (select count(*) from water where target_days > 0),
      'days', (select coalesce(sum(target_days), 0) from water),
      'days_on', (select coalesce(sum(target_days_on), 0) from water)) end,
    -- Lab results with limits, and how many are inside them.
    'quality', jsonb_build_object(
      'checked', (select count(*) from lab where status in ('ok', 'high', 'low')),
      'ok', (select count(*) from lab where status = 'ok')),
    'billing', case when v_billing then (
      select jsonb_build_object(
        'period', run.period,
        'invoices', (select count(*) from inv),
        'drafts', (select count(*) from inv where status = 'draft'),
        'amount', (select coalesce(sum(amount), 0) from inv),
        'usage', (select coalesce(sum(treated_usage), 0) from inv))
      from run) end,
    -- Names for the overdue instructions list.
    'assignees', coalesce((
      select jsonb_object_agg(a.account_id, public.grid_user_name(a.account_id))
      from (select distinct n.account_id from public.instruction n
            where n.status <> 'completed' and n.required_completed_date < v_today
              and n.account_id is not null) a
    ), '{}'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.overview_extras(date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.overview_extras(date, date, uuid, uuid, uuid) to authenticated;

-- ============================================================================
-- overview_sites — the scorecard columns home_dashboard().locations lacks
-- ============================================================================
-- One entry per active asset-manager site in scope, keyed by home_dashboard's
-- location id. `access` says which columns the caller may see.
--
--   services_overdue / services_due   open services late, or due within 30 days
--   target / borehole                 as overview_water_sites(), over the period
--   quality                           the site's latest lab sample up to p_to
--   loggers / loggers_silent          active loggers, and those whose latest
--                                     reading is over 48 h old (as the
--                                     Loggers tab's "silent")
create function public.overview_sites(
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
  v_today_start timestamptz;
  v_water boolean := public.has_masterdata_role(array['system_admin', 'admin']::public.masterdata_role[]);
  v_loggers boolean := public.has_masterdata_role(array['system_admin']::public.masterdata_role[]);
  v_silent_before timestamptz := now() - interval '48 hours';
  v_result jsonb;
begin
  if not public.is_inspection_reader() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid date range.' using errcode = '22023';
  end if;
  v_today_start := v_today::timestamp at time zone v_tz;

  with loc as (
    select l.id
    from public.location l
    where l.active and l.is_asset_manager
      and (p_region_id is null or l.region_id = p_region_id)
      and (p_organisation_id is null or l.organisation_id = p_organisation_id)
      and (p_location_id is null or l.id = p_location_id)
  ),
  svc as (
    select a.location_id,
           count(*) filter (where s.due_date < v_today_start) as overdue,
           count(*) filter (where s.due_date >= v_today_start
                              and s.due_date < (v_today + 31)::timestamp at time zone v_tz) as due
    from public.service s
    join public.asset a on a.id = s.asset_id
    join loc on loc.id = a.location_id
    where not s.is_completed
    group by a.location_id
  ),
  water as (
    select w.* from public.overview_water_sites(p_from, p_to, p_region_id, p_organisation_id, p_location_id) w
    where v_water
  ),
  latest as (
    select distinct on (s.location_id) s.location_id, s.id
    from public.lab_sample s
    join loc on loc.id = s.location_id
    where s.sampled_on <= p_to
    order by s.location_id, s.sampled_on desc, s.lab_no desc
  ),
  lab as (
    select latest.location_id, o.id, o.sampled_on, o.out_of_spec, o.inconclusive
    from latest
    join public.lab_sample_overview o on o.id = latest.id
  ),
  lg as (
    select a.location_id,
           count(*) as total,
           count(*) filter (where
             (select max(r.reading_at) from public.logger_reading r where r.asset_id = a.id) < v_silent_before) as silent
    from public.asset a
    join loc on loc.id = a.location_id
    where v_loggers and a.active and a.logger_code is not null
    group by a.location_id
  )
  select jsonb_build_object(
    'access', jsonb_build_object('water', v_water, 'loggers', v_loggers),
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', loc.id,
        'services_overdue', coalesce(svc.overdue, 0),
        'services_due', coalesce(svc.due, 0),
        'target', case when water.target_days > 0 then jsonb_build_object(
          'pct', water.target_pct, 'colour', water.target_colour,
          'days', water.target_days, 'days_on', water.target_days_on) end,
        'borehole', case when water.borehole_days > 0 then jsonb_build_object(
          'pct', water.borehole_pct, 'days', water.borehole_days, 'days_over', water.borehole_days_over) end,
        'quality', case when lab.id is not null then jsonb_build_object(
          'sample_id', lab.id, 'sampled_on', lab.sampled_on,
          'out_of_spec', lab.out_of_spec, 'inconclusive', lab.inconclusive) end,
        'loggers', lg.total,
        'loggers_silent', lg.silent))
      from loc
      left join svc on svc.location_id = loc.id
      left join water on water.location_id = loc.id
      left join lab on lab.location_id = loc.id
      left join lg on lg.location_id = loc.id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.overview_sites(date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.overview_sites(date, date, uuid, uuid, uuid) to authenticated;
