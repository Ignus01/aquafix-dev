-- Idempotent commands for the offline-first field app (Aquafix Capture spec,
-- "Migration drafts" §2).
--
-- The phone queues each Save as a command with its own id (a phone UUID) and
-- sends it when it has signal. If the save goes through but the response is
-- lost, the phone resends the same command. The RPCs that take a command id
-- (save_inspection_activity, save_incident, add_incident_note,
-- advance_incident_status, save_stock_document) look the id up first and, if
-- it was already seen for this user, return the first result without doing
-- anything again. This matters most for the incident that
-- save_inspection_activity auto-creates and commits even when the save itself
-- returns ok:false: it must not be created twice.
--
-- Only results that commit are stored: success results and ok:false returns.
-- A raised rejection (P0001 / 42501) rolls the whole call back, the store
-- included, so a resend simply raises again.
--
-- The table has RLS on and no policies, and no client grants: only the two
-- helpers below touch it. They are SECURITY DEFINER because save_incident,
-- add_incident_note and save_stock_document are SECURITY INVOKER, and they
-- are scoped to auth.uid(), so a caller only ever reads or writes their own
-- commands. Calling them directly through PostgREST gains nothing: a user can
-- only plant results for their own (future) command ids.

create table public.client_command (
  id uuid primary key,                       -- the phone's command_id
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  command text not null,                     -- the RPC name
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.client_command enable row level security;  -- no policies: only the helpers touch it

revoke all on public.client_command from anon, authenticated;

-- ============================================================================
-- client_command_result — the stored result of a command already seen for
-- this user, or null when it is new (or no command id was given).
--
-- An advisory lock on the command id serialises two copies of the same
-- command arriving at once: the second waits for the first to commit, then
-- finds its stored result (each plpgsql statement takes a fresh snapshot
-- under READ COMMITTED).
--
-- An id stored for a different RPC, or for another user, is refused: the
-- phone made a mistake (or replayed someone else's id) and must not get a
-- result that isn't its own. Same message in both cases, so nothing leaks.
-- ============================================================================
create function public.client_command_result(p_command_id uuid, p_command text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.client_command;
begin
  if p_command_id is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('client_command:' || p_command_id::text, 0));

  select * into v_row from public.client_command where id = p_command_id;
  if not found then
    return null;
  end if;
  if v_row.user_id is distinct from auth.uid() or v_row.command <> p_command then
    raise exception using errcode = 'P0001',
      message = 'That command id was already used for something else.';
  end if;
  return v_row.result;
end;
$$;

-- ============================================================================
-- client_command_store — records the result of a command for this user and
-- returns it unchanged, so an RPC can end with
--   return public.client_command_store(v_command_id, '<rpc>', <result>);
-- No command id (the PWA): nothing is stored.
-- ============================================================================
create function public.client_command_store(p_command_id uuid, p_command text, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_command_id is null then
    return p_result;
  end if;
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'A command id needs a signed-in user.';
  end if;

  insert into public.client_command (id, user_id, command, result)
  values (p_command_id, auth.uid(), p_command, p_result);
  return p_result;
end;
$$;

revoke execute on function public.client_command_result(uuid, text) from public, anon;
grant execute on function public.client_command_result(uuid, text) to authenticated;
revoke execute on function public.client_command_store(uuid, text, jsonb) from public, anon;
grant execute on function public.client_command_store(uuid, text, jsonb) to authenticated;

-- A resend comes within minutes or days (the phone refuses captures older
-- than 7 days anyway); 30 days is plenty.
select cron.schedule(
  'client-command-cleanup',
  '15 3 * * *',
  $$delete from public.client_command where created_at < now() - interval '30 days'$$
);
