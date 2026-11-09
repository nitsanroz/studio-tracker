-- 0064: which client months the finance app's Plan has marked Paid — as
-- booleans, never amounts.
--
-- Nitsan, 2026-11-09: marking a client's month Paid on finance-admin's Plan
-- should also show that client's payment period as paid in Client Reports, so
-- "paid" is ticked once, not twice. The Plan's Paid step is
-- `finance_client_monthly.paid_at` (finance-admin reference/0012); finance
-- never writes tracker tables, so the tracker READS it — through this function,
-- because `finance_client_monthly` is finance-full-access only and Michal
-- (tracker admin, no finance access) works in Client Reports.
--
-- ⚠️ BOOLEANS ONLY. The rows hold hours, rates and revenue; none of it may
-- leave here. A month is returned only when the Plan has a row for it, and is
-- `paid` when EVERY one of that client-month's rows (sub-accounts included)
-- carries a `paid_at` — the Plan moves a client's month as one cell.
--
-- A Plan row belongs to a tracker client when its `client_id` is that client,
-- or its `client_canon` is the client's name — the same rule finance-admin's
-- &advice uses (signals.ts `paidOnPlan`), so the two never disagree.
--
-- SECURITY DEFINER so it can read past the finance RLS; gated on is_admin()
-- inside, so a member calling it gets no rows.
--
-- Run once in the Supabase SQL editor. Order vs deploy doesn't matter — the app
-- treats a missing function as "nothing paid in finance". Safe to re-run.

create or replace function public.client_months_paid(
  client_ids uuid[],
  from_month date,
  to_month   date
)
returns table (client_id uuid, year int, month int, paid boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, f.year, f.month, bool_and(f.paid_at is not null)
  from clients c
  join finance_client_monthly f
    on f.client_id = c.id or f.client_canon = c.name
  where is_admin()
    and c.id = any(client_ids)
    and make_date(f.year, f.month, 1)
        between date_trunc('month', from_month)::date and date_trunc('month', to_month)::date
  group by c.id, f.year, f.month;
$$;

revoke execute on function public.client_months_paid(uuid[], date, date) from public, anon;
grant execute on function public.client_months_paid(uuid[], date, date) to authenticated;

notify pgrst, 'reload schema';
