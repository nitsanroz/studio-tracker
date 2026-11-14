-- Undo log for reviewable/approvable finance writes (currently: tracker-hours
-- sync suggestions approved on the Plan page). Each row is one "batch" of
-- changes; `changes` is a JSON array of { match, before, after } — `before`
-- is null when the row didn't exist yet (undo = delete it).
create table if not exists finance_undo_log (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  action_label text not null,
  table_name   text not null,
  changes      jsonb not null,
  undone_at    timestamptz
);
create index if not exists finance_undo_log_table_idx on finance_undo_log(table_name, undone_at, created_at desc);

alter table finance_undo_log enable row level security;
do $$ begin
  create policy "admin all" on finance_undo_log for all using (is_admin());
exception when duplicate_object then null; end $$;
