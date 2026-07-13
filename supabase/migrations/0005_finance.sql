-- Finance Admin — schema (Phase 0)
-- Owner-only financial section: 10-year history + live current-year entry.
-- Apply in the Supabase SQL editor (or via supabase db push). Idempotent.
-- Reuses is_admin() from 0001_init.sql. All finance tables are admin-only:
-- "admin all" policy + RLS, and deliberately NO "read all" policy.

-- ── Enums ───────────────────────────────────────────────────────────────────
-- Per-value lifecycle: predicted (estimate/forecast) → actual (real, editable)
-- → final (confirmed & locked, read-only). Replaces the old is_forecast flag:
-- is_forecast == (state = 'predicted').
do $$ begin create type finance_state as enum ('predicted', 'actual', 'final');
exception when duplicate_object then null; end $$;

do $$ begin create type finance_expense_category as enum
  ('monthly', 'yearly', 'misc', 'investment', 'rent');
exception when duplicate_object then null; end $$;

do $$ begin create type finance_recurrence as enum ('one_off', 'monthly', 'yearly');
exception when duplicate_object then null; end $$;

do $$ begin create type finance_income_source as enum ('hourly', 'fixed_project', 'other');
exception when duplicate_object then null; end $$;

-- Scope of a finalize/lock action within a month.
do $$ begin create type finance_lock_block as enum
  ('revenue', 'salaries', 'freelance', 'expenses', 'income', 'all');
exception when duplicate_object then null; end $$;

-- ── Reference / historical facts ─────────────────────────────────────────────
-- Monthly P&L facts (long format). 2017–2025 seeded from studio_more.db as
-- 'final'; current-year rows recomputed from entry tables + tracker hours.
create table if not exists finance_pnl_monthly (
  year        int  not null,
  month       int  not null check (month between 1 and 12),
  line_item   text not null,
  value       numeric(14, 2) not null default 0,
  state       finance_state  not null default 'actual',
  source      text not null default 'import',   -- 'import' | 'rollup' | 'manual'
  updated_at  timestamptz not null default now(),
  primary key (year, month, line_item)
);

-- Client-level monthly facts for the client view. Pre-2026 seeded from the DB;
-- 2026-on derived from tracker hours. client_id links to the live clients table
-- when a match exists; client_canon is always the analysis key.
create table if not exists finance_client_monthly (
  id            uuid primary key default gen_random_uuid(),
  year          int  not null,
  month         int  not null check (month between 1 and 12),
  client_id     uuid references clients(id) on delete set null,
  client_canon  text not null,
  discipline    text,
  sub_account   text,
  hours         numeric(10, 2) not null default 0,
  rate          numeric(10, 2),                  -- null for fixed-project clients
  revenue_gross numeric(14, 2) not null default 0,
  state         finance_state not null default 'actual',
  unique (year, month, client_canon, sub_account)
);
create index if not exists finance_client_monthly_ym_idx on finance_client_monthly(year, month);

