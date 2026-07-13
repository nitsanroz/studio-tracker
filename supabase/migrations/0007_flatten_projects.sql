-- ── 0007: flatten hierarchy to client → section → task ──────────────────────
-- Projects are retired from the app. The projects table and *.project_id
-- columns stay in place (legacy Asana/Everhour import mapping) but nothing in
-- the app reads them anymore. Future imports must merge into client+section.

-- 1. sections + tasks attach directly to clients
alter table sections add column if not exists client_id uuid references clients(id) on delete cascade;
alter table tasks    add column if not exists client_id uuid references clients(id) on delete cascade;

update sections s set client_id = p.client_id
from projects p where s.project_id = p.id and s.client_id is null;

update tasks t set client_id = p.client_id
from projects p where t.project_id = p.id and t.client_id is null;

create index if not exists sections_client_idx on sections(client_id);
create index if not exists tasks_client_idx on tasks(client_id);

-- new rows are created without a project
alter table tasks    alter column project_id drop not null;
alter table sections alter column project_id drop not null;

-- 2. same section name under two projects of one client → prefix with project
update sections s set name = p.name || ' · ' || s.name
from projects p
where s.project_id = p.id
  and exists (
    select 1 from sections s2
    where s2.client_id = s.client_id
      and s2.name = s.name
      and s2.project_id is distinct from s.project_id
  );

-- 3. unsectioned tasks get a section named after their old project
insert into sections (project_id, client_id, name, position)
select p.id, p.client_id, p.name, 900
from projects p
where exists (select 1 from tasks t where t.project_id = p.id and t.section_id is null)
  and not exists (select 1 from sections s where s.project_id = p.id and s.name = p.name);

update tasks t set section_id = s.id
from sections s, projects p
where t.section_id is null
  and p.id = t.project_id
  and s.project_id = p.id
  and s.name = p.name;

-- 4. per-client custom payment periods (admin-managed, used by client reports)
create table if not exists client_billing_periods (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  label text not null,
  date_from date not null,
  date_to date not null,
  hour_cap numeric(7,2),
  advance_hours numeric(7,2),
  position int not null default 0,
  created_at timestamptz not null default now()
);
alter table client_billing_periods enable row level security;
do $$ begin
  create policy "admin all" on client_billing_periods for all using (is_admin());
exception when duplicate_object then null; end $$;

-- 5. published report snapshots: links stay permanent, data freezes at publish
alter table report_links add column if not exists snapshot jsonb;
alter table report_links add column if not exists published_at timestamptz;
alter table report_links add column if not exists hidden_columns jsonb not null default '[]'::jsonb;
alter table report_links add column if not exists hidden_task_ids jsonb not null default '[]'::jsonb;

-- 6. weekly-plan day states (holiday / custom, spans a date range, whole row)
create table if not exists plan_day_states (
  id uuid primary key default gen_random_uuid(),
  date_from date not null,
  date_to date not null,
  label text not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table plan_day_states enable row level security;
do $$ begin
  create policy "read all" on plan_day_states for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admin all" on plan_day_states for all using (is_admin());
exception when duplicate_object then null; end $$;

-- 7. "in development" pipeline list (admin-only sidebar widget on weekly plan)
do $$ begin
  create type dev_status as enum ('pricing','in_approval','wip','qa','client_qa','done');
exception when duplicate_object then null; end $$;
create table if not exists dev_items (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  status dev_status not null default 'pricing',
  position int not null default 0,
  created_at timestamptz not null default now()
);
alter table dev_items enable row level security;
do $$ begin
  create policy "admin all" on dev_items for all using (is_admin());
exception when duplicate_object then null; end $$;
