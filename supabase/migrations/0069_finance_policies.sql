-- The finance tables' access rules, written down (2026-11-14).
--
-- WHY: 0005 created every finance table as `using (is_admin())`. They were
-- tightened later by hand in the SQL editor, and neither repo had a file for
-- the result — so the repo's SQL said one thing (any admin reads salaries and
-- the P&L) while the database did another, and re-running 0005 or copying its
-- policies would have quietly reopened finance to every admin.
--
-- This file IS the live state, read from pg_proc and pg_policies by Nitsan on
-- 2026-11-14 (queries 1a/1b of finance-admin's reference/0014). It is meant to
-- change nothing, with ONE exception:
--
--   `is_finance_full_access()` was the only helper defined without SECURITY
--   DEFINER and without a search_path. It worked because `profiles` has
--   "read all"; it would silently start answering false for everyone the day
--   that policy is narrowed. It now matches the other four.
--
-- The four rules, and who they let in:
--   is_finance_owner()           admin + position owner + finance_full_access
--   is_finance_full_access()     admin + finance_full_access
--   is_finance_admin()           the same test (kept: policies name it)
--   can_edit_finance_expenses()  any admin — the same test as is_admin()
--
-- So an admin without the flag (Michal) reaches exactly: finance_expenses,
-- finance_expense_month_check, the 'expenses' block of finance_locks,
-- finance_documents, finance_mail_receipts (read + decide, never insert or
-- delete) and finance_mail_ignored. Nothing else.
--
-- ⚠️ `fx_rates` is full-finance only. finance-admin's docs said the Expenses
-- page reads it as any admin; the database says otherwise, and this file keeps
-- the database. Widening it is a decision, not a tidy-up.
--
-- ⚠️ Several tables carry two policies that say the same thing
-- (finance_expenses, finance_locks). Kept as they are: policies are OR-ed, so
-- they are harmless, and this file's job is to record, not to redesign.
--
-- Run in the Supabase SQL editor, the whole file at once. Safe to re-run. If it
-- stops halfway, a table may be left with NO policy — which shuts it to
-- everyone until the file is run again; it can never leave one open.

begin;

-- ── Who ──────────────────────────────────────────────────────────────────────
create or replace function is_finance_full_access() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and finance_full_access = true
  );
$$;

create or replace function is_finance_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and finance_full_access
  );
$$;

create or replace function is_finance_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and position = 'owner' and finance_full_access = true
  );
$$;

create or replace function can_edit_finance_expenses() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ── Full finance only ────────────────────────────────────────────────────────
-- The P&L, client revenue, rates, salaries, freelance pay, income, events, FX.
drop policy if exists "full access admin all" on finance_pnl_monthly;
create policy "full access admin all" on finance_pnl_monthly for all using (is_finance_full_access());

drop policy if exists "full access admin all" on finance_client_monthly;
create policy "full access admin all" on finance_client_monthly for all using (is_finance_full_access());

drop policy if exists "full access admin all" on client_rates;
create policy "full access admin all" on client_rates for all using (is_finance_full_access());

drop policy if exists "full access admin all" on finance_events;
create policy "full access admin all" on finance_events for all using (is_finance_full_access());

drop policy if exists "full access admin all" on finance_salaries;
create policy "full access admin all" on finance_salaries for all using (is_finance_full_access());

drop policy if exists "full access admin all" on finance_freelance;
create policy "full access admin all" on finance_freelance for all using (is_finance_full_access());

drop policy if exists "full access admin all" on finance_income;
create policy "full access admin all" on finance_income for all using (is_finance_full_access());

drop policy if exists "full access admin all" on fx_rates;
create policy "full access admin all" on fx_rates for all using (is_finance_full_access());

drop policy if exists "finance full access all" on finance_not_hourly;
create policy "finance full access all" on finance_not_hourly for all
  using (is_finance_full_access()) with check (is_finance_full_access());

drop policy if exists "finance full access all" on finance_tracker_ignored;
create policy "finance full access all" on finance_tracker_ignored for all
  using (is_finance_full_access()) with check (is_finance_full_access());

drop policy if exists "finance full access all" on finance_undo_log;
create policy "finance full access all" on finance_undo_log for all
  using (is_finance_full_access()) with check (is_finance_full_access());

-- Payslips: read only. The importer writes with the service key.
drop policy if exists "finance admin read" on finance_payslips;
create policy "finance admin read" on finance_payslips for select using (is_finance_admin());

