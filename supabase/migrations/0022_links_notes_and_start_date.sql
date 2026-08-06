-- ── 0022: reference links, client notes, task start dates ───────────────────
-- Three additions behind the v1.2.0 batch:
--
--   1. `links`        — titled reference links (a Google Doc, a Dropbox folder)
--                       hung off EITHER a task or a client. The studio pastes
--                       these into briefs today, where they render as raw URLs.
--   2. `clients.notes` — the client-level equivalent of a task brief.
--   3. `tasks.start_date` — the left edge of a bar on the client Timeline view.
--                       Until now a task had only a due date, so a Gantt could
--                       not express duration at all.
--
-- ⚠️ Item 3 also amends the 0011 trigger. That trigger enumerates its protected
-- columns by name, so a NEW column is member-writable by default — without the
-- amendment any designer could re-schedule any task through the API. `start_date`
-- is a scheduling field and belongs with `due_date` on the admin-only side.

-- ── 1. links ────────────────────────────────────────────────────────────────
create table if not exists links (
  id uuid primary key default gen_random_uuid(),
  -- exactly one owner, enforced below: a link is either a task's or a client's
  task_id uuid references tasks(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  title text not null,
  url text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  constraint links_one_owner check ((task_id is null) <> (client_id is null))
);

create index if not exists links_task_idx on links(task_id);
create index if not exists links_client_idx on links(client_id);

alter table links enable row level security;

do $$ begin
  create policy "read all" on links for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;

-- Task links follow the BRIEF, which migration 0011 deliberately leaves
-- member-writable — a link to the client's questionnaire is collaborative
-- material, not a billing field. Client links sit beside the client's name and
-- billing note, so they are admin-only like the rest of that record.
do $$ begin
  create policy "write task links" on links for all
    using (auth.uid() is not null and task_id is not null)
    with check (auth.uid() is not null and task_id is not null);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "admin write client links" on links for all
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- ── 2. clients.notes ────────────────────────────────────────────────────────
-- Readable by every signed-in member (the whole clients table already is);
-- writes stay admin-only through the existing clients policies.
alter table clients add column if not exists notes text not null default '';

-- ── 3. tasks.start_date ─────────────────────────────────────────────────────
alter table tasks add column if not exists start_date date;

-- Re-declare the 0011 trigger function with start_date added. Everything else
-- is character-for-character the original — see 0011 for the reasoning.
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
  or new.start_date   is distinct from old.start_date  -- added by 0022
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
