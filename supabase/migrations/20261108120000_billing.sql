-- Billing (Admin → Billing): a monthly invoice per location for the treated
-- water it supplied.
--
-- Each billed location has a billing day: the day of the month its meter
-- readings must be taken (31 = the last day, clamped in short months). An
-- invoice for period month P runs from the billing day in the month before P
-- to the billing day in P.
--
-- Meters are assets with a billing meter type (borehole, treated or
-- electrical). A meter's reading is the "Meter Reading" inspection value
-- (value type CUMULATIVE_VALUE) of an inspection activity on it. For each end
-- of the period the reading on the billing day (±1 day in the app time zone)
-- is used; with none in that window the closest reading in time is used and
-- the line is flagged. The opening reading is the closing reading of the
-- location's previous approved invoice when that invoice ended on this
-- period's start, so readings run on from invoice to invoice.
--
-- Invoiced amount = treated usage (sum over treated meters, closing −
-- opening) × the location's tariff rate in effect on the period end.
-- Borehole and electrical meters are shown only.
--
-- Flow: billing_generate() makes draft invoices for a month (rebuilding
-- drafts, leaving approved invoices alone); a reviewer checks each one and
-- may pick another reading or type a value (billing_set_reading()); then
-- billing_approve() locks them and numbers them. Approved invoices are
-- snapshots: later edits to inspections don't change them. The PDF is
-- rendered from the snapshot by the web app. A mistake after approval is
-- voided (billing_void()) and the location regenerated.

-- ============================================================================
-- Types and columns
-- ============================================================================
create type public.billing_meter as enum ('borehole', 'treated', 'electrical');
create type public.invoice_status as enum ('draft', 'approved', 'void');

-- What the asset meters for billing; null = not billed. Separate from
-- meter_type, which drives the logger-based water dashboards.
alter table public.asset add column billing_meter public.billing_meter;

-- Day of the month the location's meter readings are taken; null = not billed.
alter table public.location add column billing_day smallint
  constraint location_billing_day_check check (billing_day between 1 and 31);

-- ============================================================================
-- location_tariff — rate per kL of treated water, from a date onward
-- ============================================================================
create table public.location_tariff (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.location (id) on delete cascade,
  rate numeric(12, 4) not null constraint location_tariff_rate_check check (rate > 0),
  effective_from date not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  constraint location_tariff_location_from_key unique (location_id, effective_from)
);

