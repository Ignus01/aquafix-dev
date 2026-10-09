-- Logger data: readings pulled from the Hydrus logger API for every active
-- asset with a HYDRUS logger code.
--
--   * pg_cron starts a run daily at 06:00 SAST for the 24 hours before it.
--   * A system admin can start a manual run (Admin → Logger Data) for up to
--     7 days, for all loggers or selected assets.
--   * A run queues one logger_pull_result per logger. The logger-worker Edge
--     Function claims them, calls the Hydrus API and records the readings,
--     the same outbox pattern as email-worker: kicked through pg_net right
--     after the run is committed, and every minute by pg_cron while anything
--     is due (transient failures retry after 1 and 5 minutes).
--   * A reading is keyed on logger code + timestamp; pulling it again
--     overwrites it.
--
-- Hydrus reports reading times without a zone; they are SAST
-- (Africa/Johannesburg), as the API document's own example shows.
--
-- Needs the Vault secret `project_url` (see supabase/README.md) to reach the
-- worker; `logger_worker_secret` is created here.

-- ============================================================================
-- Asset: logger type, required whenever a logger code is set
-- ============================================================================
create type public.logger_type as enum ('HYDRUS', 'DATAV8');

alter table public.asset add column logger_type public.logger_type;

-- Logger codes entered before the type existed are all Hydrus loggers.
update public.asset set logger_type = 'HYDRUS' where logger_code is not null;

alter table public.asset
  add constraint asset_logger_type_with_code check ((logger_code is null) = (logger_type is null));

-- ============================================================================
-- System settings: the Hydrus API password (one for every logger). It lives
-- in Vault; only its id and when it changed are kept here. Not set means the
-- API is called with an empty password, the Hydrus default.
-- ============================================================================
alter table public.system_settings
  add column hydrus_secret_id uuid,
  add column hydrus_password_changed_at timestamptz,
  add column hydrus_password_changed_by uuid references auth.users (id) on delete set null;

create function public.set_hydrus_password(p_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
begin
  perform public.require_system_admin();

  if coalesce(btrim(p_password), '') = '' then
    raise exception using errcode = 'P0001', message = 'Enter the password.';
  end if;

  select hydrus_secret_id into v_secret_id from public.system_settings where id = 1 for update;
  if v_secret_id is null then
    select id into v_secret_id from vault.secrets where name = 'hydrus_api_password';
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_password, 'hydrus_api_password', 'Hydrus logger API password');
  else
    perform vault.update_secret(v_secret_id, p_password);
  end if;

  update public.system_settings set
    hydrus_secret_id = v_secret_id,
    hydrus_password_changed_at = now(),
    hydrus_password_changed_by = auth.uid(),
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1;

  insert into public.settings_audit (changed_by, field, new_value)
  values (auth.uid(), 'hydrus_password', 'password replaced');
end;
$$;

create function public.remove_hydrus_password()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
begin
  perform public.require_system_admin();

  select hydrus_secret_id into v_secret_id from public.system_settings where id = 1 for update;
  if v_secret_id is null then
    return;
  end if;

  delete from vault.secrets where id = v_secret_id;

  update public.system_settings set
    hydrus_secret_id = null,
    hydrus_password_changed_at = now(),
    hydrus_password_changed_by = auth.uid(),
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1;

  insert into public.settings_audit (changed_by, field, new_value)
  values (auth.uid(), 'hydrus_password', 'password removed');
end;
$$;

revoke execute on function public.set_hydrus_password(text) from public, anon;
grant execute on function public.set_hydrus_password(text) to authenticated;
revoke execute on function public.remove_hydrus_password() from public, anon;
grant execute on function public.remove_hydrus_password() to authenticated;

-- ============================================================================
-- logger_pull_run — one daily or manual pull over a time range
-- ============================================================================
create table public.logger_pull_run (
  id bigint generated always as identity primary key,
  trigger text not null,
  logger_type public.logger_type not null default 'HYDRUS',
  range_start timestamptz not null,
  range_end timestamptz not null,
  -- Manual runs: the admin who started it, and the assets they picked
  -- (null = all loggers).
  requested_by uuid references auth.users (id) on delete set null,
  asset_ids uuid[],
  created_at timestamptz not null default now(),
  -- Set when no logger in the run is still pending.
  finished_at timestamptz,
  constraint logger_pull_run_trigger_check check (trigger in ('cron', 'manual')),
  constraint logger_pull_run_range_check check (range_end > range_start)
);

