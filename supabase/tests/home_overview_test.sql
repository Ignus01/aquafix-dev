-- Tests for the Home → Overview functions: overview_attention(),
-- overview_extras() and overview_sites() (counts, water against target and
-- limit, and what each role may see).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ============================================================================
-- Setup: everything sits in its own region, and every call filters on it, so
-- rows already in the database don't count.
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-0e11-000000000001', '00000000-0000-0000-0e11-000000000000', 'authenticated', 'authenticated',
   'ov-sysadmin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-0e11-000000000002', '00000000-0000-0000-0e11-000000000000', 'authenticated', 'authenticated',
   'ov-admin@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-0e11-000000000003', '00000000-0000-0000-0e11-000000000000', 'authenticated', 'authenticated',
   'ov-viewer@example.test', '', now(), now(), now()),
  ('10000000-0000-0000-0e11-000000000004', '00000000-0000-0000-0e11-000000000000', 'authenticated', 'authenticated',
   'ov-norole@example.test', '', now(), now(), now());
insert into public.user_masterdata_roles (user_id, role) values
  ('10000000-0000-0000-0e11-000000000001', 'system_admin'),
  ('10000000-0000-0000-0e11-000000000002', 'admin'),
  ('10000000-0000-0000-0e11-000000000003', 'viewer');

create function pg_temp.as_user(p_n integer) returns void
language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub": "10000000-0000-0000-0e11-00000000000%s", "role": "authenticated"}', p_n), true);
$$;

insert into public.region (id, name) values ('a0000000-0000-0000-0e11-000000000001', 'OV-Region');
insert into public.organisation (id, name) values ('a1000000-0000-0000-0e11-000000000001', 'OV-ORG');
-- A: a target of 100 m³ a day with the default bands. B: nothing set.
insert into public.location (id, name, region_id, organisation_id, active, volume_target) values
  ('a2000000-0000-0000-0e11-00000000000a', 'OV-A', 'a0000000-0000-0000-0e11-000000000001', 'a1000000-0000-0000-0e11-000000000001', true, 100),
  ('a2000000-0000-0000-0e11-00000000000b', 'OV-B', 'a0000000-0000-0000-0e11-000000000001', 'a1000000-0000-0000-0e11-000000000001', true, null);
insert into public.location_target_band (location_id, from_pct, colour) values
  ('a2000000-0000-0000-0e11-00000000000a', 110, 'blue'),
  ('a2000000-0000-0000-0e11-00000000000a', 90, 'green'),
  ('a2000000-0000-0000-0e11-00000000000a', 80, 'orange'),
  ('a2000000-0000-0000-0e11-00000000000a', 0, 'red');

insert into public.asset_type (id, name, classification) values
  ('a3000000-0000-0000-0e11-000000000001', 'OV-Treated', 'TREATED_METER'),
  ('a3000000-0000-0000-0e11-000000000002', 'OV-Borehole', 'BOREHOLE_METER'),
  ('a3000000-0000-0000-0e11-000000000003', 'OV-Pump', 'OTHER');
-- Only pumps have an inspection set up.
insert into public.inspection (id, name, value_type, is_required, nr_of_images_required) values
  ('40000000-0000-0000-0e11-000000000001', 'OV-Check', 'DECIMAL_VALUE', true, 0);
insert into public.inspection_allocation (inspection_id, asset_type_id, priority) values
  ('40000000-0000-0000-0e11-000000000001', 'a3000000-0000-0000-0e11-000000000003', 1);

insert into public.asset (id, name, code, asset_type_id, location_id, active, logger_code, logger_type, usage_limit) values
  ('30000000-0000-0000-0e11-0000000000a1', 'OV Treated', 'OV-T1', 'a3000000-0000-0000-0e11-000000000001', 'a2000000-0000-0000-0e11-00000000000a', true, 'OV-L1', 'HYDRUS', null),
  ('30000000-0000-0000-0e11-0000000000a2', 'OV Borehole', 'OV-BH', 'a3000000-0000-0000-0e11-000000000002', 'a2000000-0000-0000-0e11-00000000000a', true, 'OV-L2', 'HYDRUS', 50),
  ('30000000-0000-0000-0e11-0000000000a3', 'OV Pump A', 'OV-PA', 'a3000000-0000-0000-0e11-000000000003', 'a2000000-0000-0000-0e11-00000000000a', true, null, null, null),
  ('30000000-0000-0000-0e11-0000000000b1', 'OV Pump B', 'OV-PB', 'a3000000-0000-0000-0e11-000000000003', 'a2000000-0000-0000-0e11-00000000000b', true, null, null, null);

