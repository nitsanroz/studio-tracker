-- 0020 — profiles.end_date: the day a member left the studio.
--
-- WHY: "active" was the only record that somebody had gone, and it carries no
-- date. That is enough to hide a person from pickers but not enough to read a
-- period honestly — the admin home's studio strip now shows anyone with hours in
-- the selected period, and "left in March" is the fact that explains why their
-- bar stops there. Per Nitsan (2026-07-29): the dates will be filled in later.
--
-- An end date IMPLIES inactive, and that is enforced in the database rather than
-- only in the app, because these dates are going to be pasted in by hand in the
-- SQL editor. Setting end_date archives the person; no app code can forget to.
--
-- Clearing end_date deliberately does NOT restore them: coming back is a decision,
-- not a side effect of blanking a field. The Restore button in /team/<id> clears
-- the date and flips active in one go.

alter table profiles
  add column if not exists end_date date;

comment on column profiles.end_date is
  'Last day in the studio. Non-null forces active = false (trigger profiles_end_date_archives). Null means either still here or simply unrecorded — check active.';

create or replace function profiles_end_date_archives() returns trigger as $$
begin
  if new.end_date is not null then
    new.active := false;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_end_date_archives on profiles;

create trigger profiles_end_date_archives
  before insert or update of end_date, active on profiles
  for each row execute function profiles_end_date_archives();

-- Sanity check after filling dates in: nobody should be active with an end date.
--   select id, name, active, end_date from profiles where end_date is not null and active;
