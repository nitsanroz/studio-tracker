-- &advice in finance (v1.6.0): the owner's advisor pane, the money version of
-- studio-tracker's (its 0059). Rule checks find what needs Nitsan — a month
-- under break-even pace, an unpaid period, hours with no rate, a month not
-- closed — and each finding is one row here, so a snooze or a tick survives
-- between checks.
--
-- ⚠️ ITS OWN TABLES, NOT THE TRACKER'S `advice_items`. These rows hold real
-- amounts (₪/€); the tracker's must never carry one (Nitsan, 2026-10-24).
--
-- ⚠️ OWNER ONLY: tracker role admin + position owner + finance_full_access.
-- Not every full-finance user — Nitsan's choice, 2026-10-24.
--
-- Run once in the Supabase SQL editor BEFORE deploying v1.6.0. Safe to re-run.

create or replace function is_finance_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and position = 'owner' and finance_full_access = true
  );
$$;

-- ── One finding ──────────────────────────────────────────────────────────────
create table if not exists finance_advice_items (
  id                  uuid primary key default gen_random_uuid(),
  -- signal + subject, e.g. 'unpaid:<client id>:<period start>'. The same
  -- finding on the next check is the same row.
  key                 text not null unique,
  signal              text not null,
  kind                text not null check (kind in ('now', 'heads', 'idea')),
  area                text not null,
  client_id           uuid references clients(id) on delete cascade,
  -- Bigger is worse. A snoozed or ticked item comes back early when this
  -- rises above `snoozed_at_severity`.
  severity            int  not null default 1,
  -- Figures behind the finding, amounts included. Keys ending in Ils/Eur and
  -- `figure` are money: they never go to Claude (src/lib/advice/word.ts).
  facts               jsonb not null default '{}'::jsonb,
  title               text not null,
  body                text not null,
  -- Claude's wording from the day's run; null = the rule's own sentence.
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
create index if not exists finance_advice_items_open_idx on finance_advice_items (resolved_at, done_at);

alter table finance_advice_items enable row level security;
do $$ begin
  create policy "finance owner all" on finance_advice_items for all
    using (is_finance_owner()) with check (is_finance_owner());
exception when duplicate_object then null; end $$;

-- ── One wording run (Claude, first open of the day) ─────────────────────────
create table if not exists finance_advice_runs (
  id            uuid primary key default gen_random_uuid(),
  run_at        timestamptz not null default now(),
  model         text,
  input_tokens  int,
  output_tokens int,
  ideas         jsonb not null default '[]'::jsonb,
  error         text
);

alter table finance_advice_runs enable row level security;
do $$ begin
  create policy "finance owner all" on finance_advice_runs for all
    using (is_finance_owner()) with check (is_finance_owner());
exception when duplicate_object then null; end $$;
