-- ── 0038: harden time-entry writes ──────────────────────────────────────────
-- `own time update` (0001_init.sql:220) is
--     for update using (user_id = auth.uid())
-- with no column scoping and no trigger on the table, unlike `tasks` (0011) and
-- `profiles` (0021). A member may therefore rewrite EVERY column of their own
-- rows. Two consequences, both money-facing:
--
-- 1. 0035's bound is `check (legacy or (minutes > 0 and minutes <= 1440))`. The
--    `legacy or` escape exists so the recovery scripts and the roll-up reversal
--    SQL can re-insert real historical rows — but it assumed `legacy` was not
--    member-writable. It is, so the bound enforces nothing:
--        supabase.from('time_entries')
--          .update({ legacy: true, minutes: 99999 }).eq('id', ownRowId)
--    `legacy` is ALSO the flag deciding which aggregates a row lands in
--    (entrySums drops it for personal stats, entrySumsAll keeps it for billing),
--    so flipping it hides a member's hours from Team and the home page while
--    still charging the client for them.
--
-- 2. The Keys write-down — the one place the studio REDUCES a client's bill —
--    moves `task_id` and stamps `moved_*`. It is gated on `isAdmin` in
--    keys-write-down.tsx and nowhere else, so a member could reproduce it on
--    their own rows in either direction, or forge the stamp as an admin's.
--
-- A member may still do everything the UI offers them: edit the minutes, the
-- date and the description of their OWN, NON-LEGACY entry. `canEditEntry`
-- (time-entry-modal.tsx:23) is exactly that rule; this is the DB half of it.
--
-- SERVICE ROLE IS EXEMPT, as in 0021 and unlike 0011: `auth.uid()` is null on a
-- service-key connection, and the recovery scripts plus the reversal SQL write
-- these columns by design. An anonymous caller cannot reach the trigger anyway —
-- `using (user_id = auth.uid())` matches no row when auth.uid() is null.

create or replace function enforce_time_entry_member_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or is_admin() then
    return new;  -- service role / SQL editor / admins may change anything
  end if;

  -- Recovered history is not somebody's logged time; the UI refuses to edit it
  -- (canEditEntry) and so does the database.
  if old.legacy then
    raise exception 'members cannot modify recovered history'
      using errcode = 'insufficient_privilege';
  end if;

  if new.task_id             is distinct from old.task_id
  or new.user_id             is distinct from old.user_id
  or new.legacy              is distinct from old.legacy
  or new.date_estimated      is distinct from old.date_estimated
  or new.legacy_author_name  is distinct from old.legacy_author_name
  or new.moved_from_task_id  is distinct from old.moved_from_task_id
  or new.moved_at            is distinct from old.moved_at
  or new.moved_by            is distinct from old.moved_by
  or new.everhour_id         is distinct from old.everhour_id
  or new.asana_story_gid     is distinct from old.asana_story_gid
  or new.created_at          is distinct from old.created_at
  then
    raise exception 'members cannot modify protected time-entry fields'
      using errcode = 'insufficient_privilege';
  end if;

  return new;  -- minutes / date / description are allowed
end;
$$;

drop trigger if exists trg_time_entry_member_cols on time_entries;
create trigger trg_time_entry_member_cols
  before update on time_entries
  for each row
  execute function enforce_time_entry_member_columns();

-- Verify after applying, signed in as a DESIGNER (browser console):
--   const { data } = await supabase.from('time_entries')
--     .select('id').eq('user_id', (await supabase.auth.getUser()).data.user.id)
--     .eq('legacy', false).limit(1);
--   await supabase.from('time_entries')
--     .update({ legacy: true, minutes: 99999 }).eq('id', data[0].id)
-- must fail with "members cannot modify protected time-entry fields",
-- while .update({ minutes: 90 }) on the same row still succeeds.
