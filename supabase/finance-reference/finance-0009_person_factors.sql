-- 1. What a person brings beyond their billable hours — guidance, client
--    relationships, culture… — as the owner rates it on their person page
--    (Pay tab, "Beyond the hours"). The levels add a premium to what their
--    work supports (valuePremium in src/lib/people.ts).
-- 2. Sick days used, per payslip — read by the payslip import, to show how
--    many days someone was out sick (already felt in their hours).
--
-- Full-finance only (is_finance_admin()), read and write.
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists finance_person_factors (
  profile_id  uuid primary key references profiles(id) on delete cascade,
  -- { "<factor id>": level }, factor ids and levels as in src/lib/people.ts (FACTORS).
  factors     jsonb not null default '{}'::jsonb,
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id) on delete set null
);

alter table finance_person_factors enable row level security;
do $$ begin
  create policy "finance admin read" on finance_person_factors for select using (is_finance_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "finance admin insert" on finance_person_factors for insert with check (is_finance_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "finance admin update" on finance_person_factors for update using (is_finance_admin()) with check (is_finance_admin());
exception when duplicate_object then null; end $$;

alter table finance_payslips add column if not exists sick_used numeric(7, 2);
