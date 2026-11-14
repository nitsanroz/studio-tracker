-- Payslip figures, one row per person per month — read from the Michpal
-- payslip PDFs on the owner's Mac by scripts/import-payslips.ts. The PDFs
-- never leave the Mac: only these numbers are stored.
--
-- Full-finance only (is_finance_admin()). No insert/update policy on purpose:
-- only the importer writes, with the service-role key, which skips RLS.
-- Employees reach their own vacation balance through the tracker's
-- my_vacation() function (tracker migration 0058), never this table.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists finance_payslips (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references profiles(id) on delete cascade,
  year             int  not null check (year between 2000 and 2100),
  month            int  not null check (month between 1 and 12),
  -- משכורת (code 001): full-time rate (₪/month, or ₪/hour for hourly pay),
  -- quantity (job share, or hours), and the amount paid this month.
  salary_rate      numeric(12, 2),
  salary_quantity  numeric(10, 2),
  salary_paid      numeric(12, 2),
  -- סה"כ תשלומים: everything paid this month before deductions.
  gross_total      numeric(12, 2),
  -- חשבון חופשה (days): carried over, accrued, used, left.
  vacation_previous numeric(7, 2),
  vacation_accrued  numeric(7, 2),
  vacation_used     numeric(7, 2),
  vacation_balance  numeric(7, 2),
  sick_balance      numeric(7, 2),
  -- The file it came from (name only, no path) and its SHA-256, so a
  -- re-run skips files it has already read.
  source_file      text not null,
  source_sha256    text not null,
  imported_at      timestamptz not null default now(),
  unique (profile_id, year, month)
);

alter table finance_payslips enable row level security;
do $$ begin
  create policy "finance admin read" on finance_payslips for select using (is_finance_admin());
exception when duplicate_object then null; end $$;
