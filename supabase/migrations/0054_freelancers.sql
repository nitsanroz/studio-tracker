-- 0054 — freelancers log their hours through a private link, and every log
-- waits for an admin's review. Nitsan, 2026-10-13.
--
-- WHY: AB (Abolfazi Babaei) logged hours in his own Google Sheet and Nitsan
-- copied them into the tracker by hand. He should log in the tracker — but NOT
-- as a designer: every signed-in user can read ~20 tables studio-wide ("read
-- all" RLS on tasks, time_entries, clients, plan_*, comments, files…), so a
-- login would expose the whole studio to him at the API level whatever the UI
-- hid. So he gets NO login. Like the client intake form, he uses a private
-- token link, and every read and write goes through /api/log/[token] with the
-- service key, scoped to his own rows on the server.
--
-- His profile is a person without an account (0018: has_account = false, so
-- also inactive): his approved hours are credited to him, and he never appears
-- in a member list, a task picker or the weekly plan.
--
-- The flow:
--  · he logs a date, hours, one of the clients an admin enabled for him, and
--    what he did — or picks a task an admin already put one of his logs on;
--  · each log waits (`pending`) until an admin assigns a task and approves it —
--    only then does it become a real time_entries row (`time_entry_id`), so
--    nothing he writes reaches reports or client hours unreviewed;
--  · his monthly bill follows his terms: a sliding rate from `rate_high` at or
--    below `hours_low` down to `rate_low` at or above `hours_high`
--    (src/lib/freelance-rate.ts).
--
-- Admin-only RLS on all three tables, deliberately NO "read all" policy: the
-- public route reads with the service role, and only admins read here.

create table if not exists freelancers (
  profile_id uuid primary key references profiles(id) on delete cascade,
  -- The private link's secret. Regenerate it to revoke the old link.
  token text not null unique,
  active boolean not null default true,
  currency text not null default 'EUR',
  rate_high numeric(8,2) not null,
  rate_low numeric(8,2) not null,
  hours_low numeric(6,2) not null,
  hours_high numeric(6,2) not null,
  created_at timestamptz not null default now(),
  constraint freelancers_rate_band check (rate_low <= rate_high and hours_low < hours_high)
);

-- The clients a freelancer may log against — he never sees the full list.
create table if not exists freelancer_clients (
  profile_id uuid not null references freelancers(profile_id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  primary key (profile_id, client_id)
);

create table if not exists freelancer_logs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references freelancers(profile_id) on delete cascade,
  date date not null,
  minutes int not null check (minutes > 0 and minutes <= 1440),
  client_id uuid references clients(id) on delete set null,
  -- Chosen by him (only from tasks an admin already approved a log of his on)
  -- or assigned by the admin on review.
  task_id uuid references tasks(id) on delete set null,
  description text not null check (length(trim(description)) > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- The real time entry, once approved.
  time_entry_id uuid references time_entries(id) on delete set null,
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index if not exists freelancer_logs_profile_date_idx on freelancer_logs (profile_id, date desc);
create index if not exists freelancer_logs_pending_idx on freelancer_logs (status) where status = 'pending';

alter table freelancers enable row level security;
alter table freelancer_clients enable row level security;
alter table freelancer_logs enable row level security;

drop policy if exists "admin all" on freelancers;
drop policy if exists "admin all" on freelancer_clients;
drop policy if exists "admin all" on freelancer_logs;
create policy "admin all" on freelancers for all using (is_admin()) with check (is_admin());
create policy "admin all" on freelancer_clients for all using (is_admin()) with check (is_admin());
create policy "admin all" on freelancer_logs for all using (is_admin()) with check (is_admin());

-- Verify after applying, signed in as a DESIGNER (browser console) — all three
-- must come back empty, not an error and not rows:
--   for (const t of ['freelancers', 'freelancer_clients', 'freelancer_logs'])
--     console.log(t, (await supabase.from(t).select('*').limit(1)).data);
