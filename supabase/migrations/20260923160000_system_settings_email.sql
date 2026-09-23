-- System Settings (Brevo API key, sender, app URL, time zone, VAT) and the
-- incident notification pipeline: transactional outbox → email-worker Edge
-- Function → Brevo → email_log.
-- See spec/incidents/system-settings.md (SET-R*) and
-- spec/incidents/email-notifications.md (EML-R*).
--
-- One-time setup after this migration (see supabase/README.md): store the
-- project URL in Vault as `project_url` so the database can reach the
-- email-worker function. Until then emails stay queued.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ============================================================================
-- system_settings — exactly one row (SET-R01)
-- ============================================================================
create table public.system_settings (
  id smallint primary key default 1,
  email_enabled boolean not null default false,
  -- SET-R02: the key itself lives in Supabase Vault; only its id, last four
  -- characters and check status are kept here.
  brevo_secret_id uuid,
  brevo_key_last4 text,
  brevo_key_status text not null default 'not_configured',
  brevo_key_checked_at timestamptz,
  -- Company name or email Brevo reports for the key (SET-R04 confirmation).
  brevo_key_account text,
  brevo_key_changed_at timestamptz,
  brevo_key_changed_by uuid references auth.users (id) on delete set null,
  sender_name text not null default 'AquaFix',
  sender_email text,
  reply_to_email text,
  -- SET-R07: stored without a trailing slash.
  app_url text,
  time_zone text not null default 'Africa/Johannesburg',
  -- SET-R11: stored as a fraction (15 % → 0.15), as in Mendix ClientConfig.
  vat_rate numeric(5, 4) not null default 0.15,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint system_settings_singleton check (id = 1),
  constraint system_settings_brevo_key_status_check
    check (brevo_key_status in ('not_configured', 'valid', 'invalid', 'unknown')),
  constraint system_settings_vat_rate_check check (vat_rate between 0 and 1)
);

insert into public.system_settings (id) values (1);

alter table public.system_settings enable row level security;

-- SET-R10: who changed what. The API key's value is never recorded.
create table public.settings_audit (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users (id) on delete set null,
  field text not null,
  old_value text,
  new_value text
);

create index settings_audit_changed_at_idx on public.settings_audit (changed_at desc);

alter table public.settings_audit enable row level security;

-- Readable by system_admin only; every write goes through the RPCs below.
create policy system_settings_select on public.system_settings for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin']::public.masterdata_role[]));

create policy settings_audit_select on public.settings_audit for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin']::public.masterdata_role[]));

revoke insert, update, delete on public.system_settings from anon, authenticated;
revoke insert, update, delete on public.settings_audit from anon, authenticated;

-- The two settings other roles need, without exposing the row.
create function public.app_time_zone()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select time_zone from public.system_settings where id = 1), 'Africa/Johannesburg');
$$;

-- Stock pricing reads the VAT rate through this (SET-R11 / spec "Storage").
create function public.get_vat_rate()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select vat_rate from public.system_settings where id = 1;
$$;

revoke execute on function public.app_time_zone() from public, anon;
grant execute on function public.app_time_zone() to authenticated;
revoke execute on function public.get_vat_rate() from public, anon;
grant execute on function public.get_vat_rate() to authenticated;

create function public.require_system_admin()
returns void
language plpgsql
stable
as $$
begin
  if not public.has_masterdata_role(array['system_admin']::public.masterdata_role[]) then
    raise exception using errcode = '42501', message = 'Only system admins can change system settings.';
  end if;
end;
$$;

