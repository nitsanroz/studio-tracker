-- Vacation, round 2 (2026-10-29):
--
-- 1. THE PLAN TALKS BACK TO THE REQUEST. An approved request's days are plan
--    entries (0058); dragging one to another day moved the chip but left the
--    request on its old dates, so the Vacation page and the balance still said
--    the old day (Aki, 2026-10-29). Now moving or removing such an entry
--    rewrites the request. A moved day can leave a gap (Sun–Wed + next Sun), so
--    a request may carry its exact days in `dates`; null = every workday in
--    start_date..end_date, as before.
--
-- 2. AN APPROVED REQUEST CAN BE CHANGED AND SENT BACK. A member edits it as a
--    NEW pending request that `replaces_id` the approved one. The approved one
--    stands (and stays in the plan) until the owner decides: approve → the old
--    one becomes 'replaced' and its days come off; decline → nothing changes.
--
-- Needs 0058. Run in the Supabase SQL editor. Safe to re-run.

alter table vacation_requests add column if not exists dates date[];
alter table vacation_requests add column if not exists replaces_id uuid references vacation_requests(id) on delete set null;

alter table vacation_requests drop constraint if exists vacation_requests_status_check;
alter table vacation_requests add constraint vacation_requests_status_check
  check (status in ('pending', 'approved', 'declined', 'cancelled', 'replaced'));

-- One change waiting per approved request.
create unique index if not exists vacation_requests_one_change_idx
  on vacation_requests(replaces_id) where status = 'pending';

-- ── Days: the exact list when there is one ──────────────────────────────────
create or replace function vacation_requests_count_days() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.dates is not null then
    -- Moved in the plan: the owner put the day there, so it stands even on a
    -- day that costs nothing (a Friday) — only workdays are counted.
    select coalesce(min(d), new.start_date), coalesce(max(d), new.end_date) into new.start_date, new.end_date
      from unnest(new.dates) d;
    select count(*)::int into new.days from unnest(new.dates) d
      where extract(dow from d) not in (5, 6)
        and not exists (select 1 from plan_day_states s where d between s.date_from and s.date_to);
    return new;
  end if;
  new.days := vacation_workdays(new.start_date, new.end_date);
  if new.days <= 0 then
    raise exception 'No workdays between % and %', new.start_date, new.end_date;
  end if;
  return new;
end $$;

drop trigger if exists vacation_requests_days on vacation_requests;
create trigger vacation_requests_days
  before insert or update of start_date, end_date, dates on vacation_requests
  for each row execute function vacation_requests_count_days();

-- ── A change must replace your OWN APPROVED request ─────────────────────────
create or replace function vacation_requests_check_replace() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.replaces_id is not null and not exists (
    select 1 from vacation_requests o
    where o.id = new.replaces_id and o.profile_id = new.profile_id and o.status = 'approved'
  ) then
    raise exception 'Only an approved request can be changed';
  end if;
  return new;
end $$;

drop trigger if exists vacation_requests_replace on vacation_requests;
create trigger vacation_requests_replace
  before insert on vacation_requests
  for each row execute function vacation_requests_check_replace();