-- Person factors: read, add, change — never delete.
drop policy if exists "finance admin read" on finance_person_factors;
create policy "finance admin read" on finance_person_factors for select using (is_finance_admin());
drop policy if exists "finance admin insert" on finance_person_factors;
create policy "finance admin insert" on finance_person_factors for insert with check (is_finance_admin());
drop policy if exists "finance admin update" on finance_person_factors;
create policy "finance admin update" on finance_person_factors for update
  using (is_finance_admin()) with check (is_finance_admin());

-- ── The owner only ───────────────────────────────────────────────────────────
-- &advice, the mailbox connections, Scenarios. Never widen these to is_admin().
drop policy if exists "finance owner all" on finance_advice_items;
create policy "finance owner all" on finance_advice_items for all
  using (is_finance_owner()) with check (is_finance_owner());

drop policy if exists "finance owner all" on finance_advice_runs;
create policy "finance owner all" on finance_advice_runs for all
  using (is_finance_owner()) with check (is_finance_owner());

drop policy if exists "finance owner all" on finance_mail_accounts;
create policy "finance owner all" on finance_mail_accounts for all
  using (is_finance_owner()) with check (is_finance_owner());

drop policy if exists "finance owner all" on finance_tool_mail;
create policy "finance owner all" on finance_tool_mail for all
  using (is_finance_owner()) with check (is_finance_owner());

drop policy if exists "finance owner all" on finance_scenarios;
create policy "finance owner all" on finance_scenarios for all
  using (is_finance_owner()) with check (is_finance_owner());

drop policy if exists "finance owner all" on finance_scenario_settings;
create policy "finance owner all" on finance_scenario_settings for all
  using (is_finance_owner()) with check (is_finance_owner());

drop policy if exists "finance owner all" on finance_scenario_advice;
create policy "finance owner all" on finance_scenario_advice for all
  using (is_finance_owner()) with check (is_finance_owner());

-- ── Any admin: the Expenses page ─────────────────────────────────────────────
drop policy if exists "admin all" on finance_expenses;
create policy "admin all" on finance_expenses for all
  using (is_finance_admin()) with check (is_finance_admin());
drop policy if exists "expenses editor" on finance_expenses;
create policy "expenses editor" on finance_expenses for all
  using (can_edit_finance_expenses()) with check (can_edit_finance_expenses());

drop policy if exists "admin all" on finance_expense_month_check;
create policy "admin all" on finance_expense_month_check for all using (is_admin());

-- Locks: full finance has every block; any admin only the 'expenses' block.
drop policy if exists "full access admin all" on finance_locks;
create policy "full access admin all" on finance_locks for all using (is_finance_full_access());
drop policy if exists "expenses admin on expenses block" on finance_locks;
create policy "expenses admin on expenses block" on finance_locks for all
  using (is_admin() and block = 'expenses'::finance_lock_block)
  with check (is_admin() and block = 'expenses'::finance_lock_block);
drop policy if exists "expenses editor" on finance_locks;
create policy "expenses editor" on finance_locks for all
  using (can_edit_finance_expenses() and block = 'expenses'::finance_lock_block)
  with check (can_edit_finance_expenses() and block = 'expenses'::finance_lock_block);

-- Invoices and receipts filed against expenses.
drop policy if exists "finance owner all" on finance_documents;
create policy "finance owner all" on finance_documents for all
  using (is_finance_owner()) with check (is_finance_owner());
drop policy if exists "expenses users all" on finance_documents;
create policy "expenses users all" on finance_documents for all
  using (is_admin()) with check (is_admin());

-- Receipts found in mail: the owner owns them; any admin reads and decides
-- (files one against an expense, or dismisses it) but cannot add or remove.
drop policy if exists "finance owner all" on finance_mail_receipts;
create policy "finance owner all" on finance_mail_receipts for all
  using (is_finance_owner()) with check (is_finance_owner());
drop policy if exists "expenses users read" on finance_mail_receipts;
create policy "expenses users read" on finance_mail_receipts for select using (is_admin());
drop policy if exists "expenses users decide" on finance_mail_receipts;
create policy "expenses users decide" on finance_mail_receipts for update
  using (is_admin()) with check (is_admin());

drop policy if exists "finance owner all" on finance_mail_ignored;
create policy "finance owner all" on finance_mail_ignored for all
  using (is_finance_owner()) with check (is_finance_owner());
drop policy if exists "expenses users all" on finance_mail_ignored;
create policy "expenses users all" on finance_mail_ignored for all
  using (is_admin()) with check (is_admin());

commit;

-- Verify with supabase/checks/check-finance-access.sql — every row ok = true.
