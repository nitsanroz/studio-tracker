-- 0015 — Custom occasions for the home "Coming up" pane.
--
-- Only CUSTOM entries live here. The three groups the studio asked for need no rows:
--   • birthdays          — derived from member_hr.birth_date
--   • work anniversaries — derived from profiles.start_date
--   • Jewish holidays    — COMPUTED from the Hebrew calendar at runtime
--     (src/lib/jewish-holidays.ts, via ICU). Deliberately not seeded: Hebrew dates
--     drift against the Gregorian year, so a seeded table would need re-seeding
--     every year and would go quietly stale the first year nobody remembered.
--
-- Which groups are shown is stored in app_settings under the key
-- 'occasion_groups' (no schema needed — app_settings is already key/jsonb).

create table if not exists occasions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- A specific dated event. `recurring` repeats it every year on the same
  -- month/day (studio anniversary, a recurring deadline); otherwise it's one-off
  -- and drops out of view once it has passed.
  date date not null,
  recurring boolean not null default false,
  icon text not null default '📅',
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);

create index if not exists occasions_date_idx on occasions(date);

alter table occasions enable row level security;

-- Readable by any signed-in member (the pane is on everyone's home page);
-- only admins add, edit or remove — matching the clients/tags convention.
do $$ begin
  create policy "read all" on occasions for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "admin write" on occasions for all using (is_admin());
exception when duplicate_object then null; end $$;
