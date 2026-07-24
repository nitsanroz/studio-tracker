-- ── 0011: harden task writes ────────────────────────────────────────────────
-- Until now `designers update tasks` allowed ANY signed-in user to update ANY
-- column of ANY task (RLS: `using (auth.uid() is not null)`, no WITH CHECK, no
-- column scoping). The member permission model (title / estimate / due /
-- billable / complete / assignment are admin-only) lived only in the UI, so a
-- member could rewrite billing-relevant fields directly via the API.
--
-- Postgres RLS can't express per-column rules, so we keep the row-level policy
-- and enforce column scoping with a BEFORE UPDATE trigger. Admins are exempt
-- (is_admin()). Members may still change the collaborative columns:
--   brief, figma_url, tag_id, position
-- Any attempt by a member to change a protected column is rejected.

-- Recreate the update policy with an explicit WITH CHECK (defence in depth).
drop policy if exists "designers update tasks" on tasks;
create policy "designers update tasks" on tasks
  for update
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

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

drop trigger if exists trg_task_member_cols on tasks;
create trigger trg_task_member_cols
  before update on tasks
  for each row
  execute function enforce_task_member_columns();
