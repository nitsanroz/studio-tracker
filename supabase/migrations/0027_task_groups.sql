-- ── 0027: task groups ───────────────────────────────────────────────────────
--
-- A THIRD level in the hierarchy: Client → Section → **Group** → Task.
--
-- A section is a phase ("Website", "Branding"). A group is a SUBJECT inside one
-- — the several tasks that belong to a single webpage. Before this, the only way
-- to express that was a section per page, which stopped the section list from
-- describing phases at all.
--
-- ⚠️ A group is NOT a task and hours are never logged against it. That is why
-- this is its own table rather than `tasks.parent_id` + an `is_group` flag (the
-- Asana model): roughly thirty files iterate `tasks` — My Tasks, the Board,
-- autocomplete, Reports, the KPI tiles, intake, `taskMinutes` — and every one of
-- them would silently start counting container rows as work. Keeping groups out
-- of `tasks` means `tasks` still means exactly what it meant yesterday, and the
-- blast radius is confined to the surfaces that GROUP tasks. This repo has been
-- here once already: 0007 flattened the Projects layer out for the same reason.
--
-- One level only. There is deliberately no `task_groups.parent_id`.
create table if not exists task_groups (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  -- Null = a group in the client's "No section" bucket, mirroring how a task
  -- with no section is handled. `set null` rather than `cascade` for the same
  -- reason tasks use it: losing a section must not destroy the work under it.
  section_id uuid references sections(id) on delete set null,
  name text not null,
  -- Order among its SIBLING GROUPS within the section. Groups render before the
  -- section's loose tasks, so this never has to interleave with `tasks.position`
  -- — one shared ordering space across two tables would mean a reorder
  -- renumbering rows it doesn't own.
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists task_groups_client_idx on task_groups(client_id, section_id, position);

-- ⚠️ INVARIANT, enforced in the APP (store's `updateTask`) and not here: a
-- task's group must belong to the task's section. A composite FK would need
-- `tasks(section_id, group_id)` to reference a unique key on
-- `task_groups(section_id, id)`, which forbids the null-section case outright.
-- Every read path is defensive instead — a group counts only when its
-- `section_id` matches the task's, otherwise the task renders loose — so a
-- hand-edited row degrades to "ungrouped", never to an invisible task.
alter table tasks add column if not exists group_id uuid references task_groups(id) on delete set null;
create index if not exists tasks_group_idx on tasks(group_id);

alter table task_groups enable row level security;

-- Read-all, admin-write: character for character the rule `sections` follows.
do $$ begin
  create policy "read all" on task_groups for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "admin write" on task_groups for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- No anon policy: the public /gantt/[token] page reads via the service role.

-- ⚠️ Re-declare the 0011 trigger to protect `group_id`. It enumerates its
-- protected columns BY NAME, so a NEW task column is member-writable by
-- DEFAULT — this same amendment was needed by 0022 (`start_date`) and 0023
-- (`timeline_position`). `section_id` has always been admin-only, so filing a
-- task into a group has to be too; without this line a designer could re-file
-- any task through the API while the UI told them the field was read-only.
--
-- Everything else below is 0023's body unchanged. See 0011 for the reasoning.
create or replace function enforce_task_member_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_admin() then
    return new;  -- admins may change anything
  end if;

  if new.title        is distinct from old.title
  or new.estimate_hours is distinct from old.estimate_hours
  or new.due_date     is distinct from old.due_date
  or new.start_date   is distinct from old.start_date        -- added by 0022
  or new.timeline_position is distinct from old.timeline_position  -- added by 0023
  or new.group_id     is distinct from old.group_id          -- added by 0027
  or new.billable     is distinct from old.billable
  or new.status       is distinct from old.status
  or new.completed_at is distinct from old.completed_at
  or new.client_id    is distinct from old.client_id
  or new.section_id   is distinct from old.section_id
  or new.assignee_id  is distinct from old.assignee_id
  or new.pending      is distinct from old.pending
  or new.project_id   is distinct from old.project_id
  or new.everhour_id  is distinct from old.everhour_id
  or new.asana_gid    is distinct from old.asana_gid
  then
    raise exception 'members cannot modify protected task fields'
      using errcode = 'insufficient_privilege';
  end if;

  return new;  -- brief / figma_url / tag_id / position are allowed
end;
$$;

comment on table task_groups is
  'A subject-level container inside a section. Holds tasks; holds no hours.';
comment on column tasks.group_id is
  'Optional group within the task''s section. Must agree with section_id — the app maintains that.';