-- ============================================================================
-- update_system_settings — the non-secret fields (SET-R06..R08, R10, R11)
-- ============================================================================
create function public.update_system_settings(
  p_email_enabled boolean,
  p_sender_name text,
  p_sender_email text,
  p_reply_to_email text,
  p_app_url text,
  p_time_zone text,
  p_vat_percent numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.system_settings;
  v_new public.system_settings;
  v_missing text[] := '{}';
  v_field text;
  v_email_re constant text := '^[^@\s]+@[^@\s]+\.[^@\s]+$';
begin
  perform public.require_system_admin();

  select * into v_old from public.system_settings where id = 1 for update;
  v_new := v_old;

  v_new.sender_name := coalesce(nullif(btrim(p_sender_name), ''), 'AquaFix');
  v_new.sender_email := nullif(lower(btrim(coalesce(p_sender_email, ''))), '');
  v_new.reply_to_email := nullif(lower(btrim(coalesce(p_reply_to_email, ''))), '');
  -- SET-R07: no trailing slash; the email builder adds the path.
  v_new.app_url := nullif(regexp_replace(btrim(coalesce(p_app_url, '')), '/+$', ''), '');
  v_new.time_zone := btrim(coalesce(p_time_zone, ''));
  v_new.email_enabled := coalesce(p_email_enabled, false);

  -- SET-R06
  if v_new.sender_email is not null and v_new.sender_email !~ v_email_re then
    raise exception using errcode = 'P0001', message = 'Sender email must be a valid email address.';
  end if;
  if v_new.reply_to_email is not null and v_new.reply_to_email !~ v_email_re then
    raise exception using errcode = 'P0001', message = 'Reply-to email must be a valid email address.';
  end if;
  -- SET-R07. Whether localhost is allowed depends on the environment, which
  -- the app checks; the database only allows https or a localhost URL.
  if v_new.app_url is not null
    and v_new.app_url !~ '^https://[^/\s]+(/\S*)?$'
    and v_new.app_url !~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?(/\S*)?$' then
    raise exception using errcode = 'P0001', message = 'App URL must be an absolute https:// URL.';
  end if;
  if not exists (select 1 from pg_timezone_names where name = v_new.time_zone) then
    raise exception using errcode = 'P0001', message = 'Choose a valid time zone.';
  end if;
  -- SET-R11: 0–100 with up to 2 decimals, stored as a fraction.
  if p_vat_percent is null or p_vat_percent < 0 or p_vat_percent > 100
    or round(p_vat_percent, 2) <> p_vat_percent then
    raise exception using errcode = 'P0001', message = 'VAT must be a percentage between 0 and 100, with up to 2 decimals.';
  end if;
  v_new.vat_rate := p_vat_percent / 100;

  -- SET-R08: notifications can only be on when everything they need is set.
  if v_new.email_enabled then
    if v_old.brevo_secret_id is null then v_missing := array_append(v_missing, 'a Brevo API key'); end if;
    if v_new.sender_email is null then v_missing := array_append(v_missing, 'a sender email'); end if;
    if v_new.app_url is null then v_missing := array_append(v_missing, 'an App URL'); end if;
    if cardinality(v_missing) > 0 then
      raise exception using errcode = 'P0001',
        message = 'Notifications need ' || array_to_string(v_missing, ', ') || ' before they can be turned on.';
    end if;
  end if;

  -- SET-R10
  foreach v_field in array array[
    'email_enabled', 'sender_name', 'sender_email', 'reply_to_email', 'app_url', 'time_zone', 'vat_rate'
  ] loop
    if (to_jsonb(v_old) -> v_field) is distinct from (to_jsonb(v_new) -> v_field) then
      insert into public.settings_audit (changed_by, field, old_value, new_value)
      values (auth.uid(), v_field, to_jsonb(v_old) ->> v_field, to_jsonb(v_new) ->> v_field);
    end if;
  end loop;

  update public.system_settings set
    email_enabled = v_new.email_enabled,
    sender_name = v_new.sender_name,
    sender_email = v_new.sender_email,
    reply_to_email = v_new.reply_to_email,
    app_url = v_new.app_url,
    time_zone = v_new.time_zone,
    vat_rate = v_new.vat_rate,
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1;
end;
$$;

-- ============================================================================
-- set_brevo_api_key — SET-R02/R03. Stores the key in Vault and returns
-- nothing secret. The live check (SET-R04) runs in the brevo-validate-key
-- Edge Function, since the database shouldn't make the outbound call here.
-- ============================================================================
create function public.set_brevo_api_key(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := btrim(coalesce(p_key, ''));
  v_secret_id uuid;
begin
  perform public.require_system_admin();

  if v_key = '' then
    raise exception using errcode = 'P0001', message = 'Enter the API key.';
  end if;
  if v_key like 'xsmtpsib-%' then
    raise exception using errcode = 'P0001',
      message = 'This is an SMTP key. Use a Brevo API v3 key (starts with xkeysib-).';
  end if;
  if v_key not like 'xkeysib-%' then
    raise exception using errcode = 'P0001',
      message = 'That doesn''t look like a Brevo API v3 key (it should start with xkeysib-).';
  end if;

  select brevo_secret_id into v_secret_id from public.system_settings where id = 1 for update;
  if v_secret_id is null then
    select id into v_secret_id from vault.secrets where name = 'brevo_api_key';
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(v_key, 'brevo_api_key', 'Brevo API v3 key for email notifications');
  else
    perform vault.update_secret(v_secret_id, v_key);
  end if;

  update public.system_settings set
    brevo_secret_id = v_secret_id,
    brevo_key_last4 = right(v_key, 4),
    brevo_key_status = 'unknown',
    brevo_key_checked_at = null,
    brevo_key_account = null,
    brevo_key_changed_at = now(),
    brevo_key_changed_by = auth.uid(),
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1;

  insert into public.settings_audit (changed_by, field, new_value)
  values (auth.uid(), 'brevo_api_key', 'key replaced');
end;
$$;

-- ============================================================================
-- remove_brevo_api_key — SET-R05. Notifications turn off with it (SET-R08),
-- so new incidents log a `skipped` row (EML-R03).
-- ============================================================================
create function public.remove_brevo_api_key()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
begin
  perform public.require_system_admin();

  select brevo_secret_id into v_secret_id from public.system_settings where id = 1 for update;
  if v_secret_id is null then
    return;
  end if;

  delete from vault.secrets where id = v_secret_id;

  update public.system_settings set
    email_enabled = false,
    brevo_secret_id = null,
    brevo_key_last4 = null,
    brevo_key_status = 'not_configured',
    brevo_key_checked_at = null,
    brevo_key_account = null,
    brevo_key_changed_at = now(),
    brevo_key_changed_by = auth.uid(),
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1;

  insert into public.settings_audit (changed_by, field, new_value)
  values (auth.uid(), 'brevo_api_key', 'key removed');
end;
$$;

revoke execute on function public.update_system_settings(boolean, text, text, text, text, text, numeric) from public, anon;
grant execute on function public.update_system_settings(boolean, text, text, text, text, text, numeric) to authenticated;
revoke execute on function public.set_brevo_api_key(text) from public, anon;
grant execute on function public.set_brevo_api_key(text) to authenticated;
revoke execute on function public.remove_brevo_api_key() from public, anon;
grant execute on function public.remove_brevo_api_key() to authenticated;

-- ============================================================================
-- email_outbox — one row per notification to send (EML-R04). No client access.
-- ============================================================================
create table public.email_outbox (
  id bigint generated always as identity primary key,
  template text not null default 'incident-notification',
  incident_id uuid not null references public.incident (id) on delete cascade,
  recipient_email text not null,
  recipient_name text,
  status text not null default 'queued',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_outbox_status_check check (status in ('queued', 'sending', 'sent', 'failed')),
  -- Stored lower-cased (EML-R02 dedupes on it).
  constraint email_outbox_recipient_lower check (recipient_email = lower(recipient_email)),
  -- EML-R04: idempotent per incident + recipient + template.
  constraint email_outbox_incident_recipient_template_key unique (incident_id, recipient_email, template)
);

create index email_outbox_due_idx on public.email_outbox (next_attempt_at)
  where status in ('queued', 'sending');

alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;

-- ============================================================================
-- email_log — one row per attempt outcome (EML-R11). Readable by system_admin
-- only (fixes E10); written by the service role and the trigger below.
-- ============================================================================
create table public.email_log (
  id bigint generated always as identity primary key,
  outbox_id bigint references public.email_outbox (id) on delete set null,
  incident_id uuid references public.incident (id) on delete set null,
  -- 'incident-notification' or 'test' (SET-R09).
  tag text not null default 'incident-notification',
  recipient_email text,
  -- The rendered subject only; the HTML body isn't stored (EML-R11).
  subject text,
  -- 'retrying' = a transient failure that will be tried again (EML-R10).
  status text not null,
  attempt integer,
  http_status integer,
  brevo_message_id text,
  response_body text,
  error_reason text,
  -- The admin who sent a test email (rate limit, SET-R09).
  triggered_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint email_log_status_check check (status in ('sent', 'failed', 'retrying', 'skipped')),
  constraint email_log_response_body_length check (char_length(response_body) <= 4096)
);

create index email_log_created_at_idx on public.email_log (created_at desc);
create index email_log_outbox_id_idx on public.email_log (outbox_id);

alter table public.email_log enable row level security;

create policy email_log_select on public.email_log for select
  to authenticated
  using (public.has_masterdata_role(array['system_admin']::public.masterdata_role[]));

revoke insert, update, delete on public.email_log from anon, authenticated;

-- ============================================================================
-- Kicking the worker. pg_net queues the HTTP call inside the transaction and
-- sends it after commit, so a rolled-back incident never triggers a send
-- (fixes E5). A pg_cron job below retries anything still due every minute.
-- Needs Vault secrets `project_url` (set once by hand) and
-- `email_worker_secret` (created here); without them this is a no-op.
-- ============================================================================
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'email_worker_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'email_worker_secret',
      'Shared secret the database sends to the email-worker Edge Function'
    );
  end if;
end;
$$;

create function public.kick_email_worker()
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
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'email_worker_secret';
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := regexp_replace(v_url, '/+$', '') || '/functions/v1/email-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;

revoke execute on function public.kick_email_worker() from public, anon, authenticated;

-- Only kick for rows that are due now. The worker's own updates (claiming a
-- row as `sending`, scheduling a retry for later) don't match, so it can't
-- trigger itself in a loop.
create function public.kick_email_worker_for_due_rows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from due_rows where status = 'queued' and next_attempt_at <= now()
  ) then
    perform public.kick_email_worker();
  end if;
  return null;
