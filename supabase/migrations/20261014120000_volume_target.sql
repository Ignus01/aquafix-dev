-- Location volume target and the Treated water vs target matrix (Admin →
-- Home → Water usage).
--
-- Each location gets a daily treated-water target in m³ and its own colour
-- bands (e.g. ≥ 110% blue, 90–110% green, 80–90% orange, < 80% red). Each
-- asset gets a meter type; a location's treated water on a day is the sum of
-- its Treated Meters' daily usage (logger_daily_usage). Borehole and Other
-- meters are left out: they often measure the same water before treatment.
--
-- Admins now see the whole Water usage tab too, so the daily usage and its
-- issues become readable by admins. Raw readings (logger_reading) stay
-- system-admin only.

-- ============================================================================
-- Types and columns
-- ============================================================================
create type public.meter_type as enum ('treated', 'borehole', 'other');
create type public.target_band_colour as enum ('blue', 'green', 'orange', 'red', 'grey');

-- m³ (= kL) of treated water the location should put through per day.
alter table public.location
  add column volume_target numeric(12, 2),
  add constraint location_volume_target_check check (volume_target is null or volume_target > 0);

-- What the asset's volume meter measures; null = not a meter.
alter table public.asset add column meter_type public.meter_type;

-- ============================================================================
-- location_target_band — the colour bands of one location
-- ============================================================================
-- A band covers from_pct (inclusive) up to the next band's from_pct. A
-- location with a target has a band at 0% (save_location_target checks), so
-- every value lands in a band.
create table public.location_target_band (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.location (id) on delete cascade,
  from_pct numeric(6, 2) not null,
  colour public.target_band_colour not null,
  label text,
  constraint location_target_band_from_pct_check check (from_pct >= 0),
  constraint location_target_band_label_not_blank check (label is null or btrim(label) <> ''),
  constraint location_target_band_location_from_key unique (location_id, from_pct)
);

alter table public.location_target_band enable row level security;

-- As location: system_admin, admin and user write, viewer reads. Users may
-- also delete bands (unlike locations), since editing a location's bands
-- replaces them.
create policy location_target_band_select on public.location_target_band for select
  to authenticated
  using ((select public.has_masterdata_role(array['system_admin', 'admin', 'user', 'viewer']::public.masterdata_role[])));
create policy location_target_band_insert on public.location_target_band for insert
  to authenticated
  with check ((select public.has_masterdata_role(array['system_admin', 'admin', 'user']::public.masterdata_role[])));
create policy location_target_band_update on public.location_target_band for update
  to authenticated
  using ((select public.has_masterdata_role(array['system_admin', 'admin', 'user']::public.masterdata_role[])))
  with check ((select public.has_masterdata_role(array['system_admin', 'admin', 'user']::public.masterdata_role[])));
create policy location_target_band_delete on public.location_target_band for delete
  to authenticated
  using ((select public.has_masterdata_role(array['system_admin', 'admin', 'user']::public.masterdata_role[])));

-- ============================================================================
-- Backfill: meter type from the name rule the Water usage tab used so far
-- ============================================================================
update public.asset a
set meter_type = case
    when a.name ~* 'borehole' then 'borehole'
    when a.name ~* 'municipal' then 'other'
    else 'treated'
  end::public.meter_type
where exists (select 1 from public.logger_daily_usage u where u.asset_id = a.id)
   or exists (select 1 from public.logger_reading r where r.asset_id = a.id and public.is_volume_unit(r.unit));

