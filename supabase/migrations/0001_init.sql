-- Studio&more tracker — initial schema
-- Apply in the Supabase SQL editor (or via supabase db push).

create type user_role as enum ('admin', 'designer');
create type task_status as enum ('todo', 'in_progress', 'done');
create type plan_column_type as enum ('member', 'waiting_list', 'studio');
create type plan_entry_type as enum ('task', 'free_text', 'absence');
create type absence_type as enum ('vacation', 'sick', 'day_off', 'half_day', 'wfh');
create type request_status as enum ('pending', 'approved', 'rejected');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role user_role not null default 'designer',
  avatar_url text,
  active boolean not null default true,
  everhour_id text unique,
  asana_gid text unique,
  created_at timestamptz not null default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#0b43ed',
  logo_url text,
  billing_period_note text not null default '',
  archived boolean not null default false,
  everhour_id text unique,
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  billable boolean not null default true,
  archived boolean not null default false,
  everhour_id text unique,
  asana_gid text unique,
  created_at timestamptz not null default now()
);

create table sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  position int not null default 0,
  asana_gid text unique,
  created_at timestamptz not null default now()
);

create table tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  position int not null default 0
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  section_id uuid references sections(id) on delete set null,
  title text not null,
  brief text not null default '',
  figma_url text,
  status task_status not null default 'todo',
  tag_id uuid references tags(id) on delete set null,
  assignee_id uuid references profiles(id) on delete set null,
  due_date date,
  billable boolean not null default true,
  estimate_hours numeric(7,2),
  position int not null default 0,
  pending boolean not null default false, -- intake: approved-pending confirmation
  completed_at timestamptz,
  everhour_id text unique,
  asana_gid text unique,
  created_at timestamptz not null default now()
);

create table task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  minutes int, -- null while a timer is running
  description text not null default '',
  started_at timestamptz, -- non-null = running timer
  moved_from_task_id uuid references tasks(id) on delete set null,
  moved_at timestamptz,
  moved_by uuid references profiles(id) on delete set null,
  everhour_id text unique,
  created_at timestamptz not null default now(),
  constraint timer_or_minutes check (minutes is not null or started_at is not null)
);
create index time_entries_task_idx on time_entries(task_id);
create index time_entries_user_date_idx on time_entries(user_id, date);
create index time_entries_date_idx on time_entries(date);

create table plan_columns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  profile_id uuid references profiles(id) on delete set null,
  position int not null default 0,
  type plan_column_type not null default 'member'
);

create table plan_entries (
  id uuid primary key default gen_random_uuid(),
  date date, -- null allowed for waiting-list items
  column_id uuid not null references plan_columns(id) on delete cascade,
  position int not null default 0,
  type plan_entry_type not null default 'free_text',
  task_id uuid references tasks(id) on delete cascade,
  text text not null default '',
  client_id uuid references clients(id) on delete set null,
  absence_type absence_type,
  created_at timestamptz not null default now()
);
create index plan_entries_date_idx on plan_entries(date);

create table intake_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table task_requests (
  id uuid primary key default gen_random_uuid(),
  intake_link_id uuid references intake_links(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  submitter_name text not null default '',
  submitter_email text not null default '',
  title text not null,
  brief text not null default '',
  requested_due_date date,
  client_approved_budget_hours numeric(7,2),
  status request_status not null default 'pending',
  created_task_id uuid references tasks(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Row-level security
alter table profiles enable row level security;
alter table clients enable row level security;
alter table projects enable row level security;
alter table sections enable row level security;
alter table tags enable row level security;
alter table tasks enable row level security;
alter table task_comments enable row level security;
alter table attachments enable row level security;
alter table time_entries enable row level security;
alter table plan_columns enable row level security;
alter table plan_entries enable row level security;
alter table intake_links enable row level security;
alter table task_requests enable row level security;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Everyone signed-in can read the studio's shared data
create policy "read all" on profiles for select using (auth.uid() is not null);
create policy "read all" on clients for select using (auth.uid() is not null);
create policy "read all" on projects for select using (auth.uid() is not null);
create policy "read all" on sections for select using (auth.uid() is not null);
create policy "read all" on tags for select using (auth.uid() is not null);
create policy "read all" on tasks for select using (auth.uid() is not null);
create policy "read all" on task_comments for select using (auth.uid() is not null);
create policy "read all" on attachments for select using (auth.uid() is not null);
create policy "read all" on time_entries for select using (auth.uid() is not null);
create policy "read all" on plan_columns for select using (auth.uid() is not null);
create policy "read all" on plan_entries for select using (auth.uid() is not null);

-- Admins can do everything
create policy "admin all" on profiles for all using (is_admin());
create policy "admin all" on clients for all using (is_admin());
create policy "admin all" on projects for all using (is_admin());
create policy "admin all" on sections for all using (is_admin());
create policy "admin all" on tags for all using (is_admin());
create policy "admin all" on tasks for all using (is_admin());
create policy "admin all" on task_comments for all using (is_admin());
create policy "admin all" on attachments for all using (is_admin());
create policy "admin all" on time_entries for all using (is_admin());
create policy "admin all" on plan_columns for all using (is_admin());
create policy "admin all" on plan_entries for all using (is_admin());
create policy "admin all" on intake_links for all using (is_admin());
create policy "admin all" on task_requests for all using (is_admin());

-- Designers: manage their own profile bits, comments, and time entries;
-- task edits (status/tag/assignee) go through the app which enforces field-level rules
create policy "own profile update" on profiles for update using (id = auth.uid());
create policy "designers update tasks" on tasks for update using (auth.uid() is not null);
create policy "own comments" on task_comments for insert with check (user_id = auth.uid());
create policy "own comment edit" on task_comments for update using (user_id = auth.uid());
create policy "own comment delete" on task_comments for delete using (user_id = auth.uid());
create policy "own time insert" on time_entries for insert with check (user_id = auth.uid());
create policy "own time update" on time_entries for update using (user_id = auth.uid());
create policy "own time delete" on time_entries for delete using (user_id = auth.uid());
create policy "upload attachments" on attachments for insert with check (uploaded_by = auth.uid());