end;
$$;

create trigger email_outbox_kick_on_insert
  after insert on public.email_outbox
  referencing new table as due_rows
  for each statement execute function public.kick_email_worker_for_due_rows();

create trigger email_outbox_kick_on_update
  after update on public.email_outbox
  referencing new table as due_rows
  for each statement execute function public.kick_email_worker_for_due_rows();

create function public.kick_email_worker_if_due()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.email_outbox
    where (status = 'queued' and next_attempt_at <= now())
       or (status = 'sending' and last_attempt_at < now() - interval '5 minutes')
  ) then
    perform public.kick_email_worker();
  end if;
end;
$$;

revoke execute on function public.kick_email_worker_if_due() from public, anon, authenticated;

select cron.schedule('email-worker', '* * * * *', $$select public.kick_email_worker_if_due()$$);

-- EML-R11: keep logs for 180 days (proposal to confirm).
select cron.schedule(
  'email-log-retention',
  '17 3 * * *',
  $$delete from public.email_log where created_at < now() - interval '180 days'$$
);

-- ============================================================================
-- queue_incident_notifications — EML-R01..R03. Runs once, when the incident
-- row is inserted, in the same transaction. Editing an incident or changing
-- its status sends nothing.
-- ============================================================================

-- EML-R02: subscribers of the type whose account is active and has a valid
-- email, deduplicated by lower-cased email. No self-exclusion.
create function public.incident_notification_recipients(p_incident_type_id uuid)
returns table (email text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (lower(u.email::text))
    lower(u.email::text),
    nullif(btrim(p.username), '')
  from public.incident_subscription s
  join auth.users u on u.id = s.user_id
  left join public.profiles p on p.id = u.id
  where s.incident_type_id = p_incident_type_id
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until < now())
    and u.email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  order by lower(u.email::text), s.created_at;