-- ============================================================================
-- save_location_target — the target and its bands, together or not at all
-- ============================================================================
-- Runs as the caller, so the location and band policies apply. p_bands is a
-- JSON array of {from_pct, colour, label}. Clearing the target (null) keeps
-- the stored bands, so they come back when a target is set again; p_bands is
-- then ignored.
create function public.save_location_target(p_location_id uuid, p_target numeric, p_bands jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_rows integer;
  v_bands integer;
  v_bad integer;
  v_zero integer;
  v_distinct integer;
begin
  if p_target is not null and p_target <= 0 then
    raise exception 'The daily volume target must be more than 0 m³.' using errcode = '22023';
  end if;

  if p_target is not null then
    if p_bands is null or jsonb_typeof(p_bands) <> 'array' or jsonb_array_length(p_bands) = 0 then
      raise exception 'Add colour bands for the target.' using errcode = '22023';
    end if;

    select count(*),
           count(*) filter (where
             b ->> 'from_pct' is null
             or b ->> 'from_pct' !~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
             or (b ->> 'from_pct')::numeric >= 10000
             or coalesce(b ->> 'colour', '') not in (select unnest(enum_range(null::public.target_band_colour))::text)),
           count(*) filter (where b ->> 'from_pct' ~ '^\s*0+(\.0+)?\s*$'),
           count(distinct case when b ->> 'from_pct' ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                               then round((b ->> 'from_pct')::numeric, 2) end)
    into v_bands, v_bad, v_zero, v_distinct
    from jsonb_array_elements(p_bands) b;

    if v_bad > 0 then
      raise exception 'Each colour band needs a From of 0%% or more and a colour.' using errcode = '22023';
    end if;
    if v_bands > 6 then
      raise exception 'A location can have at most 6 colour bands.' using errcode = '22023';
    end if;
    if v_zero = 0 then
      raise exception 'Add a colour band from 0%%, so every value has a colour.' using errcode = '22023';
    end if;
    if v_distinct < v_bands then
      raise exception 'Two colour bands start at the same %%.' using errcode = '22023';
    end if;
  end if;

  update public.location set volume_target = p_target where id = p_location_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'The location was not found, or you can''t change it.' using errcode = '42501';
  end if;

  if p_target is null then
    return;
  end if;

  delete from public.location_target_band where location_id = p_location_id;
  insert into public.location_target_band (location_id, from_pct, colour, label)
  select p_location_id,
         round((b ->> 'from_pct')::numeric, 2),
         (b ->> 'colour')::public.target_band_colour,
         nullif(btrim(b ->> 'label'), '')
  from jsonb_array_elements(p_bands) b;
  get diagnostics v_rows = row_count;
  if v_rows <> v_bands then
    raise exception 'You can''t change this location''s colour bands.' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.save_location_target(uuid, numeric, jsonb) from public, anon;
grant execute on function public.save_location_target(uuid, numeric, jsonb) to authenticated;

-- ============================================================================
-- Access: admins see daily usage and its issues
-- ============================================================================
drop policy logger_daily_usage_select on public.logger_daily_usage;
drop policy logger_usage_issue_select on public.logger_usage_issue;

create policy logger_daily_usage_select on public.logger_daily_usage for select
  to authenticated
  using ((select public.has_masterdata_role(array['system_admin', 'admin']::public.masterdata_role[])));
create policy logger_usage_issue_select on public.logger_usage_issue for select
  to authenticated
  using ((select public.has_masterdata_role(array['system_admin', 'admin']::public.masterdata_role[])));

-- The unit of a logger's latest reading, for the Water usage tab's list of
-- loggers without usage. Admins can't read logger_reading, so this reads it
-- for them and gives back only the unit.
create function public.logger_latest_unit(p_asset_id uuid)
returns table (unit text)
language sql
stable
security definer
set search_path = public
as $$
  select r.unit
  from public.logger_reading r
  where r.asset_id = p_asset_id
    and public.has_masterdata_role(array['system_admin', 'admin']::public.masterdata_role[])
  order by r.reading_at desc
  limit 1;
$$;

revoke execute on function public.logger_latest_unit(uuid) from public, anon;
grant execute on function public.logger_latest_unit(uuid) to authenticated;

-- ============================================================================
-- water_usage_report — as before, for admins too, with each meter's type
-- ============================================================================
create or replace function public.water_usage_report(
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
  v_result jsonb;
begin
  if not public.has_masterdata_role(array['system_admin', 'admin']::public.masterdata_role[]) then
    raise exception 'Only system admins and admins can see water usage.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid date range.' using errcode = '22023';
  end if;

  with sc as (
    -- Assets in scope with a logger code or any usage.
    select a.id, a.name, a.code, a.logger_code, a.active, a.meter_type,
           l.id as location_id, l.name as location, rg.name as region, o.name as organisation,
           (select min(u.day) from public.logger_daily_usage u where u.asset_id = a.id) as first_day
    from public.asset a
    join public.location l on l.id = a.location_id
    join public.region rg on rg.id = l.region_id
    join public.organisation o on o.id = l.organisation_id
    where (p_region_id is null or l.region_id = p_region_id)
      and (p_organisation_id is null or l.organisation_id = p_organisation_id)
      and (p_location_id is null or l.id = p_location_id)
      and (a.logger_code is not null or exists (select 1 from public.logger_daily_usage u where u.asset_id = a.id))
  ),
  meters as (
    select * from sc where first_day is not null
  ),
  rng as (
    select min(u.day) as first_day, max(u.day) as last_day
    from public.logger_daily_usage u
    join meters m on m.id = u.asset_id
    where u.day between p_from and p_to
  ),
  days as (
    select g::date as day
    from rng, generate_series(rng.first_day, rng.last_day, interval '1 day') g
  ),
  series as (
    select m.id,
           jsonb_agg(u.usage order by d.day) as usage,
           string_agg(
             case u.status when 'ok' then 'o' when 'estimated' then 'e' when 'long_gap' then 'g'
               when 'reset' then 'r' else '-' end,
             '' order by d.day) as status
    from meters m
    cross join days d
    left join public.logger_daily_usage u on u.asset_id = m.id and u.day = d.day
    group by m.id
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'from', p_from, 'to', p_to, 'first_day', rng.first_day, 'last_day', rng.last_day,
      'today', public.app_today()),
    'meters', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id, 'name', m.name, 'code', m.code, 'logger_code', m.logger_code, 'active', m.active,
          'meter_type', m.meter_type,
          'location_id', m.location_id, 'location', m.location, 'region', m.region,
          'organisation', m.organisation, 'first_day', m.first_day,
          'usage', coalesce(s.usage, '[]'::jsonb), 'status', coalesce(s.status, ''))
        order by m.location, m.name)
      from meters m
      left join series s on s.id = m.id
    ), '[]'::jsonb),
    -- Active loggers in scope with no usage: no readings, or not a volume meter.
    'excluded', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', x.id, 'name', x.name, 'code', x.code, 'location', x.location, 'unit', lu.unit,
          'reason', case when lu.has_readings then 'not_volume' else 'no_readings' end)
        order by x.location, x.name)
      from sc x
      left join lateral (
        select true as has_readings, u.unit from public.logger_latest_unit(x.id) u
      ) lu on true
      where x.active and x.logger_code is not null and x.first_day is null
    ), '[]'::jsonb),
    'issues', coalesce((
      select jsonb_agg(jsonb_build_object(
          'asset_id', i.asset_id, 'kind', i.kind, 'from_at', i.from_at, 'to_at', i.to_at,
          'readings', i.readings, 'low', i.low, 'high', i.high, 'fell_back_to', i.fell_back_to)
        order by i.from_at)
      from public.logger_usage_issue i
      join meters m on m.id = i.asset_id
      where i.to_at >= rng.first_day::timestamp at time zone v_tz
        and i.from_at < (rng.last_day + 1)::timestamp at time zone v_tz
    ), '[]'::jsonb)
  )
  into v_result
  from rng;

  return v_result;
