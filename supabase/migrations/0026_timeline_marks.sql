-- ── Milestones on a client's Timeline ─────────────────────────────────────
--
-- A named point in time — "kickoff", "site publish", "development starts" —
-- drawn as a vertical line across the chart. Not a task: it has no duration,
-- no assignee, no hours, and nothing is ever logged against it.
--
-- `on_date` is a plain date and is deliberately NOT snapped to a working day.
-- Task dates are, because work happens Sun–Thu; a launch or a client deadline
-- can perfectly well fall on a Friday.
create table if not exists timeline_marks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  on_date date not null,
  title text not null default '',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists timeline_marks_client_idx on timeline_marks(client_id, on_date);

alter table timeline_marks enable row level security;

-- Everyone signed in can READ them: the Timeline is a read-only view for
-- members, and a plan missing its milestones is a plan missing the point.
do $$ begin
  create policy "read all" on timeline_marks for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

-- Only admins create, rename, move or delete — the same rule as every other
-- edit on that chart.
do $$ begin
  create policy "admin write" on timeline_marks for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- No anon policy: the public /gantt/[token] page reads via the service role.
