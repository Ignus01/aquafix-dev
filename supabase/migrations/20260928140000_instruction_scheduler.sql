-- Scheduled instruction issuing (spec/inspections/instructions.md §5,
-- SCH-R09/R10, decision 2026-09-23): a daily job plus the admin "Run
-- Schedule" button. Nothing on any page load issues instructions.
--
-- The job ticks every hour at :05 and issues once per app-local day: at the
-- first tick after local midnight (00:05 in Africa/Johannesburg), unless a
-- job run already succeeded that day. A failed or partial run is retried at
-- the next tick, up to the end of the day (stands in for the Mendix task
-- queue's retries). Missed days are not caught up (open question).
--
-- Idempotent: unique (scheduled_instruction_id, issue_date) on instruction,
-- inserted with ON CONFLICT DO NOTHING, and each schedule's instruction and
-- allocations are written together.

-- Whether a schedule issues on a given day (the switch in §5).
create function public.scheduled_instruction_is_due(
  p_schedule public.scheduled_instruction,
  p_date date
)
returns boolean
language sql
stable
set search_path = public
as $$
  select case p_schedule.schedule_type
    when 'daily' then
      (p_schedule.include_public_holidays
        or not exists (select 1 from public.public_holiday h where h.holiday_date = p_date))
      and (p_schedule.include_weekends or extract(isodow from p_date) < 6)
    -- Weekends and public holidays are not checked for Weekly or Monthly.
    when 'weekly' then extract(isodow from p_date)::smallint = any (p_schedule.week_days)
    when 'monthly' then extract(day from p_date)::integer = p_schedule.day_of_month
    else false
  end;
$$;

-- ACT_ScheduleInstruction_IssueInstructions for every active schedule.
-- Returns { run_id, status, issued, problems }.
create function public.issue_scheduled_instructions(
  p_date date,
  p_trigger text,
  p_triggered_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id bigint;
  v_schedule public.scheduled_instruction;
  v_instruction_id uuid;
  v_issued integer := 0;
  v_problems jsonb := '[]'::jsonb;
  v_status text;
begin
  insert into public.instruction_schedule_run (run_date, trigger, triggered_by)
  values (p_date, p_trigger, p_triggered_by)
  returning id into v_run_id;

  for v_schedule in
    select * from public.scheduled_instruction where active order by legacy_uid
  loop
    begin
      if not public.scheduled_instruction_is_due(v_schedule, p_date) then
        continue;
      end if;

      -- An issued Instruction with no assignee or no assets could never be
      -- completed; skipped and logged instead.
      if v_schedule.account_id is null then
        v_problems := v_problems || jsonb_build_object(
          'schedule_id', v_schedule.id, 'name', v_schedule.name, 'reason', 'No one is assigned.');
        continue;
      end if;
      if not exists (
        select 1 from public.scheduled_instruction_asset where scheduled_instruction_id = v_schedule.id
      ) then
        v_problems := v_problems || jsonb_build_object(
          'schedule_id', v_schedule.id, 'name', v_schedule.name, 'reason', 'No assets.');
        continue;
      end if;

      v_instruction_id := null;
      insert into public.instruction (
        name, comment, is_scheduled, required_completed_date, account_id,
        scheduled_instruction_id, issue_date, created_by
      ) values (
        v_schedule.name,
        v_schedule.comment,
        true,
        p_date + v_schedule.days_to_complete,
        v_schedule.account_id,
        v_schedule.id,
        p_date,
        p_triggered_by
      )
      on conflict (scheduled_instruction_id, issue_date) do nothing
      returning id into v_instruction_id;

      -- Already issued today (`Existing` in the Mendix flow).
      if v_instruction_id is null then
        continue;
      end if;

      insert into public.instruction_asset_allocation (instruction_id, asset_id)
      select v_instruction_id, sa.asset_id
      from public.scheduled_instruction_asset sa
      where sa.scheduled_instruction_id = v_schedule.id;

      v_issued := v_issued + 1;
    exception when others then
      -- The block's subtransaction rolls back this schedule only.
      v_problems := v_problems || jsonb_build_object(
        'schedule_id', v_schedule.id, 'name', v_schedule.name, 'reason', sqlerrm);
    end;
  end loop;

  v_status := case
    when not exists (
      select 1 from jsonb_array_elements(v_problems) p
      where p ->> 'reason' not in ('No one is assigned.', 'No assets.')
    ) then 'success'
    when v_issued > 0 then 'partial'
    else 'failed'
  end;

  update public.instruction_schedule_run
  set status = v_status, finished_at = now(), issued_count = v_issued, problems = v_problems
  where id = v_run_id;

  return jsonb_build_object(
    'run_id', v_run_id,
    'status', v_status,
    'issued', v_issued,
    'problems', v_problems
  );
end;
$$;

revoke execute on function public.issue_scheduled_instructions(date, text, uuid) from public, anon, authenticated;

-- SCH-R10: the admin "Run Schedule" button. Issues for today only; safe after
-- the job has run (already-issued schedules are skipped).
create function public.run_instruction_schedule()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_inspection_admin() then
    raise exception using errcode = '42501', message = 'Only admins can run the schedule.';
  end if;
  return public.issue_scheduled_instructions(public.app_today(), 'manual', auth.uid());
end;
$$;

revoke execute on function public.run_instruction_schedule() from public, anon;
grant execute on function public.run_instruction_schedule() to authenticated;

-- SCH-R09: the job's entry point.
create function public.run_instruction_schedule_if_due()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.app_today();
begin
  if exists (
    select 1 from public.instruction_schedule_run
    where run_date = v_today and trigger = 'cron' and status = 'success'
  ) then
    return;
  end if;
  perform public.issue_scheduled_instructions(v_today, 'cron');
end;
$$;

revoke execute on function public.run_instruction_schedule_if_due() from public, anon, authenticated;

select cron.schedule(
  'issue-scheduled-instructions',
  '5 * * * *',
  $$select public.run_instruction_schedule_if_due()$$
);

-- Keep a year of run logs.
select cron.schedule(
  'instruction-schedule-run-retention',
  '23 3 * * *',
  $$delete from public.instruction_schedule_run where run_date < current_date - 365$$
);
