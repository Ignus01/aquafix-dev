-- MWTS stock R6: minimum levels and the daily low-stock email.
--
-- A minimum (and optional reorder qty) per item per storage area, in the
-- item's pack units like the stock summary. Stock is low when on hand is
-- below the minimum. Every morning (06:30 in South Africa) one email goes
-- to each person on the stock alert list, listing everything that is low,
-- e.g. "Ryan's kit: DPD1 1 (min 2)". Nothing low, or nobody on the list:
-- no email.

create table public.stock_min_level (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.item (id) on delete cascade,
  storage_area_id uuid not null references public.storage_area (id) on delete cascade,
  min_qty numeric not null,
  reorder_qty numeric,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint stock_min_level_once unique (item_id, storage_area_id),
  constraint stock_min_level_min_check check (min_qty >= 0),
  constraint stock_min_level_reorder_check check (reorder_qty is null or reorder_qty > 0)
);
create index stock_min_level_area_idx on public.stock_min_level (storage_area_id);

create trigger stock_min_level_audit before insert or update on public.stock_min_level
  for each row execute function public.set_stock_audit_fields();

alter table public.stock_min_level enable row level security;
create policy stock_min_level_select on public.stock_min_level for select to authenticated using (public.is_stock_reader());
create policy stock_min_level_insert on public.stock_min_level for insert to authenticated with check (public.is_stock_writer());
create policy stock_min_level_update on public.stock_min_level for update to authenticated
  using (public.is_stock_writer()) with check (public.is_stock_writer());
create policy stock_min_level_delete on public.stock_min_level for delete to authenticated using (public.is_stock_admin());
grant select, delete on public.stock_min_level to authenticated;
grant insert (item_id, storage_area_id, min_qty, reorder_qty) on public.stock_min_level to authenticated;
grant update (item_id, storage_area_id, min_qty, reorder_qty) on public.stock_min_level to authenticated;

-- Every minimum with what is on hand now.
create view public.stock_low_level with (security_invoker = true) as
select m.id, m.item_id, m.storage_area_id, m.min_qty, m.reorder_qty,
       coalesce(s.qty, 0) as qty,
       coalesce(s.qty, 0) < m.min_qty as is_low
  from public.stock_min_level m
  left join public.storage_area_stock s on s.item_id = m.item_id and s.storage_area_id = m.storage_area_id;
grant select on public.stock_low_level to authenticated;

-- ============================================================================
-- Who gets the daily email (set in Settings by a system admin).
-- ============================================================================
create table public.stock_alert_recipient (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null
);
alter table public.stock_alert_recipient enable row level security;
create policy stock_alert_recipient_select on public.stock_alert_recipient for select to authenticated
  using (public.has_masterdata_role(array['system_admin']::public.masterdata_role[]));
create policy stock_alert_recipient_insert on public.stock_alert_recipient for insert to authenticated
  with check (public.has_masterdata_role(array['system_admin']::public.masterdata_role[]));
create policy stock_alert_recipient_delete on public.stock_alert_recipient for delete to authenticated
  using (public.has_masterdata_role(array['system_admin']::public.masterdata_role[]));
grant select, delete on public.stock_alert_recipient to authenticated;
grant insert (user_id) on public.stock_alert_recipient to authenticated;

-- ============================================================================
-- The email outbox carries non-incident emails too: a template and its data.
-- ============================================================================
alter table public.email_outbox
  alter column incident_id drop not null,
  add column payload jsonb,
  add constraint email_outbox_incident_needed check (template <> 'incident-notification' or incident_id is not null);
-- One low-stock email per person per day.
create unique index email_outbox_low_stock_day_key on public.email_outbox (recipient_email, (payload ->> 'day'))
  where template = 'low-stock';

-- Queues today's low-stock email. Safe to run more than once a day.
create function public.queue_low_stock_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.system_settings;
  v_day date := (now() at time zone public.app_time_zone())::date;
  v_lines jsonb;
  v_recipients integer;
  v_reason text;
  v_queued integer;
begin
  select jsonb_agg(jsonb_build_object(
           'storage_area', sa.name, 'item', i.name,
           'qty', trim_scale(l.qty), 'min_qty', trim_scale(l.min_qty), 'reorder_qty', trim_scale(l.reorder_qty))
         order by sa.name, i.name)
    into v_lines
    from public.stock_low_level l
    join public.storage_area sa on sa.id = l.storage_area_id
    join public.item i on i.id = l.item_id
   where l.is_low and sa.active;
  if v_lines is null then return 0; end if;

  select count(*) into v_recipients from public.stock_alert_recipient;
  if v_recipients = 0 then return 0; end if;

  select * into v_settings from public.system_settings where id = 1;
  if not coalesce(v_settings.email_enabled, false) then
    v_reason := 'email disabled';
  elsif v_settings.brevo_secret_id is null then
    v_reason := 'no api key';
  elsif coalesce(v_settings.sender_email, '') = '' then
    v_reason := 'no sender email';
  end if;
  if v_reason is not null then
    insert into public.email_log (tag, subject, status, error_reason, response_body)
    values ('low-stock', 'Low stock: ' || jsonb_array_length(v_lines) || ' item(s)', 'skipped', v_reason,
            format('%s recipient(s) not notified.', v_recipients));
    return 0;
  end if;

  insert into public.email_outbox (template, recipient_email, recipient_name, payload)
  select distinct on (lower(u.email::text))
         'low-stock', lower(u.email::text), nullif(btrim(p.username), ''),
         jsonb_build_object('day', v_day, 'lines', v_lines)
    from public.stock_alert_recipient r
    join auth.users u on u.id = r.user_id
    left join public.profiles p on p.id = u.id
   where u.deleted_at is null
     and (u.banned_until is null or u.banned_until < now())
     and u.email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
   order by lower(u.email::text)
  on conflict (recipient_email, (payload ->> 'day')) where template = 'low-stock' do nothing;
  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;
revoke execute on function public.queue_low_stock_alerts() from public, anon, authenticated;

-- 04:30 UTC = 06:30 in South Africa.
select cron.schedule('stock-low-daily', '30 4 * * *', $$select public.queue_low_stock_alerts()$$);
