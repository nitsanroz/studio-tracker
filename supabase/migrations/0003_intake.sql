-- Intake feature: raw form answers, general (non-client) links, app settings.
-- (Includes the 0002 line — safe to re-run, everything is idempotent.)

alter table plan_columns add column if not exists hidden boolean not null default false;

alter table task_requests add column if not exists answers jsonb;
alter table task_requests add column if not exists suggested_client_id uuid references clients(id) on delete set null;
alter table intake_links alter column client_id drop not null;

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
do $$ begin
  create policy "admin all" on app_settings for all using (is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read all" on app_settings for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;