-- One daily run per window, however often the job fires.
create unique index logger_pull_run_cron_range_key on public.logger_pull_run (range_end)
  where trigger = 'cron';
create index logger_pull_run_created_at_idx on public.logger_pull_run (created_at desc);

-- ============================================================================
-- logger_pull_result — one logger in a run: the worker's queue and its log
-- ============================================================================
create table public.logger_pull_result (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.logger_pull_run (id) on delete cascade,
  asset_id uuid references public.asset (id) on delete set null,
  logger_code text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  readings_saved integer,
  unit text,
  http_status integer,
  error text,
  constraint logger_pull_result_status_check check (status in ('pending', 'running', 'success', 'failed')),
  constraint logger_pull_result_run_logger_key unique (run_id, logger_code)
);

create index logger_pull_result_due_idx on public.logger_pull_result (next_attempt_at)
  where status in ('pending', 'running');

-- ============================================================================
-- logger_reading — the data. One row per logger code + reading time.
-- ============================================================================
create table public.logger_reading (
  id bigint generated always as identity primary key,
  asset_id uuid not null references public.asset (id) on delete restrict,
  logger_type public.logger_type not null,
  logger_code text not null,
  reading_at timestamptz not null,
  value numeric not null,
  -- The logger's measured parameter when it was pulled (e.g. kPa).
  unit text,
  run_id bigint references public.logger_pull_run (id) on delete set null,
  pulled_at timestamptz not null default now(),
  constraint logger_reading_logger_time_key unique (logger_code, reading_at)
);

create index logger_reading_asset_time_idx on public.logger_reading (asset_id, reading_at desc);
create index logger_reading_time_idx on public.logger_reading (reading_at desc);

-- ============================================================================
-- RLS — readable by system_admin only; every write goes through the
-- functions below.
-- ============================================================================
alter table public.logger_pull_run enable row level security;
alter table public.logger_pull_result enable row level security;
alter table public.logger_reading enable row level security;

create policy logger_pull_run_select on public.logger_pull_run for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin']::public.masterdata_role[]));
create policy logger_pull_result_select on public.logger_pull_result for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin']::public.masterdata_role[]));
create policy logger_reading_select on public.logger_reading for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin']::public.masterdata_role[]));

revoke insert, update, delete on public.logger_pull_run from anon, authenticated;
revoke insert, update, delete on public.logger_pull_result from anon, authenticated;
revoke insert, update, delete on public.logger_reading from anon, authenticated;

-- Runs with their progress, for the run log.
create view public.logger_pull_run_overview
with (security_invoker = true)
as
select
  r.*,
  coalesce(c.loggers, 0) as loggers,
  coalesce(c.pending, 0) as pending,
  coalesce(c.succeeded, 0) as succeeded,
  coalesce(c.failed, 0) as failed,
  coalesce(c.readings_saved, 0) as readings_saved,
  case
    when coalesce(c.loggers, 0) = 0 then 'no_loggers'
    when c.pending > 0 then 'running'
    when c.failed = 0 then 'success'
    when c.succeeded = 0 then 'failed'
    else 'partial'
  end as status
from public.logger_pull_run r
left join lateral (
  select
    count(*)::integer as loggers,
    (count(*) filter (where status in ('pending', 'running')))::integer as pending,
    (count(*) filter (where status = 'success'))::integer as succeeded,
    (count(*) filter (where status = 'failed'))::integer as failed,
    coalesce(sum(readings_saved), 0)::integer as readings_saved
  from public.logger_pull_result
  where run_id = r.id
) c on true;

grant select on public.logger_pull_run_overview to authenticated;

-- ============================================================================
-- Kicking the worker (same mechanism as kick_email_worker)
-- ============================================================================
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'logger_worker_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'logger_worker_secret',
      'Shared secret the database sends to the logger-worker Edge Function'
    );
  end if;
end;
$$;

create function public.kick_logger_worker()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'logger_worker_secret';
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := regexp_replace(v_url, '/+$', '') || '/functions/v1/logger-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;