-- ── Approved → plan entries (0058's, now with `dates` and replacements) ─────
create or replace function vacation_requests_sync_plan() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  col uuid;
  d date;
begin
  -- The plan itself just rewrote this request (below): its entries are already right.
  if current_setting('vacation.from_plan', true) = 'on' then
    return new;
  end if;
  perform set_config('vacation.syncing', 'on', true);
  delete from plan_entries where vacation_request_id = new.id;
  perform set_config('vacation.syncing', 'off', true);
  if new.status <> 'approved' then
    return new;
  end if;
  -- A change approved: the request it replaces steps aside FIRST, so its days
  -- leave the plan before these go in (else an overlapping day would be
  -- skipped as "already away" and then deleted with the old one).
  if new.replaces_id is not null then
    update vacation_requests set status = 'replaced' where id = new.replaces_id and status = 'approved';
  end if;
  select id into col from plan_columns
    where profile_id = new.profile_id and type = 'member'
    order by position limit 1;
  if col is null then
    return new;
  end if;
  for d in
    select g::date from generate_series(new.start_date, new.end_date, interval '1 day') g
    where new.dates is null or g::date = any(new.dates)
  loop
    -- A listed day was put there by hand in the plan; a range skips weekends and holidays.
    if new.dates is null then
      continue when extract(dow from d) in (5, 6);
      continue when exists (select 1 from plan_day_states s where d between s.date_from and s.date_to);
    end if;
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
  after insert or update of status, start_date, end_date, dates on vacation_requests
  for each row execute function vacation_requests_sync_plan();

-- ── The plan → the request ──────────────────────────────────────────────────
-- An approved vacation chip moved to another day, or removed, rewrites its
-- request's days. Moved into someone else's column (or off the grid) it is no
-- longer that request's: it's let go and the day comes off the request.
create or replace function plan_entries_vacation_detach() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.vacation_request_id is not null and (
    new.date is null
    or new.type <> 'absence' or new.absence_type is distinct from 'vacation'
    or not exists (
      select 1 from plan_columns c join vacation_requests r on r.id = new.vacation_request_id
      where c.id = new.column_id and c.profile_id = r.profile_id
    )
  ) then
    new.vacation_request_id := null;
  end if;
  return new;
end $$;

drop trigger if exists plan_entries_vacation_detach on plan_entries;
create trigger plan_entries_vacation_detach
  before update on plan_entries
  for each row when (old.vacation_request_id is not null)
  execute function plan_entries_vacation_detach();

create or replace function plan_entries_vacation_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rid uuid := old.vacation_request_id;
  r vacation_requests;
  days date[];
begin
  -- The request's own trigger is clearing its entries; nothing to report back.
  if current_setting('vacation.syncing', true) = 'on' then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.vacation_request_id is not distinct from old.vacation_request_id
     and new.date is not distinct from old.date then
    return null;
  end if;
  select * into r from vacation_requests where id = rid;
  if not found or r.status <> 'approved' then
    return null;
  end if;
  -- What the request held, less the day that left, plus where it went.
  days := coalesce(
    r.dates,
    array(
      select g::date from generate_series(r.start_date, r.end_date, interval '1 day') g
      where extract(dow from g) not in (5, 6)
        and not exists (select 1 from plan_day_states s where g::date between s.date_from and s.date_to)
    )
  );
  days := array_remove(days, old.date);
  if tg_op = 'UPDATE' and new.vacation_request_id = rid and new.date is not null and not new.date = any(days) then
    days := days || new.date;
  end if;
  days := array(select distinct d from unnest(days) d order by d);
  perform set_config('vacation.from_plan', 'on', true);
  if cardinality(days) = 0 then
    -- Every day gone from the plan: the vacation is off.
    update vacation_requests set status = 'cancelled' where id = rid;
  else
    update vacation_requests set dates = days where id = rid;
  end if;
  perform set_config('vacation.from_plan', 'off', true);
  return null;
end $$;

drop trigger if exists plan_entries_vacation_sync on plan_entries;
create trigger plan_entries_vacation_sync
  after update or delete on plan_entries
  for each row when (old.vacation_request_id is not null)
  execute function plan_entries_vacation_sync();

-- ── Catch up: requests whose days were already dragged before this ─────────
-- (Aki's, 2026-10-29.) Only where a chip sits on a day OUTSIDE the request's
-- own days — so a range with a sick day inside it is left alone. The days kept
-- are where the chips are now, plus any day inside the range already marked
-- away some other way (those were never the request's chips to move).
do $$
declare
  r record;
  col uuid;
  days date[];
begin
  perform set_config('vacation.from_plan', 'on', true);
  for r in select * from vacation_requests where status = 'approved' and dates is null loop
    select id into col from plan_columns
      where profile_id = r.profile_id and type = 'member' order by position limit 1;
    continue when col is null;
    continue when not exists (
      select 1 from plan_entries e where e.vacation_request_id = r.id
        and (e.date < r.start_date or e.date > r.end_date or extract(dow from e.date) in (5, 6))
    );
    days := array(
      select distinct d from (
        select e.date as d from plan_entries e where e.vacation_request_id = r.id and e.date is not null
        union
        select g::date from generate_series(r.start_date, r.end_date, interval '1 day') g
        where extract(dow from g) not in (5, 6)
          and exists (select 1 from plan_entries e where e.column_id = col and e.date = g::date
                      and e.type = 'absence' and e.vacation_request_id is null)
      ) x order by d
    );
    update vacation_requests set dates = days where id = r.id;
  end loop;
  perform set_config('vacation.from_plan', 'off', true);
end $$;