-- The last 7 complete days: treated 50 a day (50% of target, red) and
-- borehole 60 a day (120% of the limit).
insert into public.logger_daily_usage (asset_id, day, usage, status)
select a.id, public.app_today() - g, a.usage, 'ok'
from (values
  ('30000000-0000-0000-0e11-0000000000a1'::uuid, 50),
  ('30000000-0000-0000-0e11-0000000000a2'::uuid, 60)
) a(id, usage)
cross join generate_series(1, 7) g;

-- One incident open for 20 days, one logged today.
insert into public.incident_type (id, name) values ('a5000000-0000-0000-0e11-000000000001', 'OV-Leak');
insert into public.incident (comment, location_id, incident_type_id, created_by, incident_date) values
  ('OV old', 'a2000000-0000-0000-0e11-00000000000a', 'a5000000-0000-0000-0e11-000000000001',
   '10000000-0000-0000-0e11-000000000001', now() - interval '20 days'),
  ('OV new', 'a2000000-0000-0000-0e11-00000000000b', 'a5000000-0000-0000-0e11-000000000001',
   '10000000-0000-0000-0e11-000000000001', now());

-- Pump A: a service completed two days ago, before it was due, and an open
-- one ten days overdue.
insert into public.service (asset_id, service_type, due_date, is_completed, completed_date, supplier_id,
                            total_part_cost, total_labour_cost) values
  ('30000000-0000-0000-0e11-0000000000a3', 'repair', now() + interval '1 day', true, now() - interval '2 days',
   'a1000000-0000-0000-0e11-000000000001', 100, 50),
  ('30000000-0000-0000-0e11-0000000000a3', 'scheduled_maintenance', now() - interval '10 days', false, null,
   null, 0, 0);

-- The latest billing run, with one draft invoice.
insert into public.billing_run (id, period) values ('b1000000-0000-0000-0e11-000000000001', '2099-01-01');
insert into public.invoice (billing_run_id, location_id, location_name, status, billing_day, period_start, period_end,
                            treated_usage, amount) values
  ('b1000000-0000-0000-0e11-000000000001', 'a2000000-0000-0000-0e11-00000000000a', 'OV-A', 'draft', 1,
   '2098-12-01', '2099-01-01', 10, 500);

create function pg_temp.attention() returns jsonb
language sql as $$
  select public.overview_attention('a0000000-0000-0000-0e11-000000000001');
$$;
create function pg_temp.extras() returns jsonb
language sql as $$
  select public.overview_extras(public.app_today() - 6, public.app_today(), 'a0000000-0000-0000-0e11-000000000001');
$$;
create function pg_temp.sites() returns jsonb
language sql as $$
  select public.overview_sites(public.app_today() - 6, public.app_today(), 'a0000000-0000-0000-0e11-000000000001');
$$;
create function pg_temp.site(p_sites jsonb, p_id text) returns jsonb
language sql as $$
  select s from jsonb_array_elements(p_sites -> 'sites') s where s ->> 'id' = p_id;
$$;

set local role authenticated;

-- ============================================================================
-- overview_attention
-- ============================================================================
select pg_temp.as_user(1);
select is((pg_temp.attention() ->> 'stale_incidents')::int, 1, 'only the incident open 14+ days is stale');
select is((pg_temp.attention() ->> 'services_overdue')::int, 1, 'the open service past its due date is overdue');
select is((pg_temp.attention() ->> 'uninspected_assets')::int, 2,
  'assets with inspections set up and none captured count; meters without inspections do not');
select is((pg_temp.attention() ->> 'borehole_over_sites')::int, 1, 'a site averaging above its borehole limit');
select is((pg_temp.attention() ->> 'target_red_sites')::int, 1, 'a site averaging in its red band');
select is((pg_temp.attention() ->> 'lab_out_sites')::int, 0, 'no lab samples, no sites out of limits');
select is((pg_temp.attention() ->> 'silent_loggers')::int, 0, 'a logger that never sent a reading is not silent');
select is((pg_temp.attention() ->> 'draft_invoices')::int, 1, 'system admins see draft invoices');
select is(public.overview_attention('a0000000-0000-0000-0e11-0000000000ff') ->> 'stale_incidents', '0',
  'the region filter applies');

select pg_temp.as_user(2);
select is((pg_temp.attention() ->> 'borehole_over_sites')::int, 1, 'admins see water');
select is(pg_temp.attention() ->> 'silent_loggers', null, 'admins do not see loggers');
select is((pg_temp.attention() ->> 'draft_invoices')::int, 1, 'admins see billing');

select pg_temp.as_user(3);
select is((pg_temp.attention() ->> 'stale_incidents')::int, 1, 'viewers see incidents');
select is(pg_temp.attention() ->> 'borehole_over_sites', null, 'viewers do not see water');
select is(pg_temp.attention() ->> 'target_red_sites', null, 'viewers do not see the water target');
select is(pg_temp.attention() ->> 'draft_invoices', null, 'viewers do not see billing');

