-- Meter classification on the asset type (Phase 1 of "Billing and Meter
-- Classification").
--
-- What a meter measures becomes a property of its asset type, held in
-- asset_type.classification, instead of asset.meter_type:
--
--   TREATED_METER    treated water out of the plant; volume target, billed
--   BOREHOLE_METER   water abstracted; borehole usage limit
--   MUNICIPAL_METER  municipal supply and check meters
--   ELECTRICAL_METER kWh
--   OTHER            everything that isn't a meter, and odd meters
--
-- FLEET is removed (there are no Fleet asset types live; this stops if one
-- turns up). Postgres can't drop an enum value, so a new enum is built, the
-- column converted and the old type dropped.
--
-- Live data: the one "Water Meter" asset type held treated, borehole and
-- municipal meters, told apart by meter_type (set on logger meters) or by
-- name. It is split into Treated Meter, Borehole Meter and Municipal Meter;
-- the meters that fit none (pump, filling, fire, school, ultrasonic, check
-- meters) stay on it, renamed Other Meter. Electrical Meter becomes
-- ELECTRICAL_METER. Each new type gets a copy of Water Meter's inspection
-- allocations, so capture is unchanged. Every asset moved is logged in
-- asset_type_migration_log; undoing the move is an update from that table.
-- Only Water Meter assets move: Rentmeester's "Borehole pump" (asset type
-- Borehole Pump, meter_type borehole) is left for a manual fix.
--
-- asset.usage_limit is allowed only on borehole meters. A check constraint
-- can't see the asset type, so triggers replace asset_usage_limit_check.
--
-- water_usage_report, water_target_matrix and water_borehole_matrix read the
-- classification. The matrices count only meters with a logger code or usage
-- in the period: meters read by hand have no daily usage, and counting them
-- would leave every day without a figure.
--
-- asset.meter_type stays (unused) until Phase 2 drops it.

-- ============================================================================
-- 1. No Fleet asset types
-- ============================================================================
do $$
begin
  if exists (select 1 from public.asset_type where classification = 'FLEET') then
    raise exception 'Asset types are classified FLEET (%). Reclassify them before this migration.',
      (select string_agg(name, ', ' order by name) from public.asset_type where classification = 'FLEET');
  end if;
end;
$$;

-- ============================================================================
-- 2. New classification enum
-- ============================================================================
create type public.asset_classification_new as enum (
  'TREATED_METER', 'BOREHOLE_METER', 'MUNICIPAL_METER', 'ELECTRICAL_METER', 'OTHER');

alter table public.asset_type alter column classification drop default;
-- FLEET maps to null, which the not-null column refuses (checked above).
alter table public.asset_type
  alter column classification type public.asset_classification_new
  using (case classification::text when 'OTHER' then 'OTHER' end)::public.asset_classification_new;
drop type public.asset_classification;
alter type public.asset_classification_new rename to asset_classification;
alter table public.asset_type alter column classification set default 'OTHER';

-- ============================================================================
-- 3. Migration log
-- ============================================================================
-- One row per asset this migration moved. No foreign keys, so the record
-- outlives the rows it describes. old_meter_type is text: Phase 2 drops the
-- meter_type enum.
create table public.asset_type_migration_log (
  id bigint generated always as identity primary key,
  asset_id uuid not null,
  old_asset_type_id uuid not null,
  new_asset_type_id uuid not null,
  old_meter_type text,
  rule text not null,
  moved_at timestamptz not null default now()
);

-- System only: RLS on, no policies.
alter table public.asset_type_migration_log enable row level security;
revoke all on public.asset_type_migration_log from anon, authenticated;

