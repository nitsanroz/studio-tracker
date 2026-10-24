-- &advice: the owner's advisor pane (v1.80.0). Rule checks find things that
-- need Nitsan — a client report due, a cap filling up, work outside the
-- estimate, billable share slipping — and each finding is one row here, so a
-- snooze or a tick survives between checks.
--
-- ⚠️ OWNER ONLY. Not "admin": Michal is an admin and must not see these. Every
-- policy below is `is_owner()`, and there is NO "read all". The app reads and
-- writes through /api/advice with the service key after checking the owner
-- itself; the policies are the second lock.
--
-- ⚠️ `facts` holds PERCENTAGES, HOURS AND DATES ONLY — never an amount. The
-- tracker shows no money; the finance figures behind "income vs costs" are
-- turned into a ratio on the server before anything is stored.
--
-- Run in the Supabase SQL editor BEFORE deploying v1.80.0. Safe to re-run.

-- ── Who: the owner (the same test as 0058's vacation approver) ───────────────
create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin' and position = 'owner'
  );
$$;

-- ── One finding ──────────────────────────────────────────────────────────────
create table if not exists advice_items (
  id                  uuid primary key default gen_random_uuid(),
  -- signal + subject, e.g. 'cap:<client id>:<period start>'. The same finding
  -- on the next check is the same row.
  key                 text not null unique,
  signal              text not null,
  kind                text not null check (kind in ('now', 'heads', 'idea')),
  area                text not null,
  client_id           uuid references clients(id) on delete cascade,
  -- Bigger is worse. A snoozed item comes back early when this rises above
  -- `snoozed_at_severity` (Nitsan, 2026-10-24).
  severity            int  not null default 1,
  facts               jsonb not null default '{}'::jsonb,
  title               text not null,
  body                text not null,
  -- Claude's wording from the daily run; null = the rule's own sentence.
  worded_title        text,
  worded_body         text,
  is_reminder         boolean not null default false,
  first_seen          timestamptz not null default now(),
  last_seen           timestamptz not null default now(),
  -- Set when a check no longer finds it: the automatic "done".
  resolved_at         timestamptz,
  done_at             timestamptz,
  snoozed_until       date,
  snoozed_at_severity int
);
create index if not exists advice_items_open_idx on advice_items (resolved_at, done_at);

alter table advice_items enable row level security;
do $$ begin
  create policy "owner all" on advice_items for all
    using (is_owner()) with check (is_owner());
exception when duplicate_object then null; end $$;

-- ── One daily wording run (Claude), for cost and failure tracking ────────────
create table if not exists advice_runs (
  id            uuid primary key default gen_random_uuid(),
  run_at        timestamptz not null default now(),
  model         text,
  input_tokens  int,
  output_tokens int,
  ideas         jsonb not null default '[]'::jsonb,
  error         text
);

alter table advice_runs enable row level security;
do $$ begin
  create policy "owner all" on advice_runs for all
    using (is_owner()) with check (is_owner());
exception when duplicate_object then null; end $$;