$$;

revoke execute on function public.incident_notification_recipients(uuid) from public, anon, authenticated;

create function public.queue_incident_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.system_settings;
  v_type_name text;
  v_reason text;
  v_recipients integer;
begin
  select name into v_type_name from public.incident_type where id = new.incident_type_id;

  select count(*) into v_recipients
  from public.incident_notification_recipients(new.incident_type_id);
  -- Nobody subscribed: nothing to send and nothing to log (as in Mendix).
  if v_recipients = 0 then
    return null;
  end if;

  -- EML-R03: kill switch and configuration check.
  select * into v_settings from public.system_settings where id = 1;
  if not coalesce(v_settings.email_enabled, false) then
    v_reason := 'email disabled';
  elsif v_settings.brevo_secret_id is null then
    v_reason := 'no api key';
  elsif coalesce(v_settings.sender_email, '') = '' then
    v_reason := 'no sender email';
  end if;

  if v_reason is not null then
    insert into public.email_log (incident_id, subject, status, error_reason, response_body)
    values (
      new.id,
      v_type_name || ': ' || new.reference,
      'skipped',
      v_reason,
      format('%s subscriber(s) not notified.', v_recipients)
    );
    return null;
  end if;

  insert into public.email_outbox (incident_id, recipient_email, recipient_name)
  select new.id, r.email, r.name
  from public.incident_notification_recipients(new.incident_type_id) r
  on conflict (incident_id, recipient_email, template) do nothing;

  return null;