select pg_temp.as_user(4);
select throws_ok('select public.overview_attention()', '42501', null, 'a user without a role is refused');
select throws_ok('select pg_temp.extras()', '42501', null, 'extras: a user without a role is refused');
select throws_ok('select pg_temp.sites()', '42501', null, 'sites: a user without a role is refused');

-- ============================================================================
-- overview_extras
-- ============================================================================
select pg_temp.as_user(1);
select is(pg_temp.extras() -> 'services',
  '{"overdue": 1, "due_soon": 0, "completed": 1, "on_time": 1, "parts": 100.00, "labour": 50.00, "prev_spend": 0}'::jsonb,
  'service figures for the period');
select is(jsonb_array_length(pg_temp.extras() -> 'series'), 7, 'a 7-day period has 7 daily points');
select is((select sum((p ->> 'parts')::numeric + (p ->> 'labour')::numeric)
           from jsonb_array_elements(pg_temp.extras() -> 'series') p), 150::numeric,
  'the series adds up to the spend');
select is(jsonb_array_length(pg_temp.extras() -> 'service_queue'), 1, 'the overdue service is queued');
select is(pg_temp.extras() -> 'service_queue' -> 0 ->> 'asset', 'OV Pump A', 'with its asset');
-- Today has no usage yet, so the period has 6 days with a figure.
select is(pg_temp.extras() -> 'water', '{"sites": 1, "days": 6, "days_on": 0}'::jsonb, 'days on target');
select is(pg_temp.extras() -> 'quality', '{"checked": 0, "ok": 0}'::jsonb, 'no lab results');
select is(pg_temp.extras() -> 'billing' ->> 'drafts', '1', 'the latest run''s drafts');
select is((pg_temp.extras() -> 'billing' ->> 'amount')::numeric, 500::numeric, 'and its amount');

select pg_temp.as_user(3);
select is(pg_temp.extras() ->> 'water', null, 'viewers get no water figures');
select is(pg_temp.extras() ->> 'billing', null, 'viewers get no billing figures');
select is((pg_temp.extras() -> 'services' ->> 'overdue')::int, 1, 'viewers see services');

-- ============================================================================
-- overview_sites
-- ============================================================================
select pg_temp.as_user(1);
select is(jsonb_array_length(pg_temp.sites() -> 'sites'), 2, 'one entry per active site in the region');
select is(pg_temp.sites() -> 'access', '{"water": true, "loggers": true}'::jsonb, 'system admins see every column');
select is(pg_temp.site(pg_temp.sites(), 'a2000000-0000-0000-0e11-00000000000a') -> 'target',
  '{"pct": 50.0, "colour": "red", "days": 6, "days_on": 0}'::jsonb, 'treated water against the target');
select is(pg_temp.site(pg_temp.sites(), 'a2000000-0000-0000-0e11-00000000000a') -> 'borehole',
  '{"pct": 120.0, "days": 6, "days_over": 6}'::jsonb, 'borehole usage against the limit');
select is((pg_temp.site(pg_temp.sites(), 'a2000000-0000-0000-0e11-00000000000a') ->> 'services_overdue')::int, 1,
  'overdue services per site');
select is((pg_temp.site(pg_temp.sites(), 'a2000000-0000-0000-0e11-00000000000a') ->> 'loggers')::int, 2,
  'active loggers per site');
select is((pg_temp.site(pg_temp.sites(), 'a2000000-0000-0000-0e11-00000000000a') ->> 'loggers_silent')::int, 0,
  'none silent: neither has sent a reading');
select is(pg_temp.site(pg_temp.sites(), 'a2000000-0000-0000-0e11-00000000000b') ->> 'target', null,
  'a site without a target has no target figure');

select pg_temp.as_user(2);
select is(pg_temp.sites() -> 'access', '{"water": true, "loggers": false}'::jsonb, 'admins see water, not loggers');
select is(pg_temp.site(pg_temp.sites(), 'a2000000-0000-0000-0e11-00000000000a') ->> 'loggers', null,
  'so no logger counts');

select pg_temp.as_user(3);
select is(pg_temp.sites() -> 'access', '{"water": false, "loggers": false}'::jsonb, 'viewers see neither');
select is(pg_temp.site(pg_temp.sites(), 'a2000000-0000-0000-0e11-00000000000a') ->> 'target', null,
  'so no water figures');
select is((pg_temp.site(pg_temp.sites(), 'a2000000-0000-0000-0e11-00000000000a') ->> 'services_overdue')::int, 1,
  'but services');

select * from finish();
rollback;
