-- Scenarios (v1.29.0): the owner's what-if page. Saved scenarios (a list of
-- decisions + three demand futures), the page's settings (company facts from
-- the accountant's 2025 report, take-home and cash floors), and the advisor's
-- answers. Nothing here is a finance figure the P&L reads — the page never
-- writes a finance table.
--
-- ⚠️ OWNER ONLY (Nitsan, 2026-11-11: "exposed only to me and not to Michal"):
-- the same is_finance_owner() as &advice (reference/0010). Never widen to
-- is_admin() — these rows hold the owner's loan, cash and pay decisions.
--
-- Run once in the Supabase SQL editor BEFORE deploying v1.29.0. Safe to re-run.
-- Needs reference/0010 (is_finance_owner) — already applied.

create table if not exists finance_scenarios (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  notes       text not null default '',
  -- [{id, type, from, ...params}] — src/lib/scenarios/decisions.ts
  decisions   jsonb not null default '[]'::jsonb,
  -- null = use the page's default futures
  futures     jsonb,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One row (id = 1): company facts, floors, default futures.
create table if not exists finance_scenario_settings (
  id          int primary key default 1 check (id = 1),
  settings    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Each advisor call: what was asked, what came back (or the error).
create table if not exists finance_scenario_advice (
  id             uuid primary key default gen_random_uuid(),
  scenario_ids   uuid[] not null default '{}',
  kind           text not null check (kind in ('advise', 'compare', 'suggest')),
  run_at         timestamptz not null default now(),
  model          text,
  input_tokens   int,
  output_tokens  int,
  result         jsonb,
  error          text
);
create index if not exists finance_scenario_advice_run_at on finance_scenario_advice (run_at desc);

alter table finance_scenarios enable row level security;
alter table finance_scenario_settings enable row level security;
alter table finance_scenario_advice enable row level security;

do $$ begin
  create policy "finance owner all" on finance_scenarios for all
    using (is_finance_owner()) with check (is_finance_owner());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "finance owner all" on finance_scenario_settings for all
    using (is_finance_owner()) with check (is_finance_owner());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "finance owner all" on finance_scenario_advice for all
    using (is_finance_owner()) with check (is_finance_owner());
exception when duplicate_object then null; end $$;
