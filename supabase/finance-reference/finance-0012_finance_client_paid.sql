-- Paid on the Plan (Nitsan, 2026-10-25): the client paid us. The fourth step
-- after Draft → Predicted → Final, as on Freelance and Salaries (0011), for
-- the Plan's two kinds of income cell: clients' hours
-- (`finance_client_monthly`) and project income (`finance_income`).
-- `paid_at` = when it was marked paid; null = not paid yet. Paid implies final.
--
-- Backfill: final rows of CLOSED years (before this one) start as paid — those
-- clients paid long ago, and leaving them unmarked would show every past year
-- as owed. This year's rows are left for Nitsan to mark. The lock guard
-- (finance_guard_locked) refuses any update that keeps a row final, so it is
-- switched off for the backfill only.
--
-- Run once in the Supabase SQL editor BEFORE deploying. Safe to re-run: the
-- backfill runs only the first time the column is added.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_client_monthly' and column_name = 'paid_at'
  ) then
    alter table finance_client_monthly add column paid_at timestamptz;
    alter table finance_client_monthly disable trigger guard_locked;
    update finance_client_monthly set paid_at = now()
      where state = 'final' and year < extract(year from now())::int;
    alter table finance_client_monthly enable trigger guard_locked;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_income' and column_name = 'paid_at'
  ) then
    alter table finance_income add column paid_at timestamptz;
    alter table finance_income disable trigger guard_locked;
    update finance_income set paid_at = now()
      where state = 'final' and extract(year from date) < extract(year from now());
    alter table finance_income enable trigger guard_locked;
  end if;
end $$;