-- ============================================================================
-- billing_run — one per period month
-- ============================================================================
create table public.billing_run (
  id uuid primary key default gen_random_uuid(),
  -- First day of the period month.
  period date not null unique constraint billing_run_period_check check (extract(day from period) = 1),
  generated_at timestamptz not null default now(),
  generated_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create sequence public.invoice_number_seq;

-- ============================================================================
-- invoice — one location's invoice for a run
-- ============================================================================
create table public.invoice (
  id uuid primary key default gen_random_uuid(),
  billing_run_id uuid not null references public.billing_run (id) on delete cascade,
  location_id uuid not null references public.location (id) on delete restrict,
  -- Snapshot, so renames don't change an approved invoice.
  location_name text not null,
  organisation_name text,
  region_name text,
  status public.invoice_status not null default 'draft',
  -- Given on approval.
  invoice_no text unique,
  billing_day smallint not null,
  period_start date not null,
  period_end date not null,
  -- Null when the location has no tariff on period_end.
  tariff_rate numeric(12, 4),
  -- kL; null while a treated meter has no usage.
  treated_usage numeric,
  amount numeric(14, 2),
  -- Issue codes (see billing_recalc_invoice); blocking ones stop approval.
  issues text[] not null default '{}',
  generated_at timestamptz not null default now(),
  generated_by uuid default auth.uid() references auth.users (id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text
);

-- One live invoice per location per run; voided ones stay for the record.
create unique index invoice_run_location_key on public.invoice (billing_run_id, location_id)
  where status <> 'void';
create index invoice_location_idx on public.invoice (location_id, period_end desc);

-- ============================================================================
-- invoice_line — one meter on an invoice
-- ============================================================================
-- *_source: 'window' (read within ±1 day of the billing day), 'closest'
-- (nearest reading, outside the window), 'previous_invoice' (closing reading
-- of the previous approved invoice), 'selected' (reviewer picked a reading),
-- 'manual' (reviewer typed a value), 'none' (no reading at all).
create table public.invoice_line (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoice (id) on delete cascade,
  asset_id uuid not null references public.asset (id) on delete restrict,
  asset_name text not null,
  asset_code text not null default '',
  meter public.billing_meter not null,
  sort_order integer not null default 0,

  prev_value numeric,
  prev_read_at timestamptz,
  prev_value_id uuid references public.inspection_value (id) on delete set null,
  prev_image_path text,
  prev_source text not null default 'none',

  curr_value numeric,
  curr_read_at timestamptz,
  curr_value_id uuid references public.inspection_value (id) on delete set null,
  curr_image_path text,
  curr_source text not null default 'none',

  usage numeric,
  issues text[] not null default '{}',
  note text not null default '',

  constraint invoice_line_prev_source_check check (prev_source in ('window', 'closest', 'previous_invoice', 'selected', 'manual', 'none')),
  constraint invoice_line_curr_source_check check (curr_source in ('window', 'closest', 'previous_invoice', 'selected', 'manual', 'none'))
);

create index invoice_line_invoice_idx on public.invoice_line (invoice_id, sort_order);
create index invoice_line_asset_idx on public.invoice_line (asset_id);

-- ============================================================================
-- Helpers
-- ============================================================================
create function public.is_billing_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_masterdata_role(array['system_admin', 'admin']::public.masterdata_role[]);
$$;

create function public.require_billing_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_billing_admin() then
    raise exception 'Only system admins and admins can manage billing.' using errcode = '42501';
  end if;
end;
$$;

-- The billing day in a month, clamped to the month's last day.
create function public.billing_date(p_month date, p_billing_day integer)
returns date
language sql
immutable
as $$
  select make_date(
    extract(year from p_month)::int,
    extract(month from p_month)::int,
    least(p_billing_day, extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::int)
  );
$$;

-- Meter readings of an asset ordered by closeness to a day: by calendar day
-- (app time zone) first, then by time from that day's noon. day_diff is the
-- signed number of days from p_day.
create function public.billing_readings_near(p_asset_id uuid, p_day date, p_limit integer default 1)
returns table (
  value_id uuid,
  value numeric,
  read_at timestamptz,
  day_diff integer,
  image_path text
)
language sql
stable
security definer
set search_path = public
as $$
  with tz as (select public.app_time_zone() as zone)
  select v.id,
         v.decimal_value,
         ia.inspection_date,
         ((ia.inspection_date at time zone tz.zone)::date - p_day)::int,
         (select ii.storage_path from public.inspection_image ii
          where ii.inspection_value_id = v.id
          order by ii.created_at, ii.id limit 1)
  from public.inspection_value v
  join public.inspection i on i.id = v.inspection_id and i.value_type = 'CUMULATIVE_VALUE'
  join public.inspection_activity ia on ia.id = v.inspection_activity_id
  cross join tz
  where ia.asset_id = p_asset_id
    and v.is_current
  order by abs((ia.inspection_date at time zone tz.zone)::date - p_day),
           abs(extract(epoch from (ia.inspection_date - ((p_day + time '12:00') at time zone tz.zone)))),
           v.id
  limit p_limit;
$$;

-- Usage and issues of one line from its stored readings.
-- Line issues: no_prev_reading, no_curr_reading, prev_outside_window,
-- curr_outside_window, no_prev_photo, no_curr_photo, same_reading,
-- negative_usage.
create function public.billing_recalc_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.invoice_line;
  inv public.invoice;
  v_zone text := public.app_time_zone();
  v_issues text[] := '{}';
  v_usage numeric;
begin
  select * into l from public.invoice_line where id = p_line_id;
  select * into inv from public.invoice where id = l.invoice_id;

  if l.prev_value is null then v_issues := array_append(v_issues, 'no_prev_reading'); end if;
  if l.curr_value is null then v_issues := array_append(v_issues, 'no_curr_reading'); end if;

  if l.prev_source in ('closest', 'selected') and l.prev_read_at is not null
     and abs((l.prev_read_at at time zone v_zone)::date - inv.period_start) > 1 then
    v_issues := array_append(v_issues, 'prev_outside_window');
  end if;
  if l.curr_source in ('closest', 'selected') and l.curr_read_at is not null
     and abs((l.curr_read_at at time zone v_zone)::date - inv.period_end) > 1 then
    v_issues := array_append(v_issues, 'curr_outside_window');
  end if;

  if l.prev_value is not null and l.prev_source not in ('manual', 'previous_invoice') and l.prev_image_path is null then
    v_issues := array_append(v_issues, 'no_prev_photo');
  end if;
  if l.curr_value is not null and l.curr_source <> 'manual' and l.curr_image_path is null then
    v_issues := array_append(v_issues, 'no_curr_photo');
  end if;

  if l.prev_value is not null and l.curr_value is not null then
    v_usage := l.curr_value - l.prev_value;
    if v_usage < 0 then v_issues := array_append(v_issues, 'negative_usage'); end if;
    if l.prev_value_id is not null and l.prev_value_id = l.curr_value_id then
      v_issues := array_append(v_issues, 'same_reading');
    end if;
  end if;

  update public.invoice_line set usage = v_usage, issues = v_issues where id = p_line_id;
end;
$$;

-- Totals and issues of one invoice from its lines.
-- Invoice issues: no_tariff, no_treated_meter (blocking), period_not_ended
-- (warning); plus every issue of its lines. Blocking line issues are those on treated meters: no reading or
-- negative usage (see billing_blocking_issues).
create function public.billing_recalc_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invoice;
  v_issues text[] := '{}';
  v_usage numeric;
  v_treated integer;
  v_unknown integer;
begin
  select * into inv from public.invoice where id = p_invoice_id;

  select count(*), count(*) filter (where usage is null), sum(usage)
    into v_treated, v_unknown, v_usage
  from public.invoice_line where invoice_id = p_invoice_id and meter = 'treated';

  if inv.tariff_rate is null then v_issues := array_append(v_issues, 'no_tariff'); end if;
  if v_treated = 0 then v_issues := array_append(v_issues, 'no_treated_meter'); end if;
  -- Warning: the closing readings can't have been taken yet.
  if inv.period_end > public.app_today() then v_issues := array_append(v_issues, 'period_not_ended'); end if;

  -- Treated-meter line issues are prefixed so they can block approval.
  v_issues := v_issues || coalesce((
    select array_agg(code order by code) from (
      select distinct case when il.meter = 'treated' then 'treated:' else '' end || x as code
      from public.invoice_line il, unnest(il.issues) x
      where il.invoice_id = p_invoice_id
    ) s
  ), '{}');

  if v_treated = 0 or v_unknown > 0 then v_usage := null; end if;

  update public.invoice
  set treated_usage = v_usage,
      amount = case when v_usage is not null and inv.tariff_rate is not null
                    then round(v_usage * inv.tariff_rate, 2) end,
      issues = v_issues
  where id = p_invoice_id;
end;
$$;

-- The issues of an invoice that stop it being approved.
create function public.billing_blocking_issues(p_issues text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(x), '{}') from unnest(p_issues) x
  where x in ('no_tariff', 'no_treated_meter', 'treated:no_prev_reading', 'treated:no_curr_reading',
              'treated:negative_usage');
$$;

-- ============================================================================
-- billing_generate — draft invoices for a period month
-- ============================================================================
-- Rebuilds the drafts of the given locations (all billed locations when
-- null); a location with an approved invoice for the month is left alone.
create function public.billing_generate(p_period date, p_location_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  v_run uuid;
  v_created integer := 0;
  v_skipped integer := 0;
  loc record;
  m record;
  r record;
  v_invoice uuid;
  v_start date;
  v_end date;
  v_rate numeric;
  v_prev_invoice uuid;
  v_line uuid;
  v_sort integer;
begin
  perform public.require_billing_admin();
  if p_period is null then
    raise exception 'Choose a month to bill.';
  end if;

  insert into public.billing_run (period) values (v_period)
  on conflict (period) do update set generated_at = now(), generated_by = auth.uid()
  returning id into v_run;

  delete from public.invoice
  where billing_run_id = v_run and status = 'draft'
    and (p_location_ids is null or location_id = any (p_location_ids));

  for loc in
    select l.id, l.name, l.billing_day, o.name as organisation, rg.name as region
    from public.location l
    left join public.organisation o on o.id = l.organisation_id
    left join public.region rg on rg.id = l.region_id
    where l.active and l.billing_day is not null
      and (p_location_ids is null or l.id = any (p_location_ids))
    order by l.name
  loop
    if exists (select 1 from public.invoice i
               where i.billing_run_id = v_run and i.location_id = loc.id and i.status = 'approved') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_end := public.billing_date(v_period, loc.billing_day);
    v_start := public.billing_date((v_period - interval '1 month')::date, loc.billing_day);

    select t.rate into v_rate from public.location_tariff t
    where t.location_id = loc.id and t.effective_from <= v_end
    order by t.effective_from desc limit 1;

    insert into public.invoice (billing_run_id, location_id, location_name, organisation_name, region_name,
                                billing_day, period_start, period_end, tariff_rate)
    values (v_run, loc.id, loc.name, loc.organisation, loc.region, loc.billing_day, v_start, v_end, v_rate)
    returning id into v_invoice;

    -- The previous approved invoice, when it ended where this one starts.
    select i.id into v_prev_invoice from public.invoice i
    where i.location_id = loc.id and i.status = 'approved' and i.period_end = v_start
    order by i.approved_at desc limit 1;

    v_sort := 0;
    for m in
      select a.id, a.name, a.code, a.billing_meter
      from public.asset a
      where a.location_id = loc.id and a.active and a.billing_meter is not null
      order by array_position(array['treated', 'borehole', 'electrical']::public.billing_meter[], a.billing_meter), a.name
    loop
      v_sort := v_sort + 1;
      insert into public.invoice_line (invoice_id, asset_id, asset_name, asset_code, meter, sort_order)
      values (v_invoice, m.id, m.name, m.code, m.billing_meter, v_sort)
      returning id into v_line;

      -- Opening reading.
      select pl.curr_value, pl.curr_read_at, pl.curr_value_id, pl.curr_image_path into r
      from public.invoice_line pl
      where pl.invoice_id = v_prev_invoice and pl.asset_id = m.id and pl.curr_value is not null
      limit 1;
      if found then
        update public.invoice_line
        set prev_value = r.curr_value, prev_read_at = r.curr_read_at, prev_value_id = r.curr_value_id,
            prev_image_path = r.curr_image_path, prev_source = 'previous_invoice'
        where id = v_line;
      else
        select * into r from public.billing_readings_near(m.id, v_start, 1);
        if found then
          update public.invoice_line
          set prev_value = r.value, prev_read_at = r.read_at, prev_value_id = r.value_id,
              prev_image_path = r.image_path,
              prev_source = case when abs(r.day_diff) <= 1 then 'window' else 'closest' end
          where id = v_line;
        end if;
      end if;

      -- Closing reading.
      select * into r from public.billing_readings_near(m.id, v_end, 1);
      if found then
        update public.invoice_line
        set curr_value = r.value, curr_read_at = r.read_at, curr_value_id = r.value_id,
            curr_image_path = r.image_path,
            curr_source = case when abs(r.day_diff) <= 1 then 'window' else 'closest' end
        where id = v_line;
      end if;

      perform public.billing_recalc_line(v_line);
    end loop;

    perform public.billing_recalc_invoice(v_invoice);
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('run_id', v_run, 'created', v_created, 'skipped_approved', v_skipped);
end;
$$;

-- ============================================================================
-- Review: change a reading on a draft line
-- ============================================================================
-- p_side 'prev' or 'curr'. With p_value_id, that meter reading is used; with
-- p_manual_value, the typed value (no photo); with neither, the reading the
-- generator would pick is restored.
create function public.billing_set_reading(
  p_line_id uuid,
  p_side text,
  p_value_id uuid default null,
  p_manual_value numeric default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.invoice_line;
  inv public.invoice;
  r record;
  v_value numeric;
  v_at timestamptz;
  v_id uuid;
  v_img text;
  v_source text := 'none';
begin
  perform public.require_billing_admin();
  if p_side not in ('prev', 'curr') then
    raise exception 'Unknown reading side %.', p_side;
  end if;

  select * into l from public.invoice_line where id = p_line_id;
  if not found then raise exception 'Invoice line not found.'; end if;
  select * into inv from public.invoice where id = l.invoice_id for update;
  if inv.status <> 'draft' then
    raise exception 'Only draft invoices can be changed.';
  end if;

  if p_value_id is not null then
    select v.decimal_value, ia.inspection_date, v.id,
           (select ii.storage_path from public.inspection_image ii
            where ii.inspection_value_id = v.id order by ii.created_at, ii.id limit 1)
      into v_value, v_at, v_id, v_img
    from public.inspection_value v
    join public.inspection i on i.id = v.inspection_id and i.value_type = 'CUMULATIVE_VALUE'
    join public.inspection_activity ia on ia.id = v.inspection_activity_id
    where v.id = p_value_id and ia.asset_id = l.asset_id;
    if not found then raise exception 'That reading is not a meter reading of this meter.'; end if;
    v_source := 'selected';
  elsif p_manual_value is not null then
    if coalesce(btrim(p_note), '') = '' then
      raise exception 'Give a reason for a typed reading.';
    end if;
    v_value := p_manual_value;
    v_source := 'manual';
  else
    -- Back to the generator's choice: for the opening reading, the previous
    -- approved invoice's closing reading when it ended on this period's start.
    if p_side = 'prev' then
      select pl.curr_value, pl.curr_read_at, pl.curr_value_id, pl.curr_image_path
        into v_value, v_at, v_id, v_img
      from public.invoice_line pl
      join public.invoice pi on pi.id = pl.invoice_id
      where pi.location_id = inv.location_id and pi.status = 'approved' and pi.period_end = inv.period_start
        and pl.asset_id = l.asset_id and pl.curr_value is not null
      order by pi.approved_at desc limit 1;
      if found then v_source := 'previous_invoice'; end if;
    end if;
    if v_source = 'none' then
      select * into r from public.billing_readings_near(
        l.asset_id, case when p_side = 'prev' then inv.period_start else inv.period_end end, 1);
    end if;
    if v_source = 'none' and found then
      v_value := r.value; v_at := r.read_at; v_id := r.value_id; v_img := r.image_path;
      v_source := case when abs(r.day_diff) <= 1 then 'window' else 'closest' end;
    end if;
  end if;

  if p_side = 'prev' then
    update public.invoice_line
    set prev_value = v_value, prev_read_at = v_at, prev_value_id = v_id, prev_image_path = v_img,
        prev_source = v_source
    where id = p_line_id;
  else
    update public.invoice_line
    set curr_value = v_value, curr_read_at = v_at, curr_value_id = v_id, curr_image_path = v_img,
        curr_source = v_source
    where id = p_line_id;
  end if;

  if p_note is not null then
    update public.invoice_line set note = btrim(p_note) where id = p_line_id;
  end if;

  perform public.billing_recalc_line(p_line_id);
  perform public.billing_recalc_invoice(inv.id);
end;
$$;

-- Readings of a line's meter near one end of its period, for the picker.
create function public.billing_line_readings(p_line_id uuid, p_side text, p_limit integer default 12)
returns table (value_id uuid, value numeric, read_at timestamptz, day_diff integer, image_path text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.invoice_line;
  inv public.invoice;
begin
  perform public.require_billing_admin();
  select * into l from public.invoice_line where id = p_line_id;
  select * into inv from public.invoice where id = l.invoice_id;
  return query
    select * from public.billing_readings_near(
      l.asset_id, case when p_side = 'prev' then inv.period_start else inv.period_end end,
      least(greatest(p_limit, 1), 50));
end;
$$;

-- ============================================================================
-- billing_approve / billing_void
-- ============================================================================
-- Approves the drafts among p_invoice_ids that have no blocking issue;
-- returns how many were approved and why the rest were skipped.
create function public.billing_approve(p_invoice_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  v_blocking text[];
  v_approved integer := 0;
  v_skipped jsonb := '[]';
begin
  perform public.require_billing_admin();

  for inv in
    select * from public.invoice where id = any (p_invoice_ids) order by location_name for update
  loop
    if inv.status <> 'draft' then
      v_skipped := v_skipped || jsonb_build_object('id', inv.id, 'location', inv.location_name,
                                                   'reason', 'already ' || inv.status::text);
      continue;
    end if;
    v_blocking := public.billing_blocking_issues(inv.issues);
    if cardinality(v_blocking) > 0 or inv.amount is null then
      v_skipped := v_skipped || jsonb_build_object('id', inv.id, 'location', inv.location_name,
                                                   'reason', array_to_string(v_blocking, ', '));
      continue;
    end if;

    update public.invoice
    set status = 'approved',
        invoice_no = 'INV-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0'),
        approved_at = now(),
        approved_by = auth.uid()
    where id = inv.id;
    v_approved := v_approved + 1;
  end loop;

  return jsonb_build_object('approved', v_approved, 'skipped', v_skipped);
end;
$$;

create function public.billing_void(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_billing_admin();
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for voiding the invoice.';
  end if;
  update public.invoice
  set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
  where id = p_invoice_id and status = 'approved';
  if not found then
    raise exception 'Only approved invoices can be voided.';
  end if;
end;
$$;

-- ============================================================================
-- Setup: billing day, tariffs and billing meters
-- ============================================================================
create function public.billing_set_location(p_location_id uuid, p_billing_day integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_billing_admin();
  update public.location set billing_day = p_billing_day, updated_at = now(), updated_by = auth.uid()
  where id = p_location_id;
end;
$$;

create function public.billing_set_tariff(p_location_id uuid, p_rate numeric, p_effective_from date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_billing_admin();
  if p_rate is null or p_rate <= 0 then raise exception 'The tariff rate must be more than 0.'; end if;
  if p_effective_from is null then raise exception 'Choose the date the tariff applies from.'; end if;
  insert into public.location_tariff (location_id, rate, effective_from)
  values (p_location_id, p_rate, p_effective_from)
  on conflict (location_id, effective_from) do update set rate = excluded.rate;
end;
$$;

create function public.billing_delete_tariff(p_tariff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_billing_admin();
  delete from public.location_tariff where id = p_tariff_id;
end;
$$;

create function public.billing_set_meter(p_asset_id uuid, p_meter public.billing_meter)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_billing_admin();
  update public.asset set billing_meter = p_meter, updated_at = now(), updated_by = auth.uid()
  where id = p_asset_id;
end;
$$;

-- ============================================================================
-- Backfill: billing meter from the meter's name / asset type, for assets that
-- take meter readings.
-- ============================================================================
update public.asset a
set billing_meter = case
    when a.name ~* 'treated' then 'treated'
    when a.name ~* 'borehole' then 'borehole'
    when a.name ~* 'electric' or at.name ~* 'electric' then 'electrical'
  end::public.billing_meter
from public.asset_type at
where at.id = a.asset_type_id
  and (exists (
         select 1 from public.inspection_allocation ial
         join public.inspection i on i.id = ial.inspection_id
         where ial.asset_type_id = a.asset_type_id and i.value_type = 'CUMULATIVE_VALUE')
       or exists (
         select 1 from public.inspection_activity ia
         join public.inspection_value v on v.inspection_activity_id = ia.id
         join public.inspection i on i.id = v.inspection_id
         where ia.asset_id = a.id and i.value_type = 'CUMULATIVE_VALUE'))
  and (a.name ~* 'treated|borehole|electric' or at.name ~* 'electric');

-- ============================================================================
-- RLS: system admins and admins read; all writes go through the functions.
-- ============================================================================
alter table public.location_tariff enable row level security;
alter table public.billing_run enable row level security;
alter table public.invoice enable row level security;
alter table public.invoice_line enable row level security;

create policy location_tariff_select on public.location_tariff for select
  to authenticated using ((select public.is_billing_admin()));
create policy billing_run_select on public.billing_run for select
  to authenticated using ((select public.is_billing_admin()));
create policy invoice_select on public.invoice for select
  to authenticated using ((select public.is_billing_admin()));
create policy invoice_line_select on public.invoice_line for select
  to authenticated using ((select public.is_billing_admin()));

revoke insert, update, delete on public.location_tariff, public.billing_run, public.invoice, public.invoice_line
  from anon, authenticated;

revoke execute on function public.billing_readings_near(uuid, date, integer) from public, anon, authenticated;
revoke execute on function public.billing_recalc_line(uuid) from public, anon, authenticated;
revoke execute on function public.billing_recalc_invoice(uuid) from public, anon, authenticated;
revoke execute on function public.billing_generate(date, uuid[]) from public, anon;
revoke execute on function public.billing_set_reading(uuid, text, uuid, numeric, text) from public, anon;
revoke execute on function public.billing_line_readings(uuid, text, integer) from public, anon;
revoke execute on function public.billing_approve(uuid[]) from public, anon;
revoke execute on function public.billing_void(uuid, text) from public, anon;
revoke execute on function public.billing_set_location(uuid, integer) from public, anon;
revoke execute on function public.billing_set_tariff(uuid, numeric, date) from public, anon;
revoke execute on function public.billing_delete_tariff(uuid) from public, anon;
revoke execute on function public.billing_set_meter(uuid, public.billing_meter) from public, anon;
