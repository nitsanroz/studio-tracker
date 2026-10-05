-- 0050: files on the Overview tabs — the client page's and the lead's
-- (shown on its estimates' Overview, carried to the client on conversion).
--
-- client_files: READ BY EVERYONE, like task attachments (`attachments`), and
-- stored in the same `task-files` bucket, served through /api/file. Anyone may
-- add one; the uploader or an admin removes it (the DELETE goes through
-- /api/client-file, which also removes the object).
--
-- lead_files: ADMINS ONLY, like every lead table; objects live in the private
-- `lead-files` bucket next to the offer PDFs, served through /api/lead-file.

create table if not exists client_files (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  path text not null,
  file_name text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_files_client_idx on client_files(client_id);
alter table client_files enable row level security;

do $$ begin
  create policy "read all" on client_files for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admin all" on client_files for all using (is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "upload own" on client_files for insert with check (uploaded_by = auth.uid());
exception when duplicate_object then null; end $$;

create table if not exists lead_files (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  path text not null,
  file_name text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lead_files_lead_idx on lead_files(lead_id);
alter table lead_files enable row level security;

do $$ begin
  create policy "admin all" on lead_files for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
