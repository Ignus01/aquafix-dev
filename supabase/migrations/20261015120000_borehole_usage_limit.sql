-- Borehole usage limit and the Borehole usage vs limit matrix (Admin → Home
-- → Water usage).
--
-- Boreholes are licensed for a set abstraction volume. Each Borehole Meter
-- gets a daily usage limit in m³; a location's borehole usage on a day is
-- the sum of its Borehole Meters' daily usage (logger_daily_usage), compared
-- with the sum of their limits. Mirrors water_target_matrix() in
-- 20261014120000_volume_target.sql.

-- ============================================================================
-- Column
-- ============================================================================
-- m³ (= kL) a borehole may abstract per day; only on Borehole Meters. "is
-- not distinct from" so an untyped meter (null) can't keep a limit either.
alter table public.asset
  add column usage_limit numeric(12, 2),
  add constraint asset_usage_limit_check check (
    usage_limit is null or (usage_limit > 0 and meter_type is not distinct from 'borehole'));

-- ============================================================================
-- water_borehole_matrix — borehole usage per location per day
-- ============================================================================
-- Same period, filters, access and day range as water_target_matrix(): days
-- run from p_from to the earlier of p_to and yesterday.
--
-- One entry per active location in scope with a Borehole Meter (an inactive
-- one counts only on the days it has a figure). A day's usage is the sum of
-- its borehole meters' usage; if any of them has no figure (no row, or a
-- reset) the day has none, since a partial sum would read as under the
-- limit. The location's limit is the sum of its counted meters' limits, or
-- null when any of them has none. status as in water_target_matrix().
create function public.water_borehole_matrix(
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
  v_last date;
  v_result jsonb;
begin
  if not public.has_masterdata_role(array['system_admin', 'admin']::public.masterdata_role[]) then
    raise exception 'Only system admins and admins can see water usage.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid date range.' using errcode = '22023';
  end if;
  v_last := least(p_to, public.app_today() - 1);

  with days as (
    -- Empty when the whole period is today or later.
    select g::date as day from generate_series(p_from, v_last, interval '1 day') g
  ),
  meters as (
    select a.id, a.name, a.active, a.location_id, a.usage_limit
    from public.asset a
    join public.location l on l.id = a.location_id
    where a.meter_type = 'borehole'
      and l.active
      and (p_region_id is null or l.region_id = p_region_id)
      and (p_organisation_id is null or l.organisation_id = p_organisation_id)
      and (p_location_id is null or l.id = p_location_id)
      and (a.active or exists (
        select 1 from public.logger_daily_usage u where u.asset_id = a.id and u.day between p_from and v_last))
  ),
  cells as (
    select m.location_id, d.day,
           count(*) filter (where m.active or u.asset_id is not null) as meters,
           count(u.usage) as known,
           sum(u.usage) as usage,
           bool_or(u.status = 'reset') as reset,
           bool_or(u.status = 'long_gap') as long_gap,
           bool_or(u.status = 'estimated') as estimated
    from meters m
    cross join days d
    left join public.logger_daily_usage u on u.asset_id = m.id and u.day = d.day
    group by m.location_id, d.day
  ),
  series as (
    select c.location_id,
           jsonb_agg(case when c.meters > 0 and c.known = c.meters then c.usage end order by c.day) as usage,
           string_agg(
             case
               when c.meters > 0 and c.known = c.meters then
                 case when c.long_gap then 'g' when c.estimated then 'e' else 'o' end
               when c.reset then 'r'
               else '-'
             end, '' order by c.day) as status
    from cells c
    group by c.location_id
  )
  select jsonb_build_object(
    'days', coalesce((select jsonb_agg(d.day order by d.day) from days d), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', l.id, 'name', l.name, 'region', rg.name,
          'limit', case when mm.unlimited = 0 then mm.total end,
          'meters', mm.n, 'meter_ids', mm.ids, 'unlimited', mm.unlimited,
          'usage', coalesce(s.usage, '[]'::jsonb), 'status', coalesce(s.status, ''))
        order by l.name)
      from public.location l
      join public.region rg on rg.id = l.region_id
      join lateral (
        select count(*) as n, jsonb_agg(m.id order by m.name) as ids,
               count(*) filter (where m.usage_limit is null) as unlimited,
               sum(m.usage_limit) as total
        from meters m where m.location_id = l.id
      ) mm on mm.n > 0
      left join series s on s.location_id = l.id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.water_borehole_matrix(date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.water_borehole_matrix(date, date, uuid, uuid, uuid) to authenticated;
