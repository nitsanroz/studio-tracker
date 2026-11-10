-- Only the owner can make someone the owner (2026-11-10).
--
-- WHY: `profiles.position = 'owner'` (with role admin) is what `is_owner()` reads
-- — &advice (0059, owner-only RLS) and vacation approval (0058). But 0021's
-- profile trigger exempts admins entirely and never listed `position`, so ANY
-- admin could set their own position to 'owner' through the API and take both.
-- The finance app's person page offered exactly that in its Position menu (its
-- v1.27.0 now greys it out, `canSetOwnerPosition`); this is the database half,
-- so the rule holds for every client, not just that screen.
--
-- The rule: moving a profile INTO or OUT OF 'owner' needs `is_owner()` (the
-- current owner). Every other position change is unchanged. The service role
-- and the SQL editor (no `auth.uid()`) are exempt, as in 0021 — that is how an
-- owner is set if there is none.
--
-- Run in the Supabase SQL editor. Safe to re-run; no deploy order.

create or replace function guard_owner_position()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_owner boolean := false;
  is_now    boolean := coalesce(new.position, '') = 'owner';
begin
  if auth.uid() is null then
    return new;  -- service role / SQL editor
  end if;
  if tg_op = 'UPDATE' then
    was_owner := coalesce(old.position, '') = 'owner';  -- OLD only exists on an update
  end if;
  if was_owner is distinct from is_now and not is_owner() then
    raise exception 'only the owner can set or clear the owner position'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_owner_position on profiles;
create trigger trg_guard_owner_position
  before insert or update of position on profiles
  for each row
  execute function guard_owner_position();
