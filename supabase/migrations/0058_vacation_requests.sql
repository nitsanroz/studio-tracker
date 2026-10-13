-- Vacation: each employee sees their own vacation balance (from their latest
-- payslip) and requests whole days with a message; only the owner approves.
-- An approved request becomes vacation absences in the person's weekly-plan
-- column — made and cleared by the database, so the plan can't drift from the
-- requests.
--
-- Needs finance-admin's reference/0008_finance_payslips.sql (finance_payslips)
-- applied first. Run in the Supabase SQL editor. Safe to re-run.

-- ── Who approves: the owner (tracker admin whose position is 'owner') ────────
create or replace function is_vacation_approver() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin' and position = 'owner'
  );
$$;

-- ── A request ───────────────────────────────────────────────────────────────
create table if not exists vacation_requests (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  start_date    date not null,
  end_date      date not null,
  -- Workdays in the range (Sun–Thu, holidays out) — set by the trigger below,
  -- never trusted from the client. No half days.
  days          int  not null default 0,
  message       text not null check (length(btrim(message)) > 0),
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'declined', 'cancelled')),
  decided_by    uuid references profiles(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists vacation_requests_profile_idx on vacation_requests(profile_id, start_date);

-- The plan entries an approved request made, so they go when it's undone.
alter table plan_entries
  add column if not exists vacation_request_id uuid references vacation_requests(id) on delete cascade;

-- ── Workdays in a range: Sun–Thu, less the plan's holiday day states ────────
create or replace function vacation_workdays(from_date date, to_date date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int
  from generate_series(from_date, to_date, interval '1 day') as g(d)
  where extract(dow from g.d) not in (5, 6)
    and not exists (
      select 1 from plan_day_states s where g.d::date between s.date_from and s.date_to
    );
$$;

create or replace function vacation_requests_count_days() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.days := vacation_workdays(new.start_date, new.end_date);
  if new.days <= 0 then
    raise exception 'No workdays between % and %', new.start_date, new.end_date;
  end if;
  return new;
end $$;

drop trigger if exists vacation_requests_days on vacation_requests;
create trigger vacation_requests_days
  before insert or update of start_date, end_date on vacation_requests
  for each row execute function vacation_requests_count_days();

-- ── Approved → vacation absences in their plan column; anything else → none ─
create or replace function vacation_requests_sync_plan() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  col uuid;
  d date;
begin
  delete from plan_entries where vacation_request_id = new.id;
  if new.status <> 'approved' then
    return new;
  end if;
  select id into col from plan_columns
    where profile_id = new.profile_id and type = 'member'
    order by position limit 1;
  if col is null then
    return new;
  end if;
  for d in select g::date from generate_series(new.start_date, new.end_date, interval '1 day') g loop
    continue when extract(dow from d) in (5, 6);
    continue when exists (select 1 from plan_day_states s where d between s.date_from and s.date_to);
    -- A day already marked away (sick, a day off) keeps what it has.
    continue when exists (
      select 1 from plan_entries e where e.column_id = col and e.date = d and e.type = 'absence'
    );
    insert into plan_entries (date, column_id, type, absence_type, text, vacation_request_id)
      values (d, col, 'absence', 'vacation', '', new.id);
  end loop;
  return new;
end $$;

drop trigger if exists vacation_requests_plan on vacation_requests;
create trigger vacation_requests_plan
  after insert or update of status, start_date, end_date on vacation_requests
  for each row execute function vacation_requests_sync_plan();

-- ── Access ──────────────────────────────────────────────────────────────────
-- Own requests, and admins (the plan shows who's away anyway). Members ask and
-- may change or cancel their own while it's pending; only the owner decides.
-- No delete: the history stays.
alter table vacation_requests enable row level security;
do $$ begin
  create policy "own or admin read" on vacation_requests for select
    using (profile_id = auth.uid() or is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own request" on vacation_requests for insert
    with check (profile_id = auth.uid() and status = 'pending' and decided_by is null and decided_at is null);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own pending change" on vacation_requests for update
    using (profile_id = auth.uid() and status = 'pending')
    with check (profile_id = auth.uid() and status in ('pending', 'cancelled') and decided_by is null);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "approver decides" on vacation_requests for update
    using (is_vacation_approver()) with check (is_vacation_approver());
exception when duplicate_object then null; end $$;

-- ── Balances, from the payslips — vacation figures only ─────────────────────
-- finance_payslips stays finance-only; these hand out just the vacation lines.

-- Your own latest payslip's vacation account.
create or replace function my_vacation()
returns table (year int, month int, balance numeric, accrued numeric)
language sql stable security definer set search_path = public as $$
  select p.year, p.month, p.vacation_balance, p.vacation_accrued
  from finance_payslips p
  where p.profile_id = auth.uid() and p.vacation_balance is not null
  order by p.year desc, p.month desc
  limit 1;
$$;

-- Everyone's, for the approver only (empty for anyone else).
create or replace function vacation_balances()
returns table (profile_id uuid, year int, month int, balance numeric, accrued numeric)
language sql stable security definer set search_path = public as $$
  select distinct on (p.profile_id) p.profile_id, p.year, p.month, p.vacation_balance, p.vacation_accrued
  from finance_payslips p
  where is_vacation_approver() and p.vacation_balance is not null
  order by p.profile_id, p.year desc, p.month desc;
$$;
