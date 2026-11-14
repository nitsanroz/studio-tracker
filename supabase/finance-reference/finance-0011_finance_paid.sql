-- Paid, apart from final (Nitsan, 2026-10-25). On the Freelance and Salaries
-- pages a green cell meant two things at once: the amount is checked and
-- locked (`state = 'final'`), and the money went out. They're separate now:
-- `paid_at` is when it was marked paid, null = not paid yet. A cell can be
-- paid and still a draft, or final and still unpaid.
--
-- Backfill: every row that is green today was green because it was paid, so
-- final rows start as paid (dated now — the real date isn't known). The lock
-- guard (finance_guard_locked) refuses any update that keeps a row final, so
-- it is switched off for the backfill only.
--
-- Run once in the Supabase SQL editor BEFORE deploying. Safe to re-run: the
-- backfill only fills rows that have no paid_at yet, and only the first time
-- the column is added.

do $$
declare t text;
begin
  foreach t in array array['finance_freelance', 'finance_salaries'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'paid_at'
    ) then
      execute format('alter table %I add column paid_at timestamptz', t);
      execute format('alter table %I disable trigger guard_locked', t);
      execute format('update %I set paid_at = now() where state = ''final'' and paid_at is null', t);
      execute format('alter table %I enable trigger guard_locked', t);
    end if;
  end loop;
end $$;
