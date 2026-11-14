-- Who can reach the finance tables (v1.7.x security review, 2026-10-31).
--
-- 0005 created every finance table's policy as `using (is_admin())` — tracker
-- admin, which includes expenses-only admins like Michal. They were tightened
-- by hand later (the live database has is_finance_full_access(),
-- is_finance_admin() and can_edit_finance_expenses()), but that isn't written
-- down anywhere in this repo. This file checks it, and fixes any table that
-- was missed.
--
-- STEP 1 — read only. Run it and look at the two result sets.

-- 1a. The helper functions, as defined live.
select proname, pg_get_functiondef(oid) as definition
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('is_admin', 'is_finance_full_access', 'is_finance_admin', 'is_finance_owner', 'can_edit_finance_expenses');

-- 1b. Every policy on a finance table. `ok` is false where a table that only
-- full-finance users should reach still lets any tracker admin in.
select tablename, policyname, cmd, qual, with_check,
       not (tablename = any (array[
         'finance_pnl_monthly', 'finance_client_monthly', 'client_rates', 'finance_events',
         'finance_salaries', 'finance_freelance', 'finance_income', 'finance_undo_log',
         'finance_payslips', 'finance_person_factors', 'finance_not_hourly'
       ]) and coalesce(qual, '') ~ '^\(?is_admin\(\)\)?$') as ok
from pg_policies
where schemaname = 'public' and (tablename like 'finance%' or tablename in ('client_rates', 'fx_rates'))
order by ok, tablename, policyname;

-- STEP 2 — only if 1b shows a row with ok = false. It replaces those bare
-- is_admin() policies with is_finance_full_access(), and refuses to run unless
-- that function really checks profiles.finance_full_access. finance_expenses,
-- finance_locks and fx_rates are left alone: the Expenses page (expenses-only
-- admins) uses them.
do $$
declare p record;
begin
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'is_finance_full_access'
      and pg_get_functiondef(oid) ilike '%finance_full_access%'
  ) then
    raise exception 'is_finance_full_access() does not check finance_full_access — stop and look at 1a';
  end if;
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'finance_pnl_monthly', 'finance_client_monthly', 'client_rates', 'finance_events',
        'finance_salaries', 'finance_freelance', 'finance_income', 'finance_undo_log',
        'finance_payslips', 'finance_person_factors', 'finance_not_hourly'
      ])
      and coalesce(qual, '') ~ '^\(?is_admin\(\)\)?$'
  loop
    execute format('drop policy %I on %I', p.policyname, p.tablename);
    begin
      execute format('create policy "finance full access all" on %I for all using (is_finance_full_access()) with check (is_finance_full_access())', p.tablename);
    exception when duplicate_object then null; end;
    raise notice 'tightened %', p.tablename;
  end loop;
end $$;