-- ============================================================================
-- 4–6. Asset types, allocations and the move
-- ============================================================================
-- Where a Water Meter asset goes, from its meter_type and name: 'treated',
-- 'borehole', 'municipal', or null (stays on Water Meter, renamed Other
-- Meter). meter_type wins; then the name, in the order treated, borehole,
-- municipal. A meter_type of 'other' moves only when the name says
-- municipal (Kempton's "Municipal meter"). Kept after the move as the record
-- of the rule, and tested in asset_classification_test.sql.
create function public.asset_classification_meter_rule(p_meter_type text, p_name text)
returns table (kind text, rule text)
language sql
immutable
as $$
  select case
           when p_meter_type = 'treated' then 'treated'
           when p_meter_type = 'borehole' then 'borehole'
           when p_meter_type = 'other' and p_name ~* 'municipal' then 'municipal'
           when p_meter_type is null and p_name ~* 'treated' then 'treated'
           when p_meter_type is null and p_name ~* 'borehole' then 'borehole'
           when p_meter_type is null and p_name ~* 'municipal' then 'municipal'
         end,
         case
           when p_meter_type in ('treated', 'borehole') then 'meter_type'
           when p_meter_type = 'other' and p_name ~* 'municipal' then 'meter_type other, name municipal'
           when p_meter_type is null and p_name ~* 'treated|borehole|municipal' then 'name'
         end;
$$;

do $$
declare
  v_water uuid;
  v_types jsonb;
  v_moved integer;
begin
  -- New meter types. A type of that name already there is reused.
  insert into public.asset_type (name, classification) values
    ('Treated Meter', 'TREATED_METER'),
    ('Borehole Meter', 'BOREHOLE_METER'),
    ('Municipal Meter', 'MUNICIPAL_METER')
  on conflict (name) do update set classification = excluded.classification, active = true;

  select jsonb_build_object(
           'treated', max(id::text) filter (where name = 'Treated Meter'),
           'borehole', max(id::text) filter (where name = 'Borehole Meter'),
           'municipal', max(id::text) filter (where name = 'Municipal Meter'))
    into v_types
  from public.asset_type where name in ('Treated Meter', 'Borehole Meter', 'Municipal Meter');

  update public.asset_type set classification = 'ELECTRICAL_METER' where name = 'Electrical Meter';

  select id into v_water from public.asset_type where name = 'Water Meter';
  if v_water is null then
    -- A fresh database: nothing to split.
    return;
  end if;

  -- Water Meter's inspections on each new type, same priority.
  insert into public.inspection_allocation (inspection_id, asset_type_id, priority)
  select ia.inspection_id, (t.value #>> '{}')::uuid, ia.priority
  from public.inspection_allocation ia
  cross join jsonb_each(v_types) t
  where ia.asset_type_id = v_water
  on conflict (inspection_id, asset_type_id) do nothing;

  -- Log, then move.
  insert into public.asset_type_migration_log (asset_id, old_asset_type_id, new_asset_type_id, old_meter_type, rule)
  select a.id, v_water, (v_types ->> r.kind)::uuid, a.meter_type::text, r.rule
  from public.asset a
  cross join lateral public.asset_classification_meter_rule(a.meter_type::text, a.name) r
  where a.asset_type_id = v_water and r.kind is not null;

  update public.asset a
  set asset_type_id = lg.new_asset_type_id
  from public.asset_type_migration_log lg
  where lg.asset_id = a.id and a.asset_type_id = v_water;
  get diagnostics v_moved = row_count;

  -- The leftovers stay on Water Meter, renamed.
  update public.asset_type set name = 'Other Meter', classification = 'OTHER' where id = v_water;

  raise notice 'Asset classification: moved % assets (treated %, borehole %, municipal %); % left on Other Meter.',
    v_moved,
    (select count(*) from public.asset_type_migration_log where new_asset_type_id = (v_types ->> 'treated')::uuid),
    (select count(*) from public.asset_type_migration_log where new_asset_type_id = (v_types ->> 'borehole')::uuid),
    (select count(*) from public.asset_type_migration_log where new_asset_type_id = (v_types ->> 'municipal')::uuid),
    (select count(*) from public.asset where asset_type_id = v_water);
end;
$$;

-- ============================================================================
-- 7. Usage limit: borehole meters only
-- ============================================================================
alter table public.asset
  drop constraint asset_usage_limit_check,
  add constraint asset_usage_limit_check check (usage_limit is null or usage_limit > 0);

-- Every limit must sit on a borehole meter before the triggers guard it.
do $$
begin
  if exists (
    select 1 from public.asset a
    join public.asset_type t on t.id = a.asset_type_id
    where a.usage_limit is not null and t.classification <> 'BOREHOLE_METER'
  ) then
    raise exception 'Assets with a usage limit are not borehole meters after the move: %.',
      (select string_agg(a.name || ' (' || t.name || ')', ', ' order by a.name)
       from public.asset a join public.asset_type t on t.id = a.asset_type_id
       where a.usage_limit is not null and t.classification <> 'BOREHOLE_METER');
  end if;
end;
$$;

-- Security definer so the check sees the asset type whatever the caller may
-- read.
create function public.asset_check_usage_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.usage_limit is not null
     and (select t.classification from public.asset_type t where t.id = new.asset_type_id)
         is distinct from 'BOREHOLE_METER' then
    raise exception 'A usage limit can only be set on a borehole meter: % has an asset type that isn''t one.', new.name;
  end if;
  return new;
end;
$$;

create trigger asset_check_usage_limit
  before insert or update of usage_limit, asset_type_id on public.asset
  for each row execute function public.asset_check_usage_limit();

create function public.asset_type_check_usage_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.classification = 'BOREHOLE_METER' and new.classification is distinct from 'BOREHOLE_METER'
     and exists (select 1 from public.asset a where a.asset_type_id = new.id and a.usage_limit is not null) then
    raise exception 'Assets of type % have a usage limit, so it must stay a borehole meter. Clear their limits first.', new.name;
  end if;
  return new;
end;
$$;

create trigger asset_type_check_usage_limit
  before update of classification on public.asset_type
  for each row execute function public.asset_type_check_usage_limit();

revoke execute on function public.asset_check_usage_limit() from public, anon, authenticated;
revoke execute on function public.asset_type_check_usage_limit() from public, anon, authenticated;

-- ============================================================================
-- 8. Water dashboards read the classification
-- ============================================================================
-- The report's meter_type key for an asset type classification: treated,
-- borehole, other (municipal and electrical meters), or null (not a meter
-- type, so the dashboard asks for it to be set).
create function public.water_meter_kind(p_classification public.asset_classification)
returns text
language sql
immutable
as $$
  select case p_classification
    when 'TREATED_METER' then 'treated'
    when 'BOREHOLE_METER' then 'borehole'
    when 'MUNICIPAL_METER' then 'other'
    when 'ELECTRICAL_METER' then 'other'
  end;
$$;

-- As in 20261014120000_volume_target.sql, with meter_type from the asset
-- type.
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
    select a.id, a.name, a.code, a.logger_code, a.active,
           public.water_meter_kind(t.classification) as meter_type,
           l.id as location_id, l.name as location, rg.name as region, o.name as organisation,
           (select min(u.day) from public.logger_daily_usage u where u.asset_id = a.id) as first_day
    from public.asset a
    join public.asset_type t on t.id = a.asset_type_id
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

-- As in 20261014120000_volume_target.sql. A location's meters are its
-- assets whose type is a treated meter and that have a logger code or usage
-- in the period; an inactive one counts only on the days it has a figure.
create or replace function public.water_target_matrix(
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
    join public.asset_type t on t.id = a.asset_type_id
    join public.location l on l.id = a.location_id
    cross join lateral (
      select exists (
        select 1 from public.logger_daily_usage u where u.asset_id = a.id and u.day between p_from and v_last
      ) as has_usage
    ) hu
    where t.classification = 'TREATED_METER'
      and l.active
      and (p_region_id is null or l.region_id = p_region_id)
      and (p_organisation_id is null or l.organisation_id = p_organisation_id)
      and (p_location_id is null or l.id = p_location_id)
      and (a.logger_code is not null or hu.has_usage)
      and (a.active or hu.has_usage)
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

-- As in 20261015120000_borehole_usage_limit.sql, with the meters chosen as
-- in water_target_matrix(): borehole-meter types with a logger code or usage
-- in the period.
create or replace function public.water_borehole_matrix(
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
    join public.asset_type t on t.id = a.asset_type_id
    join public.location l on l.id = a.location_id
    cross join lateral (
      select exists (
        select 1 from public.logger_daily_usage u where u.asset_id = a.id and u.day between p_from and v_last
      ) as has_usage
    ) hu
    where t.classification = 'BOREHOLE_METER'
      and l.active
      and (p_region_id is null or l.region_id = p_region_id)
      and (p_organisation_id is null or l.organisation_id = p_organisation_id)
      and (p_location_id is null or l.id = p_location_id)
      and (a.logger_code is not null or hu.has_usage)
      and (a.active or hu.has_usage)
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
