-- ── 0024: task types ────────────────────────────────────────────────────────
-- A task's KIND OF WORK — design, QA, wireframe, content — as a first-class
-- field with a colour, which is what the client Timeline paints its bars with.
--
-- Deliberately NOT the existing `tags`. The studio's tags are workflow STATES
-- ("in design", "Client approval", "Development", "Approved"); folding the two
-- together would mean a task could say it's a QA job or that it's awaiting
-- approval, never both. Nitsan chose to keep them as separate axes.
--
-- `type_id` is intentionally ABSENT from the 0011 trigger's protected list, so
-- members may set it. It belongs with `tag_id` — describing the work is
-- collaborative, unlike scheduling it (`due_date`, `start_date`,
-- `timeline_position`), which stays admin-only.

create table if not exists task_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#6b7280',
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table task_types enable row level security;

-- Same convention as tags/clients/occasions: everyone reads, admins write.
do $$ begin
  create policy "read all" on task_types for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "admin write" on task_types for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

alter table tasks add column if not exists type_id uuid references task_types(id) on delete set null;

create index if not exists tasks_type_idx on tasks(type_id);

-- The set Nitsan named, in the order he named it. Colours are spread around the
-- wheel so adjacent bars on a Gantt stay tellable apart; `where not exists`
-- keeps the migration re-runnable without duplicating the list.
insert into task_types (name, color, position)
select * from (values
  ('Design',        '#0b43ed', 1),
  ('Wireframe',     '#6181e8', 2),
  ('Content',       '#ca8a04', 3),
  ('Image making',  '#c026d3', 4),
  ('Development',   '#7c3aed', 5),
  ('QA',            '#0f9d58', 6),
  ('Client side',   '#ea580c', 7)
) as v(name, color, position)
where not exists (select 1 from task_types);