end;
$$;

-- ============================================================================
-- water_target_matrix — treated water in per location per day
-- ============================================================================
-- Same period and region / organisation / site filters as
-- water_usage_report(). Days run from p_from to the earlier of p_to and
-- yesterday: today's usage is incomplete until midnight.
--
-- One entry per active location in scope with a Treated Meter (an inactive
-- one counts only on the days it has a figure). A day's usage is the sum of
-- its treated meters' usage; if any of them has no figure (no row, or a
-- reset) the day has none, since a partial sum would read as under target.
-- status has one character per day: o ok, e estimated, g long gap, r reset,
-- - no figure. Weekly and monthly figures are grouped in the browser.
create function public.water_target_matrix(
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
    select a.id, a.name, a.active, a.location_id
    from public.asset a
    join public.location l on l.id = a.location_id
    where a.meter_type = 'treated'
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
          'id', l.id, 'name', l.name, 'region', rg.name, 'target', l.volume_target,
          'bands', coalesce((
            select jsonb_agg(jsonb_build_object('from_pct', b.from_pct, 'colour', b.colour, 'label', b.label)
              order by b.from_pct desc)
            from public.location_target_band b where b.location_id = l.id
          ), '[]'::jsonb),
          'meters', mm.n, 'meter_ids', mm.ids,
          'usage', coalesce(s.usage, '[]'::jsonb), 'status', coalesce(s.status, ''))
        order by l.name)
      from public.location l
      join public.region rg on rg.id = l.region_id
      join lateral (
        select count(*) as n, jsonb_agg(m.id order by m.name) as ids
        from meters m where m.location_id = l.id
      ) mm on mm.n > 0
      left join series s on s.location_id = l.id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.water_target_matrix(date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.water_target_matrix(date, date, uuid, uuid, uuid) to authenticated;
