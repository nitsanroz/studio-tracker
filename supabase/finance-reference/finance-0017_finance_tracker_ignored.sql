-- 0017 — "New in the tracker": people not to offer a line to (v1.15.0,
-- Nitsan 2026-11-05).
--
-- Salaries and Freelance offer a line for anyone the tracker has that the
-- page has no row for (lib/tracker-lines.ts) — a new member, or a freelancer
-- made in the tracker or converted from a candidate. "Not here" answers "this
-- person doesn't belong on this page" (a member who isn't on payroll), kept
-- here so it holds on every device. Its own table — never a column on the
-- tracker's `profiles` (finance never writes tracker tables).
--
-- `kind` = which page: 'salaries' or 'freelance' — someone can belong on one
-- and not the other.
--
-- The app works before this is run (it keeps "Not here" in the browser), so
-- the order doesn't matter. Run it once in the Supabase SQL editor. Safe to
-- re-run.

create table if not exists finance_tracker_ignored (
  profile_id uuid not null references profiles(id) on delete cascade,
  kind       text not null check (kind in ('salaries', 'freelance')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (profile_id, kind)
);

alter table finance_tracker_ignored enable row level security;
do $$ begin
  create policy "finance full access all" on finance_tracker_ignored for all
    using (is_finance_full_access()) with check (is_finance_full_access());
exception when duplicate_object then null; end $$;
