-- Water usage (Admin → Home → Water usage): daily usage per volume meter,
-- kept up to date as readings arrive, so a report over a year reads one row
-- per meter per day instead of every reading.
--
-- Volume loggers (unit m³) report the meter's running total about every 10
-- minutes. A day's usage is the total at the next local midnight (app time
-- zone) minus the total at this one, each linearly interpolated between the
-- readings either side. Before that the readings are cleaned:
--
--   * Streams. Each reading joins the stream whose last value it continues
--     (no drop of more than 0.05 m³, and a rise of at most 20 m³ + 15 m³ per
--     hour since that value); otherwise it starts a new stream. A stream
--     that overlaps a bigger one in time is left out: a second feed reporting
--     alongside the real one ('duplicate'), or a run of readings that climbed
--     and fell back to the real total ('excursion'). Streams of under 6
--     readings are noise and left out too.
--   * Fall-backs. When the total drops to a level the meter passed through
--     in the last 31 days, the readings since then are an excursion too: a
--     climb in steps small enough to pass as usage, then back to the real
--     total. The excursion starts where the meter began running at over 3×
--     its usual peak rate. Any other drop is a meter reset (e.g. a new meter
--     starting near zero): the day it happens has no usage figure.
--   * Gaps. A day whose readings are more than an hour apart somewhere is
--     still computed (interpolated) but marked 'estimated', or 'long_gap'
--     when the gap is over 6 hours. Totals over a period stay exact:
--     interpolation only moves usage between the days in a gap.
--
-- record_logger_pull_result() refreshes a meter's days from 30 days before
-- the pulled range (an excursion is only recognised once the meter falls
-- back), reading 35 days back for context. Changing the app time zone
-- recalculates everything.

-- ============================================================================
-- Tables
-- ============================================================================
create table public.logger_daily_usage (
  asset_id uuid not null references public.asset (id) on delete cascade,
  day date not null,
  -- m³; null on the day of a meter reset.
  usage numeric,
  status text not null,
  longest_gap_minutes integer,
  computed_at timestamptz not null default now(),
  primary key (asset_id, day),
  constraint logger_daily_usage_status_check check (status in ('ok', 'estimated', 'long_gap', 'reset')),
  constraint logger_daily_usage_usage_check check ((usage is null) = (status = 'reset'))
);

create index logger_daily_usage_day_idx on public.logger_daily_usage (day);

-- Readings the usage calculation left out, and meter resets.
create table public.logger_usage_issue (
  id bigint generated always as identity primary key,
  asset_id uuid not null references public.asset (id) on delete cascade,
  kind text not null,
  from_at timestamptz not null,
  to_at timestamptz not null,
  readings integer not null,
  -- duplicate / excursion: the left-out stream's first and last value and,
  -- for an excursion, the total the meter fell back to.
  -- reset: the total before (low) and after (high) the reset.
  low numeric,
  high numeric,
  fell_back_to numeric,
  constraint logger_usage_issue_kind_check check (kind in ('duplicate', 'excursion', 'reset'))
);

create index logger_usage_issue_asset_idx on public.logger_usage_issue (asset_id, to_at);

alter table public.logger_daily_usage enable row level security;
alter table public.logger_usage_issue enable row level security;

create policy logger_daily_usage_select on public.logger_daily_usage for select
  to authenticated
  using ((select public.has_masterdata_role(array['system_admin']::public.masterdata_role[])));
create policy logger_usage_issue_select on public.logger_usage_issue for select
  to authenticated
  using ((select public.has_masterdata_role(array['system_admin']::public.masterdata_role[])));

revoke insert, update, delete on public.logger_daily_usage from anon, authenticated;
revoke insert, update, delete on public.logger_usage_issue from anon, authenticated;

-- m³ as Hydrus spells it, and its other spellings (1 kL = 1 m³).
create function public.is_volume_unit(p_unit text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_unit, ''))) in ('m^3', 'm3', 'm³', 'kl');
$$;

