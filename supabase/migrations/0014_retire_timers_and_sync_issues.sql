-- 0014 — Retire timers, and never lose an Everhour entry again.
--
-- Part A: the timer feature is gone from the app. Members log time manually
--         with a mandatory description; nobody used timers.
-- Part B: `sync_issues` — one row per Everhour time entry the sync could NOT
--         import (its task or its person isn't mapped in the tracker). These
--         used to be counted in a log line and forgotten, which meant a client
--         report could quietly understate real, logged hours. Now every gap
--         lands in an admin queue until it is imported or explicitly ignored.

-- ── Part A: timers ────────────────────────────────────────────────────────
-- A row with minutes IS NULL was a timer that was never stopped: it holds no
-- hours, only a start time, and no UI can complete it any more. Inspect first
-- if you want a record of what goes:
--   select id, task_id, user_id, date, started_at from time_entries where minutes is null;
delete from time_entries where minutes is null;

alter table time_entries drop constraint if exists timer_or_minutes;
alter table time_entries alter column minutes set not null;

comment on column time_entries.started_at is
  'Legacy: written by the removed timer feature. Kept as provenance on historical entries; nothing writes it now.';

-- ── Part B: Everhour sync-issue queue ─────────────────────────────────────
create table if not exists sync_issues (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'everhour',
  -- the Everhour time-entry id: one issue per entry, so a nightly re-sync
  -- can never double-count and an old gap can never fall out of the window
  everhour_id text not null,
  kind text not null check (kind in ('unmapped_task', 'unmapped_user', 'unmapped_both')),
  entry_date date not null,
  minutes int not null default 0,
  description text not null default '',
  everhour_task_id text,
  everhour_task_name text not null default '',
  everhour_user_id text,
  everhour_user_name text not null default '',
  status text not null default 'open' check (status in ('open', 'imported', 'ignored')),
  note text not null default '',
  resolved_at timestamptz,
  resolved_by uuid references profiles(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source, everhour_id)
);

create index if not exists sync_issues_status_idx on sync_issues(status);
create index if not exists sync_issues_task_idx on sync_issues(everhour_task_id);

alter table sync_issues enable row level security;

-- Admin-only: rows name client tasks and unmapped people. The sync itself
-- writes with the service role, which bypasses RLS.
do $$ begin
  create policy "admin all" on sync_issues for all using (is_admin());
exception when duplicate_object then null; end $$;
