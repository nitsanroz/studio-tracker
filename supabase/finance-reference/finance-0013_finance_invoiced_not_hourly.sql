-- Two additions (Nitsan, 2026-10-31: "do all 6" from the v1.7.x review).
--
-- 1. Invoiced on the Plan: a step between Final and Paid for the Plan's two
--    kinds of income cell — clients' hours (`finance_client_monthly`) and
--    project income (`finance_income`). Draft → Predicted → Final → Invoiced
--    → Paid. `invoiced_at` = when the invoice went out; null = not yet. Like
--    paid (0012), invoiced implies final, and paid implies invoiced. No
--    backfill: a paid row reads as paid whatever its invoiced_at, and this
--    year's open months are for Nitsan to mark.
--
-- 2. "Not billed hourly" clients: the new-client prompt's answer for a
--    retainer or fixed-fee client, kept here instead of one browser's
--    localStorage, so it holds on every device. Its own table — never a
--    column on the tracker's `clients` (finance never writes tracker tables).
--
-- The app works before this is run (it hides Invoiced and keeps "not billed
-- hourly" in the browser), so the order doesn't matter, but run it once in the
-- Supabase SQL editor to switch both on. Safe to re-run.

do $$
declare t text;
begin
  foreach t in array array['finance_client_monthly', 'finance_income'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'invoiced_at'
    ) then
      execute format('alter table %I add column invoiced_at timestamptz', t);
    end if;
  end loop;
end $$;

create table if not exists finance_not_hourly (
  client_id  uuid primary key references clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

alter table finance_not_hourly enable row level security;
do $$ begin
  create policy "finance full access all" on finance_not_hourly for all
    using (is_finance_full_access()) with check (is_finance_full_access());
exception when duplicate_object then null; end $$;