-- ============================================================================
-- refresh_logger_daily_usage — recompute one meter's days
-- ============================================================================
-- p_since null = the meter's whole history; otherwise the days from 30 days
-- before p_since. Returns the number of days written.
create function public.refresh_logger_daily_usage(p_asset_id uuid, p_since timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_drop constant numeric := 0.05;
  c_jump_base constant numeric := 20;
  c_jump_per_hour constant numeric := 15;
  c_min_stream constant integer := 6;
  c_edge constant interval := interval '30 minutes';
  c_gap constant interval := interval '1 hour';
  c_long_gap constant interval := interval '6 hours';
  c_fall_back constant interval := interval '31 days';

  v_tz text := public.app_time_zone();
  v_start timestamptz := coalesce(p_since - interval '35 days', '-infinity');
  v_write_from date := ((p_since - interval '30 days') at time zone public.app_time_zone())::date;

  -- Readings, in time order, and the stream each joined.
  t timestamptz[];
  v numeric[];
  n integer;
  sid integer[] := '{}';
  -- Streams.
  ns integer := 0;
  s_first timestamptz[] := '{}';
  s_last timestamptz[] := '{}';
  s_last_v numeric[] := '{}';
  s_first_v numeric[] := '{}';
  s_n integer[] := '{}';
  s_keep boolean[] := '{}';
  kept integer[] := '{}';
  -- Kept readings.
  kt timestamptz[] := '{}';
  kv numeric[] := '{}';
  ks integer[] := '{}';
  kn integer := 0;
  -- Days to write.
  o_day date[] := '{}';
  o_usage numeric[] := '{}';
  o_status text[] := '{}';
  o_gap integer[] := '{}';

  i integer;
  s integer;
  k integer;
  m integer;
  v_old integer;
  v_target integer;
  v_peak numeric;
  best integer;
  best_diff numeric;
  diff numeric;
  v_overlaps boolean;
  after_v numeric;
  alongside integer;
  v_day date;
  v_last_day date;
  b0 timestamptz;
  b1 timestamptz;
  p integer := 1;
  q integer;
  a_v numeric;
  a_s integer;
  b_v numeric;
  b_s integer;
  gap interval;
  v_written integer := 0;
begin
  -- One refresh per meter at a time (two pulls can finish together).
  perform pg_advisory_xact_lock(hashtextextended('logger_daily_usage:' || p_asset_id::text, 0));

  select array_agg(r.reading_at order by r.reading_at), array_agg(r.value order by r.reading_at)
  into t, v
  from public.logger_reading r
  where r.asset_id = p_asset_id
    and r.reading_at >= v_start
    and public.is_volume_unit(r.unit);
  n := coalesce(cardinality(t), 0);

  -- ---------------------------------------------------------------- streams
  for i in 1 .. n loop
    best := null;
    best_diff := null;
    for s in 1 .. ns loop
      diff := v[i] - s_last_v[s];
      continue when diff < -c_max_drop
        or diff > c_jump_base + c_jump_per_hour * extract(epoch from t[i] - s_last[s]) / 3600;
      if best is null or abs(diff) < best_diff then
        best := s;
        best_diff := abs(diff);
      end if;
    end loop;
    if best is null then
      ns := ns + 1;
      best := ns;
      s_first[ns] := t[i];
      s_first_v[ns] := v[i];
      s_n[ns] := 0;
    end if;
    s_last[best] := t[i];
    s_last_v[best] := v[i];
    s_n[best] := s_n[best] + 1;
    sid[i] := best;
  end loop;

  -- Biggest first; a stream overlapping one already kept is left out.
  for s in
    select x.idx from unnest(s_n) with ordinality as x (cnt, idx) order by x.cnt desc, x.idx
  loop
    v_overlaps := false;
    foreach k in array kept loop
      if least(s_last[s], s_last[k]) >= greatest(s_first[s], s_first[k]) then
        v_overlaps := true;
        exit;
      end if;
    end loop;
    s_keep[s] := not v_overlaps and s_n[s] >= c_min_stream;
    if s_keep[s] then
      kept := kept || s;
    end if;
  end loop;

  for i in 1 .. n loop
    if s_keep[sid[i]] then
      kn := kn + 1;
      kt[kn] := t[i];
      kv[kn] := v[i];
      ks[kn] := sid[i];
    end if;
  end loop;

  -- ---------------------------------------------------------------- issues
  delete from public.logger_usage_issue
  where asset_id = p_asset_id and from_at >= v_start;

  for s in 1 .. ns loop
    continue when s_keep[s] or s_n[s] < c_min_stream;
    select count(*) into alongside from unnest(kt) as x (ts) where x.ts between s_first[s] and s_last[s];
    select kv[x.i] into after_v from generate_subscripts(kt, 1) as x (i) where kt[x.i] > s_last[s] order by x.i limit 1;
    insert into public.logger_usage_issue (asset_id, kind, from_at, to_at, readings, low, high, fell_back_to)
    select p_asset_id,
           case when alongside >= s_n[s] / 2.0 then 'duplicate' else 'excursion' end,
           s_first[s], s_last[s], s_n[s], s_first_v[s], s_last_v[s],
           case when alongside < s_n[s] / 2.0 then after_v end
    -- Already recorded from an earlier, wider window.
    where not exists (
      select 1 from public.logger_usage_issue x
      where x.asset_id = p_asset_id and x.from_at < v_start and x.to_at >= s_first[s]
    );
  end loop;

  -- Fall-backs: a stream that starts below the one before it, at a total
  -- that one passed through in the last 31 days, continues it; the readings
  -- since then climbed away from the real total.
  i := 2;
  while i <= kn loop
    if ks[i] <> ks[i - 1] and kv[i] < kv[i - 1] then
      m := i - 1;
      while m >= 1 and ks[m] = ks[i - 1] and kt[m] >= kt[i] - c_fall_back and kv[m] > kv[i] loop
        m := m - 1;
      end loop;
      if m >= 1 and ks[m] = ks[i - 1] and kt[m] >= kt[i] - c_fall_back
         and kv[i] - kv[m] <= c_jump_base + c_jump_per_hour * extract(epoch from kt[i] - kt[m]) / 3600 then
        -- The climb began where the meter started running far faster than
        -- its usual peak (95th percentile of the week before, m³/h).
        select percentile_cont(0.95) within group (order by x.rate) into v_peak
        from (
          select (kv[gs.idx] - kv[gs.idx - 1]) / (extract(epoch from kt[gs.idx] - kt[gs.idx - 1]) / 3600) as rate
          from generate_series(2, m) as gs (idx)
          where kt[gs.idx] >= kt[m] - interval '7 days' and ks[gs.idx] = ks[gs.idx - 1] and kt[gs.idx] > kt[gs.idx - 1]
        ) x;
        while m > 1 and ks[m - 1] = ks[m] and kt[m] > kt[m - 1]
          and (kv[m] - kv[m - 1]) / (extract(epoch from kt[m] - kt[m - 1]) / 3600) > greatest(3 * coalesce(v_peak, 0), 2) loop
          m := m - 1;
        end loop;

        insert into public.logger_usage_issue (asset_id, kind, from_at, to_at, readings, low, high, fell_back_to)
        select p_asset_id, 'excursion', kt[m + 1], kt[i - 1], i - 1 - m, kv[m + 1], kv[i - 1], kv[i]
        where not exists (
          select 1 from public.logger_usage_issue x
          where x.asset_id = p_asset_id and x.from_at < v_start and x.to_at >= kt[m + 1]
        );
        v_old := ks[i];
        v_target := ks[i - 1];
        for k in i .. kn loop
          if ks[k] = v_old then
            ks[k] := v_target;
          end if;
        end loop;
        kt := kt[1:m] || kt[i:kn];
        kv := kv[1:m] || kv[i:kn];
        ks := ks[1:m] || ks[i:kn];
        kn := kn - (i - 1 - m);
        i := m + 1;
      end if;
    end if;
    i := i + 1;
  end loop;

  for i in 2 .. kn loop
    continue when ks[i] = ks[i - 1];
    insert into public.logger_usage_issue (asset_id, kind, from_at, to_at, readings, low, high)
    select p_asset_id, 'reset', kt[i - 1], kt[i], 0, kv[i - 1], kv[i]
    where not exists (
      select 1 from public.logger_usage_issue x
      where x.asset_id = p_asset_id and x.kind = 'reset' and x.to_at = kt[i]
    );
  end loop;

  -- ---------------------------------------------------------------- days
  if kn > 0 then
    v_day := greatest((kt[1] at time zone v_tz)::date, coalesce(v_write_from, '-infinity'::date));
    v_last_day := (kt[kn] at time zone v_tz)::date;
    b1 := v_day::timestamp at time zone v_tz;

    while v_day <= v_last_day loop
      b0 := b1;
      b1 := (v_day + 1)::timestamp at time zone v_tz;

      -- The total at b0, then at b1: a_v/a_s, b_v/b_s (null = unknown).
      for k in 0 .. 1 loop
        declare
          bound timestamptz := case k when 0 then b0 else b1 end;
          tv numeric := null;
          ts integer := null;
        begin
          while p < kn and kt[p + 1] <= bound loop
            p := p + 1;
          end loop;
          if kt[p] <= bound then
            if p < kn and ks[p] = ks[p + 1] then
              tv := kv[p] + (kv[p + 1] - kv[p]) * extract(epoch from bound - kt[p]) / extract(epoch from kt[p + 1] - kt[p]);
              ts := ks[p];
            elsif bound - kt[p] <= c_edge then
              tv := kv[p];
              ts := ks[p];
            elsif p < kn and kt[p + 1] - bound <= c_edge then
              tv := kv[p + 1];
              ts := ks[p + 1];
            end if;
          elsif kt[p] - bound <= c_edge then
            tv := kv[p];
            ts := ks[p];
          end if;
          if k = 0 then
            a_v := tv;
            a_s := ts;
            q := p;
          else
            b_v := tv;
            b_s := ts;
          end if;
        end;
      end loop;

      if a_v is not null and b_v is not null then
        -- Longest time between readings of the same stream spanning the day.
        gap := interval '0';
        for i in q + 1 .. least(p + 1, kn) loop
          if ks[i] = ks[i - 1] and kt[i] - kt[i - 1] > gap then
            gap := kt[i] - kt[i - 1];
          end if;
        end loop;

        o_day := o_day || v_day;
        o_gap := o_gap || (extract(epoch from gap) / 60)::integer;
        if a_s <> b_s then
          o_usage := o_usage || null::numeric;
          o_status := o_status || 'reset'::text;
        else
          o_usage := o_usage || round(greatest(0, b_v - a_v), 4);
          o_status := o_status || case
            when gap > c_long_gap then 'long_gap'
            when gap > c_gap then 'estimated'
            else 'ok'
          end;
        end if;
      end if;

      v_day := v_day + 1;
    end loop;
  end if;

  delete from public.logger_daily_usage
  where asset_id = p_asset_id and (v_write_from is null or day >= v_write_from);

  insert into public.logger_daily_usage (asset_id, day, usage, status, longest_gap_minutes)
  select p_asset_id, x.day, x.usage, x.status, x.gap
  from unnest(o_day, o_usage, o_status, o_gap) as x (day, usage, status, gap);
  get diagnostics v_written = row_count;

  return v_written;
end;
$$;

-- Every meter's whole history (first fill, or after the time zone changes).
create function public.refresh_all_logger_daily_usage()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset uuid;
  v_days integer := 0;
begin
  for v_asset in
    select distinct asset_id from public.logger_daily_usage
    union
    select distinct asset_id from public.logger_reading where public.is_volume_unit(unit)
  loop
    v_days := v_days + public.refresh_logger_daily_usage(v_asset, null);
  end loop;
  return v_days;
end;
$$;

revoke execute on function public.refresh_logger_daily_usage(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.refresh_all_logger_daily_usage() from public, anon, authenticated;

create function public.recalculate_usage_on_time_zone_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_all_logger_daily_usage();
  return null;
end;
$$;

create trigger system_settings_time_zone_usage
  after update of time_zone on public.system_settings
  for each row
  when (old.time_zone is distinct from new.time_zone)
  execute function public.recalculate_usage_on_time_zone_change();

-- ============================================================================
-- record_logger_pull_result — as before, plus refreshing the meter's usage
-- ============================================================================
create or replace function public.record_logger_pull_result(
  p_result_id bigint,
  p_outcome text,
  p_unit text,
  p_readings jsonb,
  p_http_status integer,
  p_error text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.logger_pull_result;
  v_type public.logger_type;
  v_range_start timestamptz;
  v_outcome text := p_outcome;
  v_delays constant integer[] := array[1, 5];
  v_total integer := 0;
  v_saved integer := 0;
  v_error text := p_error;
begin
  select * into v_row from public.logger_pull_result where id = p_result_id for update;
  if not found or v_row.status <> 'running' then
    return 0;
  end if;
  select logger_type, range_start into v_type, v_range_start from public.logger_pull_run where id = v_row.run_id;

  if v_outcome = 'retry' and v_row.attempts > cardinality(v_delays) then
    v_outcome := 'failed';
  end if;

  if v_outcome = 'success' then
    if v_row.asset_id is null then
      v_outcome := 'failed';
      v_error := 'The asset was deleted during the pull.';
    else
      v_total := coalesce(jsonb_array_length(p_readings), 0);

      insert into public.logger_reading as lr
        (asset_id, logger_type, logger_code, reading_at, value, unit, run_id, pulled_at)
      select distinct on (t.reading_at)
        v_row.asset_id, v_type, v_row.logger_code, t.reading_at, t.value, nullif(btrim(p_unit), ''),
        v_row.run_id, now()
      from (
        select
          (btrim(r ->> 'reading_timestamp'))::timestamp at time zone 'Africa/Johannesburg' as reading_at,
          (btrim(r ->> 'reading'))::numeric as value
        from jsonb_array_elements(coalesce(p_readings, '[]'::jsonb)) as r
        where btrim(r ->> 'reading') ~ '^-?[0-9]+(\.[0-9]+)?$'
          and public.is_hydrus_timestamp(r ->> 'reading_timestamp')
      ) t
      order by t.reading_at
      on conflict (logger_code, reading_at) do update set
        asset_id = excluded.asset_id,
        logger_type = excluded.logger_type,
        value = excluded.value,
        unit = excluded.unit,
        run_id = excluded.run_id,
        pulled_at = excluded.pulled_at;
      get diagnostics v_saved = row_count;

      if v_saved < v_total then
        v_error := format('%s of %s readings skipped (duplicate time, or a value or time that could not be read).',
          v_total - v_saved, v_total);
      end if;

      if v_saved > 0 and public.is_volume_unit(p_unit) then
        perform public.refresh_logger_daily_usage(v_row.asset_id, v_range_start);
      end if;
    end if;
  end if;

  update public.logger_pull_result set
    status = case v_outcome when 'success' then 'success' when 'retry' then 'pending' else 'failed' end,
    next_attempt_at = case
      when v_outcome = 'retry' then now() + make_interval(mins => v_delays[v_row.attempts])
      else next_attempt_at
    end,
    finished_at = case when v_outcome = 'retry' then null else now() end,
    readings_saved = case when v_outcome = 'success' then v_saved end,
    unit = nullif(btrim(p_unit), ''),
    http_status = p_http_status,
    error = left(v_error, 1000)
  where id = p_result_id;

  perform public.finish_logger_pull_run_if_done(v_row.run_id);
  return v_saved;
end;
$$;

-- ============================================================================
-- water_usage_report — the Water usage tab in one call
-- ============================================================================
-- Same period and region / organisation / site filters as logger_dashboard().
-- The period is trimmed to the days any meter in scope has usage for. Each
-- meter carries its daily usage as an array over those days, and a status
-- string with one character per day: o ok, e estimated, g long gap,
-- r reset, - no figure.
create function public.water_usage_report(
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
  if not public.has_masterdata_role(array['system_admin']::public.masterdata_role[]) then
    raise exception 'Only system admins can see logger data.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid date range.' using errcode = '22023';
  end if;

  with sc as (
    -- Assets in scope with a logger code or any usage.
    select a.id, a.name, a.code, a.logger_code, a.active,
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
        select true as has_readings, r.unit from public.logger_reading r
        where r.asset_id = x.id order by r.reading_at desc limit 1
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

revoke execute on function public.water_usage_report(date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.water_usage_report(date, date, uuid, uuid, uuid) to authenticated;

-- ============================================================================
-- First fill from the readings already stored
-- ============================================================================
select public.refresh_all_logger_daily_usage();
