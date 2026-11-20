-- MWTS stock: month-end lock.
--
-- Stock can be added, edited and deleted until a month is closed. Closing a
-- month locks every stock movement dated in it, and in every month before
-- it, so its figures (on hand, usage, cost per site) can't change after
-- they have been reported. Admins close months one at a time, in order, and
-- can reopen the last closed month to fix something.
--
-- Dates are judged in the app's time zone (system_settings.time_zone).
-- A phone that saved usage offline in a month that has since been closed
-- gets the "closed" message back; the usage then needs a date in an open
-- month, or an admin to reopen.

create table public.stock_period (
  id smallint primary key default 1,
  -- Last day of the last closed month; null while nothing is closed.
  closed_through date,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint stock_period_singleton check (id = 1),
  constraint stock_period_month_end check (closed_through is null or closed_through = (date_trunc('month', closed_through) + interval '1 month - 1 day')::date)
);
insert into public.stock_period (id) values (1);

create table public.stock_period_log (
  id bigint generated always as identity primary key,
  action text not null,
  month date not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  constraint stock_period_log_action_check check (action in ('close', 'reopen'))
);

alter table public.stock_period enable row level security;
alter table public.stock_period_log enable row level security;
create policy stock_period_select on public.stock_period for select to authenticated using (public.is_stock_reader());
create policy stock_period_log_select on public.stock_period_log for select to authenticated using (public.is_stock_reader());
revoke insert, update, delete on public.stock_period, public.stock_period_log from anon, authenticated;
grant select on public.stock_period, public.stock_period_log to authenticated;

create function public.stock_closed_through()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select closed_through from public.stock_period where id = 1;
$$;
revoke execute on function public.stock_closed_through() from public, anon;
grant execute on function public.stock_closed_through() to authenticated;

-- Refuses a stock change dated in a closed month.
create function public.stock_assert_open(p_at timestamptz)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_through date := public.stock_closed_through();
  v_day date;
begin
  if v_through is null or p_at is null then return; end if;
  v_day := (p_at at time zone public.app_time_zone())::date;
  if v_day <= v_through then
    raise exception using errcode = 'P0001',
      message = format('Stock up to the end of %s is closed, so nothing dated %s can be added, changed or deleted. An admin can reopen the month.',
                       trim(to_char(v_through, 'FMMonth YYYY')), to_char(v_day, 'DD Mon YYYY'));
  end if;
end;
$$;
revoke execute on function public.stock_assert_open(timestamptz) from public, anon, authenticated;

-- The ledger: every stock movement passes through here.
create function public.item_transaction_period_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.stock_assert_open(new.transaction_date);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.stock_assert_open(old.transaction_date);
    return old;
  end if;
  -- Re-posting the same values (a header saved unchanged) is fine.
  if (old.qty, old.item_id, old.storage_area_id, old.transaction_date, old.transaction_type)
     is distinct from (new.qty, new.item_id, new.storage_area_id, new.transaction_date, new.transaction_type) then
    perform public.stock_assert_open(old.transaction_date);
    perform public.stock_assert_open(new.transaction_date);
  end if;
  return new;
end;
$$;

create trigger item_transaction_period_guard
  before insert or update or delete on public.item_transaction
  for each row execute function public.item_transaction_period_guard();

-- Prices behind closed figures: a PO line's cost once stock from it was
-- received in a closed month, and a counted line's price.
create function public.purchase_order_item_period_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first timestamptz;
begin
  select min(received_at) into v_first from public.stock_lot where purchase_order_item_id = new.id;
  perform public.stock_assert_open(v_first);
  return new;
end;
$$;
create trigger purchase_order_item_period_guard
  before update of unit_cost_exc_vat on public.purchase_order_item
  for each row when (old.unit_cost_exc_vat is distinct from new.unit_cost_exc_vat)
  execute function public.purchase_order_item_period_guard();

create function public.stock_take_item_period_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.stock_assert_open((select take_date from public.stock_take where id = new.stock_take_id));
  return new;
end;
$$;
create trigger stock_take_item_period_guard
  before update of unit_cost_exc_vat on public.stock_take_item
  for each row when (old.unit_cost_exc_vat is distinct from new.unit_cost_exc_vat)
  execute function public.stock_take_item_period_guard();

-- Close the next month. The first close can be any month that has ended;
-- after that, months close in order.
create function public.close_stock_month(p_month date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_through date;
  v_month date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_today date := (now() at time zone public.app_time_zone())::date;
begin
  if not public.is_stock_admin() then
    raise exception using errcode = '42501', message = 'Only admins can close a stock month.';
  end if;
  if p_month is null then
    raise exception using errcode = 'P0001', message = 'Choose the month to close.';
  end if;
  select closed_through into v_through from public.stock_period where id = 1 for update;
  if v_end >= v_today then
    raise exception using errcode = 'P0001', message = format('%s hasn''t ended yet, so it can''t be closed.', trim(to_char(v_month, 'FMMonth YYYY')));
  end if;
  if v_through is not null and v_end <= v_through then
    raise exception using errcode = 'P0001', message = format('%s is already closed.', trim(to_char(v_month, 'FMMonth YYYY')));
  end if;
  if v_through is not null and v_month <> v_through + 1 then
    raise exception using errcode = 'P0001',
      message = format('Close %s first: months close in order.', trim(to_char(v_through + 1, 'FMMonth YYYY')));
  end if;
  update public.stock_period set closed_through = v_end, updated_at = now(), updated_by = auth.uid() where id = 1;
  insert into public.stock_period_log (action, month) values ('close', v_month);
  return jsonb_build_object('closed_through', v_end);
end;
$$;

-- Reopen the last closed month.
create function public.reopen_stock_month()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_through date;
  v_month date;
begin
  if not public.is_stock_admin() then
    raise exception using errcode = '42501', message = 'Only admins can reopen a stock month.';
  end if;
  select closed_through into v_through from public.stock_period where id = 1 for update;
  if v_through is null then
    raise exception using errcode = 'P0001', message = 'No stock month is closed.';
  end if;
  v_month := date_trunc('month', v_through)::date;
  update public.stock_period set closed_through = v_month - 1, updated_at = now(), updated_by = auth.uid() where id = 1;
  insert into public.stock_period_log (action, month) values ('reopen', v_month);
  return jsonb_build_object('closed_through', v_month - 1);
end;
$$;

revoke execute on function public.close_stock_month(date), public.reopen_stock_month() from public, anon;
grant execute on function public.close_stock_month(date), public.reopen_stock_month() to authenticated;
