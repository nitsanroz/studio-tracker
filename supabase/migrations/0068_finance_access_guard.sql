-- Only the owner can hand out finance access or make an admin (2026-11-14).
--
-- WHY: `profiles.finance_full_access` is what the finance tables' policies read
-- (`is_finance_full_access()` / `is_finance_admin()` — salaries, the P&L,
-- payslips, client revenue). But `profiles` has "admin all" (0001), 0021's
-- trigger exempts admins and never listed the column, and 0067 guards only
-- `position`. So any admin could set the flag on their own row through the API
-- and read all of finance, and — if the live helper functions don't also ask
-- for role admin — so could a member, on theirs. Found while planning the
-- finance merge; it holds for both apps as they are today.
--
-- `role` has the same shape: any admin could demote the owner (`is_owner()`
-- needs role admin) or make another admin.
--
-- The rules, for every signed-in caller who is not the owner:
--   · `finance_full_access` cannot change, on any row.
--   · nobody can be moved INTO or OUT OF role 'admin'.
--   · a new row cannot arrive as an admin or with finance access.
-- Every other profile write is unchanged — an admin still edits names, dates,
-- positions (except 'owner', 0067), capacity, designer ↔ other non-admin roles.
-- The service role and the SQL editor (no `auth.uid()`) are exempt, as in 0021
-- and 0067: `/api/admin/users` creates profiles that way, and it is how the
-- first owner is set.
--
-- Also here: the two columns this depends on were added by hand and had no
-- file in either repo; and `position` joins 0021's member-protected list (a
-- member could rename their own position — no privilege in it today, but it is
-- what `is_owner()` reads).
--
-- Run in the Supabase SQL editor. Safe to re-run; no deploy order — neither app
-- writes these columns as a non-owner.

-- ── The columns, on record (no-ops on the live database) ─────────────────────
alter table profiles add column if not exists position text;
alter table profiles add column if not exists finance_full_access boolean not null default false;

-- ── The guard ────────────────────────────────────────────────────────────────
create or replace function guard_finance_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or is_owner() then
    return new;  -- service role / SQL editor / the owner
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.finance_full_access, false) or new.role = 'admin' then
      raise exception 'only the owner can create an admin or grant finance access'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.finance_full_access is distinct from old.finance_full_access then
    raise exception 'only the owner can change finance access'
      using errcode = 'insufficient_privilege';
  end if;
  if new.role is distinct from old.role and (new.role = 'admin' or old.role = 'admin') then
    raise exception 'only the owner can make or unmake an admin'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_finance_access on profiles;
create trigger trg_guard_finance_access
  before insert or update on profiles
  for each row
  execute function guard_finance_access();

-- ── 0021's member list, with `position` and `finance_full_access` added ──────
create or replace function enforce_profile_member_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or is_admin() then
    return new;  -- service role / SQL editor / admins (the guards above still apply)
  end if;

  if new.id                  is distinct from old.id
  or new.role                is distinct from old.role
  or new.position            is distinct from old.position
  or new.finance_full_access is distinct from old.finance_full_access
  or new.active              is distinct from old.active
  or new.end_date            is distinct from old.end_date
  or new.has_account         is distinct from old.has_account
  or new.start_date          is distinct from old.start_date
  or new.capacity_hours_week is distinct from old.capacity_hours_week
  or new.everhour_id         is distinct from old.everhour_id
  or new.asana_gid           is distinct from old.asana_gid
  or new.created_at          is distinct from old.created_at
  then
    raise exception 'members cannot modify protected profile fields'
      using errcode = 'insufficient_privilege';
  end if;

  return new;  -- name / avatar_url / photo_url are allowed
end;
$$;

-- Verify with supabase/checks/check-finance-access.sql (read-only; its last two rows try
-- the flag as an admin who isn't the owner and as a member — both must say
-- "blocked").