create function public.kick_logger_worker_if_due()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.logger_pull_result
    where (status = 'pending' and next_attempt_at <= now())
       or (status = 'running' and claimed_at < now() - interval '5 minutes')
  ) then
    perform public.kick_logger_worker();
  end if;
end;
$$;

revoke execute on function public.kick_logger_worker() from public, anon, authenticated;
revoke execute on function public.kick_logger_worker_if_due() from public, anon, authenticated;

-- ============================================================================
-- Starting a run
-- ============================================================================

-- Queues every active asset with a logger code of the run's type (or only
-- the given assets) and kicks the worker. Returns the number queued.
create function public.queue_logger_pull(p_run_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.logger_pull_run;
  v_count integer;
begin
  select * into v_run from public.logger_pull_run where id = p_run_id;

  insert into public.logger_pull_result (run_id, asset_id, logger_code)
  select v_run.id, a.id, a.logger_code
  from public.asset a
  where a.logger_type = v_run.logger_type
    and a.logger_code is not null
    and a.active
    and (v_run.asset_ids is null or a.id = any (v_run.asset_ids))
  on conflict (run_id, logger_code) do nothing;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    update public.logger_pull_run set finished_at = now() where id = v_run.id;
  else
    perform public.kick_logger_worker();
  end if;
  return v_count;
end;
$$;

revoke execute on function public.queue_logger_pull(bigint) from public, anon, authenticated;

-- The daily run: the 24 hours up to 06:00 SAST today.
create function public.run_daily_logger_pull()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_end timestamptz :=
    ((now() at time zone 'Africa/Johannesburg')::date + time '06:00') at time zone 'Africa/Johannesburg';
  v_run_id bigint;
begin
  if v_end > now() then
    v_end := v_end - interval '1 day';
  end if;

  insert into public.logger_pull_run (trigger, range_start, range_end)
  values ('cron', v_end - interval '24 hours', v_end)
  on conflict (range_end) where trigger = 'cron' do nothing
  returning id into v_run_id;

  if v_run_id is not null then
    perform public.queue_logger_pull(v_run_id);
  end if;
end;
$$;

revoke execute on function public.run_daily_logger_pull() from public, anon, authenticated;

-- A manual pull by a system admin: at most 7 days, all loggers or the given
-- assets (each must be an active Hydrus logger). Returns the run id.
create function public.request_logger_pull(
  p_start timestamptz,
  p_end timestamptz,
  p_asset_ids uuid[] default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := case when cardinality(p_asset_ids) > 0 then p_asset_ids end;
  v_bad text;
  v_run_id bigint;
begin
  if not public.has_masterdata_role(array['system_admin']::public.masterdata_role[]) then
    raise exception using errcode = '42501', message = 'Only system admins can pull logger data.';
  end if;

  if p_start is null or p_end is null then
    raise exception using errcode = 'P0001', message = 'Choose a start and an end time.';
  end if;
  if p_end <= p_start then
    raise exception using errcode = 'P0001', message = 'The end time must be after the start time.';
  end if;
  if p_end - p_start > interval '7 days' then
    raise exception using errcode = 'P0001', message = 'A pull can cover at most 7 days.';
  end if;
  if p_start >= now() then
    raise exception using errcode = 'P0001', message = 'The start time must be in the past.';
  end if;

  if v_ids is not null then
    select string_agg(coalesce(a.name, 'an unknown asset'), ', ') into v_bad
    from unnest(v_ids) as picked (id)
    left join public.asset a on a.id = picked.id
    where a.id is null or a.logger_type is distinct from 'HYDRUS' or a.logger_code is null or not a.active;
    if v_bad is not null then
      raise exception using errcode = 'P0001',
        message = 'Not an active Hydrus logger: ' || v_bad || '.';
    end if;
  end if;

  insert into public.logger_pull_run (trigger, range_start, range_end, requested_by, asset_ids)
  values ('manual', p_start, p_end, auth.uid(), v_ids)
  returning id into v_run_id;

  if public.queue_logger_pull(v_run_id) = 0 then
    raise exception using errcode = 'P0001', message = 'There are no active Hydrus loggers to pull.';
  end if;
  return v_run_id;
end;
$$;

revoke execute on function public.request_logger_pull(timestamptz, timestamptz, uuid[]) from public, anon;
grant execute on function public.request_logger_pull(timestamptz, timestamptz, uuid[]) to authenticated;

-- ============================================================================
-- Worker RPCs — service role only (the logger-worker Edge Function)
-- ============================================================================
create function public.logger_worker_secret_matches(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'logger_worker_secret'
      and decrypted_secret = p_secret
      and coalesce(p_secret, '') <> ''
  );
$$;

create function public.get_logger_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'hydrus_password',
    coalesce((select decrypted_secret from vault.decrypted_secrets where id = s.hydrus_secret_id), '')
  )
  from public.system_settings s
  where s.id = 1;
$$;

create function public.finish_logger_pull_run_if_done(p_run_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.logger_pull_run set finished_at = now()
  where id = p_run_id
    and finished_at is null
    and not exists (
      select 1 from public.logger_pull_result
      where run_id = p_run_id and status in ('pending', 'running')
    );
$$;

-- Claims due loggers (and ones stuck in `running` after a crashed worker)
-- without blocking a concurrent worker. A logger stuck on its last attempt
-- is failed instead of claimed again.
create function public.claim_logger_pull_results(p_limit integer default 5)
returns table (
  id bigint,
  run_id bigint,
  logger_type public.logger_type,
  logger_code text,
  range_start bigint,
  range_end bigint,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_run_id bigint;
begin
  for v_run_id in
    update public.logger_pull_result set
      status = 'failed',
      finished_at = now(),
      error = 'The worker stopped before this logger finished.'
    where status = 'running'
      and claimed_at < now() - interval '5 minutes'
      and logger_pull_result.attempts >= 3
    returning logger_pull_result.run_id
  loop
    perform public.finish_logger_pull_run_if_done(v_run_id);
  end loop;

  return query
  with claimed as (
    update public.logger_pull_result res set
      status = 'running',
      attempts = res.attempts + 1,
      claimed_at = now()
    where res.id in (
      select r.id
      from public.logger_pull_result r
      where (r.status = 'pending' and r.next_attempt_at <= now())
         or (r.status = 'running' and r.claimed_at < now() - interval '5 minutes')
      order by r.next_attempt_at, r.id
      limit p_limit
      for update skip locked
    )
    returning res.*
  )
  select
    c.id,
    c.run_id,
    run.logger_type,
    c.logger_code,
    extract(epoch from run.range_start)::bigint,
    extract(epoch from run.range_end)::bigint,
    c.attempts
  from claimed c
  join public.logger_pull_run run on run.id = c.run_id;
end;
$$;

-- `YYYY-MM-DD HH:MM[:SS]` that is a real date and time.
create function public.is_hydrus_timestamp(p_value text)
returns boolean
language plpgsql
immutable
as $$
begin
  if btrim(coalesce(p_value, '')) !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$' then
    return false;
  end if;
  perform btrim(p_value)::timestamp;
  return true;
exception when others then
  return false;
end;
$$;

-- Records one logger's outcome.
--   'success' → saves p_readings ([{reading, reading_timestamp}, …] as the
--               API returns them), overwriting readings already stored for
--               the same logger and time. Readings with a value or time that
--               can't be read are skipped and counted in `error`.
--   'retry'   → network error / 5xx: pending again after 1, then 5 minutes;
--               failed after the 3rd attempt.
--   'failed'  → permanent (logger code or password rejected, bad response).
-- Returns the number of readings saved.
create function public.record_logger_pull_result(
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
  select logger_type into v_type from public.logger_pull_run where id = v_row.run_id;

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

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.logger_worker_secret_matches(text)',
    'public.get_logger_config()',
    'public.finish_logger_pull_run_if_done(bigint)',
    'public.claim_logger_pull_results(integer)',
    'public.record_logger_pull_result(bigint, text, text, jsonb, integer, text)',
    'public.is_hydrus_timestamp(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- ============================================================================
-- Schedules. pg_cron runs in UTC: 04:00 UTC is 06:00 SAST (no daylight
-- saving in South Africa).
-- ============================================================================
select cron.schedule('logger-daily-pull', '0 4 * * *', $$select public.run_daily_logger_pull()$$);
select cron.schedule('logger-worker', '* * * * *', $$select public.kick_logger_worker_if_due()$$);