end;
$$;

create trigger incident_queue_notifications
  after insert on public.incident
  for each row execute function public.queue_incident_notifications();

-- ============================================================================
-- Worker RPCs — service role only (the email-worker, brevo-validate-key and
-- brevo-send-test Edge Functions). The API key never leaves the server side.
-- ============================================================================
create function public.email_worker_secret_matches(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'email_worker_secret'
      and decrypted_secret = p_secret
      and coalesce(p_secret, '') <> ''
  );
$$;

create function public.get_email_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'email_enabled', s.email_enabled,
    'api_key', (select decrypted_secret from vault.decrypted_secrets where id = s.brevo_secret_id),
    'sender_name', s.sender_name,
    'sender_email', s.sender_email,
    'reply_to_email', s.reply_to_email,
    'app_url', s.app_url,
    'time_zone', s.time_zone
  )
  from public.system_settings s
  where s.id = 1;
$$;

-- Claims due rows (and rows stuck in `sending` after a crashed run) without
-- blocking a concurrent worker.
create function public.claim_email_outbox(p_limit integer default 20)
returns setof public.email_outbox
language sql
security definer
set search_path = public
as $$
  update public.email_outbox o set
    status = 'sending',
    attempts = o.attempts + 1,
    last_attempt_at = now(),
    updated_at = now()
  where o.id in (
    select id
    from public.email_outbox
    where (status = 'queued' and next_attempt_at <= now())
       or (status = 'sending' and last_attempt_at < now() - interval '5 minutes')
    order by next_attempt_at, id
    limit p_limit
    for update skip locked
  )
  returning o.*;
$$;

-- Everything the template needs (EML-R07). The worker formats the date.
create function public.incident_email_context(p_incident_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'reference', i.reference,
    'incident_type', t.name,
    'location_name', l.name,
    'logged_by', coalesce(nullif(btrim(p.username), ''), split_part(u.email::text, '@', 1)),
    'created_at', i.created_at,
    'comment', i.comment
  )
  from public.incident i
  join public.incident_type t on t.id = i.incident_type_id
  join public.location l on l.id = i.location_id
  left join auth.users u on u.id = i.created_by
  left join public.profiles p on p.id = i.created_by
  where i.id = p_incident_id;
$$;