-- Per-client hourly rate over time. A rate change = a new row with the change
-- date in effective_from; effective_to null means "current". Models 300→350.
create table if not exists client_rates (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid references clients(id) on delete cascade,
  client_canon   text not null,
  rate           numeric(10, 2) not null,
  effective_from date not null,
  effective_to   date,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists client_rates_canon_idx on client_rates(client_canon, effective_from);

-- Monthly USD→ILS for dollar-denominated subscriptions.
create table if not exists fx_rates (
  year    int not null,
  month   int not null check (month between 1 and 12),
  usd_ils numeric(10, 5) not null,
  primary key (year, month)
);

-- Macro-event annotations for the timeline (COVID, war, rate change, AI...).
create table if not exists finance_events (
  id       uuid primary key default gen_random_uuid(),
  year     int not null,
  month    int check (month between 1 and 12),
  event    text not null,
  category text,                                 -- 'macro' | 'internal' | 'strategic'
  note     text
);

-- ── Transactional entry (current & future) ───────────────────────────────────
create table if not exists finance_expenses (
  id             uuid primary key default gen_random_uuid(),
  date           date not null,
  category       finance_expense_category not null default 'misc',
  vendor         text not null default '',
  description    text not null default '',
  amount_gross   numeric(14, 2) not null default 0,
  amount_no_vat  numeric(14, 2),
  currency       text not null default 'ILS',
  recurrence     finance_recurrence not null default 'one_off',
  link           text,
  notes          text not null default '',
  state          finance_state not null default 'actual',
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists finance_expenses_date_idx on finance_expenses(date);

-- Name + amount only. No bank details / ID numbers (kept in Excel).
create table if not exists finance_salaries (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid references profiles(id) on delete set null,
  employee_name text not null,
  year          int not null,
  month         int not null check (month between 1 and 12),
  gross_amount  numeric(14, 2) not null default 0,
  state         finance_state not null default 'actual',
  notes         text not null default '',
  created_at    timestamptz not null default now()
);
create index if not exists finance_salaries_ym_idx on finance_salaries(year, month);

create table if not exists finance_freelance (
  id           uuid primary key default gen_random_uuid(),
  person_name  text not null,
  role         text not null default '',
  year         int not null,
  month        int not null check (month between 1 and 12),
  amount       numeric(14, 2) not null default 0,
  rate_note    text not null default '',
  state        finance_state not null default 'actual',
  notes        text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists finance_freelance_ym_idx on finance_freelance(year, month);

-- Non-hourly income only. Hourly income is computed from tracker hours, not stored.
create table if not exists finance_income (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  client_id   uuid references clients(id) on delete set null,
  source      finance_income_source not null default 'fixed_project',
  amount      numeric(14, 2) not null default 0,
  description text not null default '',
  state       finance_state not null default 'actual',
  created_at  timestamptz not null default now()
);
create index if not exists finance_income_date_idx on finance_income(date);

-- ── Period locks ─────────────────────────────────────────────────────────────
-- A lock finalizes a scope. scope_month null = whole-year lock.
-- block = which data block within the month is finalized.
create table if not exists finance_locks (
  id          uuid primary key default gen_random_uuid(),
  scope_year  int not null,
  scope_month int check (scope_month between 1 and 12),
  block       finance_lock_block not null default 'all',
  locked_at   timestamptz not null default now(),
  locked_by   uuid references profiles(id) on delete set null,
  note        text,
  unique (scope_year, scope_month, block)
);

-- ── Lock enforcement (defense in depth: UI blocks it too) ────────────────────
-- Refuse to UPDATE or DELETE a row that is already 'final', UNLESS the update
-- is an explicit unlock (state moving away from 'final'). Unlocking is an
-- admin action performed in the app and logged via finance_locks removal.
create or replace function finance_guard_locked() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.state = 'final' then
      raise exception 'Finance row is finalized/locked; unlock the period before deleting.';
    end if;
    return OLD;
  end if;
  -- UPDATE: allow only if leaving the final state (an unlock); block edits that
  -- keep it final.
  if OLD.state = 'final' and NEW.state = 'final' then
    raise exception 'Finance row is finalized/locked; unlock the period before editing.';
  end if;
  return NEW;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'finance_expenses', 'finance_salaries', 'finance_freelance',
    'finance_income', 'finance_client_monthly', 'finance_pnl_monthly'
  ] loop
    execute format('drop trigger if exists guard_locked on %I', t);
    execute format(
      'create trigger guard_locked before update or delete on %I
         for each row execute function finance_guard_locked()', t);
  end loop;
end $$;

-- ── Row-level security: admin-only, no designer read ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'finance_pnl_monthly', 'finance_client_monthly', 'client_rates', 'fx_rates',
    'finance_events', 'finance_expenses', 'finance_salaries', 'finance_freelance',
    'finance_income', 'finance_locks'
  ] loop
    execute format('alter table %I enable row level security', t);
    begin
      execute format('create policy "admin all" on %I for all using (is_admin())', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
