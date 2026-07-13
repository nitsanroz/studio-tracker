-- July 2026 improvement batch: absence cleanup, tag colors, team/HR fields,
-- admin-only user notes, shareable client report links.
-- Apply in the Supabase SQL editor. Idempotent where possible; the absence
-- enum recreate is guarded so re-running is safe.

-- ── Absences: drop wfh + half_day (delete data first, then recreate enum) ──
delete from plan_entries where absence_type in ('wfh', 'half_day');

do $$ begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'absence_type' and e.enumlabel in ('wfh', 'half_day')
  ) then
    alter type absence_type rename to absence_type_old;
    create type absence_type as enum ('vacation', 'sick', 'day_off');
    alter table plan_entries
      alter column absence_type type absence_type
      using absence_type::text::absence_type;
    drop type absence_type_old;
  end if;
end $$;

-- ── Tag colors ─────────────────────────────────────────────────────────────
alter table tags add column if not exists color text not null default '#6b7280';

-- ── Team/HR fields (profiles is readable by all signed-in users — safe fields only) ──
alter table profiles add column if not exists start_date date;
alter table profiles add column if not exists capacity_hours_week numeric(5,2);

-- HR notes are admin-only, so they live in their own table (profiles has "read all" RLS).
create table if not exists member_notes (
  profile_id uuid primary key references profiles(id) on delete cascade,
  notes text not null default '',
  updated_at timestamptz not null default now()
);
alter table member_notes enable row level security;
do $$ begin
  create policy "admin all" on member_notes for all using (is_admin());
exception when duplicate_object then null; end $$;
-- deliberately no "read all" policy

-- ── Shareable client report links (mirrors intake_links) ───────────────────
create table if not exists report_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  preset text,          -- rolling range, e.g. 'This month' (re-evaluated at view time)
  date_from date,       -- OR a frozen range (preset null)
  date_to date,
  active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table report_links enable row level security;
do $$ begin
  create policy "admin all" on report_links for all using (is_admin());
exception when duplicate_object then null; end $$;
-- deliberately no anon policy: the public /report/[token] page reads via the service role