-- Records one send attempt (EML-R10, R11).
--   p_outcome 'sent'  → outbox sent, log sent.
--   p_outcome 'retry' → 429 / 5xx / network: queued again after 1, 5, then 30
--                       minutes; after the 4th attempt it is marked failed.
--   p_outcome 'failed'→ 400/401/403 and other permanent errors: no retry.
-- A 401 also marks the stored key invalid.
create function public.record_email_attempt(
  p_outbox_id bigint,
  p_outcome text,
  p_subject text,
  p_http_status integer,
  p_message_id text,
  p_response_body text,
  p_error_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.email_outbox;
  v_outcome text := p_outcome;
  v_delays constant integer[] := array[1, 5, 30];
begin
  select * into v_row from public.email_outbox where id = p_outbox_id for update;
  if not found then
    return;
  end if;

  if v_outcome = 'retry' and v_row.attempts > cardinality(v_delays) then
    v_outcome := 'failed';
  end if;

  update public.email_outbox set
    status = case v_outcome when 'sent' then 'sent' when 'retry' then 'queued' else 'failed' end,
    next_attempt_at = case
      when v_outcome = 'retry' then now() + make_interval(mins => v_delays[v_row.attempts])
      else next_attempt_at
    end,
    updated_at = now()
  where id = p_outbox_id;

  insert into public.email_log (
    outbox_id, incident_id, tag, recipient_email, subject, status, attempt,
    http_status, brevo_message_id, response_body, error_reason
  ) values (
    v_row.id,
    v_row.incident_id,
    v_row.template,
    v_row.recipient_email,
    p_subject,
    case v_outcome when 'sent' then 'sent' when 'retry' then 'retrying' else 'failed' end,
    v_row.attempts,
    p_http_status,
    p_message_id,
    left(p_response_body, 4096),
    p_error_reason
  );

  perform public.record_brevo_http_status(p_http_status);
end;
$$;

-- A send or key check that got a definite answer from Brevo updates the
-- key status shown on the settings page (EML-R10, SET-R04).
create function public.record_brevo_http_status(p_http_status integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.system_settings set
    brevo_key_status = case when p_http_status = 401 then 'invalid' else 'valid' end,
    brevo_key_checked_at = now()
  where id = 1
    and brevo_secret_id is not null
    and (p_http_status = 401 or p_http_status between 200 and 299);
$$;

-- SET-R04: result of GET /v3/account.
create function public.record_brevo_key_check(p_status text, p_account text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.system_settings set
    brevo_key_status = p_status,
    brevo_key_checked_at = now(),
    brevo_key_account = case when p_status = 'valid' then p_account end
  where id = 1
    and brevo_secret_id is not null
    and p_status in ('valid', 'invalid', 'unknown');
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.email_worker_secret_matches(text)',
    'public.get_email_config()',
    'public.claim_email_outbox(integer)',
    'public.incident_email_context(uuid)',
    'public.record_email_attempt(bigint, text, text, integer, text, text, text)',
    'public.record_brevo_http_status(integer)',
    'public.record_brevo_key_check(text, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- ============================================================================
-- resend_email — EML-R12. A system_admin re-queues a notification whose
-- delivery has finally failed. The outbox row is reset rather than
-- duplicated, so the idempotency key still holds.
-- ============================================================================
create function public.resend_email(p_log_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outbox_id bigint;
  v_status text;
begin
  perform public.require_system_admin();

  select outbox_id into v_outbox_id from public.email_log where id = p_log_id;
  if v_outbox_id is null then
    raise exception using errcode = 'P0001', message = 'Only incident notifications can be resent.';
  end if;

  select status into v_status from public.email_outbox where id = v_outbox_id for update;
  if v_status is distinct from 'failed' then
    raise exception using errcode = 'P0001', message = 'This email is already queued or was sent.';
  end if;

  update public.email_outbox set
    status = 'queued',
    attempts = 0,
    next_attempt_at = now(),
    updated_at = now()
  where id = v_outbox_id;
end;
$$;

revoke execute on function public.resend_email(bigint) from public, anon;
grant execute on function public.resend_email(bigint) to authenticated;
