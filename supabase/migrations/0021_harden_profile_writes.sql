-- ── 0021: harden profile writes (privilege escalation fix) ──────────────────
-- `own profile update` (0001_init.sql) was:
--     for update using (id = auth.uid())
-- with NO `with check` and NO column scoping. Postgres reuses the USING clause
-- as the check when WITH CHECK is omitted, and that expression only constrains
-- `id` — so a designer could rewrite ANY other column of their own row,
-- including `role`. One call against the anon key was enough:
--     supabase.from('profiles').update({role:'admin'}).eq('id', myUid)
-- which yields is_admin() = true and with it member_hr (national IDs,
-- addresses), member_notes, finance_*, client_billing_periods and every
-- admin-only task column. Both of the studio's real boundaries — the
-- admin-only tables and 0011's task-column trigger — were bypassable by
-- escalating out of them rather than through them. The same hole let an
-- archived member set `active` back to true on themselves.
--
-- Same shape as 0011: keep the row-level policy, enforce column scoping in a
-- BEFORE UPDATE trigger, since RLS can't express per-column rules.
--
-- WHY THE SERVICE ROLE IS EXEMPT HERE (and is NOT in 0011): `auth.uid()` is
-- null on a service-key connection, so `is_admin()` is false for it. 0011
-- deliberately blocks the service role, but profiles cannot afford that —
-- /api/avatar and /api/member-image write avatar_url/photo_url with the
-- service key after verifying the caller's own session, and /api/admin/users
-- inserts new profiles the same way. A null `auth.uid()` can only be the
-- service key or the SQL editor: a request with no session matches neither
-- policy (`id = auth.uid()` matches no row, `is_admin()` needs a uid), so the
-- trigger is unreachable for an anonymous caller. Exempting it is therefore
-- safe and keeps those routes working.

drop policy if exists "own profile update" on profiles;
create policy "own profile update" on profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function enforce_profile_member_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or is_admin() then
    return new;  -- service role / SQL editor / admins may change anything
  end if;

  -- A member may edit only what describes them, never what they are allowed
  -- to do. `name` is permitted because it carries no privilege and Settings
  -- may reasonably expose it later; avatar_url/photo_url are the two picture
  -- fields the member-facing routes write.
  if new.id                 is distinct from old.id
  or new.role               is distinct from old.role
  or new.active             is distinct from old.active
  or new.end_date           is distinct from old.end_date
  or new.has_account        is distinct from old.has_account
  or new.start_date         is distinct from old.start_date
  or new.capacity_hours_week is distinct from old.capacity_hours_week
  or new.everhour_id        is distinct from old.everhour_id
  or new.asana_gid          is distinct from old.asana_gid
  or new.created_at         is distinct from old.created_at
  then
    raise exception 'members cannot modify protected profile fields'
      using errcode = 'insufficient_privilege';
  end if;

  return new;  -- name / avatar_url / photo_url are allowed
end;
$$;

drop trigger if exists trg_profile_member_cols on profiles;
create trigger trg_profile_member_cols
  before update on profiles
  for each row
  execute function enforce_profile_member_columns();

-- Verify after applying (as a non-admin member, from the browser console):
--   await supabase.from('profiles').update({role:'admin'})
--     .eq('id', (await supabase.auth.getUser()).data.user.id)
-- must fail with "members cannot modify protected profile fields".
