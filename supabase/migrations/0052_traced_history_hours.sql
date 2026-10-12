-- 0052 — trace unassigned history hours to the people the evidence names.
--
-- WHY: before Everhour (Dec 2022) ~37,000 recovered hours have a task, a client
-- and a month but no person. Nitsan (2026-10-06) wants each designer's hours
-- set against their salary, so hours are assigned where the task itself names
-- who worked it: its Asana assignee, its comment authors, or the people who
-- logged hours on it (split by their own hours there). Office managers and the
-- shared Office account never count as evidence; a person only gets hours in
-- months they were employed (salary/freelance, or tracker dates for 2016), and
-- never more than 200h in a month.
--
-- `traced_from` keeps it reversible. A traced row points at the recovered row it
-- came from (itself when that row was assigned in place). To undo:
--   update time_entries o
--   set minutes = o.minutes + coalesce((select sum(c.minutes) from time_entries c
--                  where c.traced_from = o.id and c.id <> o.id), 0),
--       user_id = case when o.traced_from = o.id then null else o.user_id end,
--       traced_from = null
--   where o.traced_from = o.id
--      or exists (select 1 from time_entries c where c.traced_from = o.id and c.id <> o.id);
--   delete from time_entries where traced_from is not null and traced_from <> id;
alter table time_entries
  add column if not exists traced_from uuid references time_entries(id) on delete cascade;
comment on column time_entries.traced_from is
  'Set when a recovered (legacy) row was assigned to a person from task evidence (0052). Points at the original row; equals id when the whole row was assigned in place.';
