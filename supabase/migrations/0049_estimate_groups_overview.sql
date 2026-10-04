-- 0049 — estimates take the client page's shape, so a won lead converts 1:1.
--
-- Client page:  section → group → task       (sections, task_groups, tasks)
-- Estimate:     phase   → group → line       (estimate_phases, estimate_groups, estimate_lines)
--
-- A group is a SUBJECT inside a phase (e.g. one webpage's design, mobile, QA),
-- the same idea as `task_groups` (0027). It is NOT the "choose one" option
-- group, which stays `estimate_lines.alt_group`.
--
-- Deleting a group DISSOLVES it (lines move up to the phase), like a task
-- group; deleting a phase still takes its lines and groups with it.
--
-- The estimate also gains an Overview — notes + titled links — shaped like the
-- client page's Overview, so they can be carried across on conversion.
-- `links` is jsonb ([{title, url}]) rather than rows in `links`, whose CHECK
-- allows exactly a task OR a client owner.

create table if not exists estimate_groups (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references lead_estimates(id) on delete cascade,
  phase_id uuid references estimate_phases(id) on delete cascade,
  name text not null default 'Group',
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists estimate_groups_est_idx on estimate_groups(estimate_id, position);

alter table estimate_groups enable row level security;
do $$ begin
  create policy "admin all" on estimate_groups for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

alter table estimate_lines add column if not exists group_id uuid references estimate_groups(id) on delete set null;

alter table lead_estimates add column if not exists notes text;
alter table lead_estimates add column if not exists links jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
