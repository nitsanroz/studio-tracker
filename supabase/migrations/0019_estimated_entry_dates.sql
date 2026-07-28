-- 0019 — mark a recovered entry whose DATE is an estimate.
--
-- WHY: half the recovered pre-Everhour history — 3,953.75h of 7,948.65h — sat in
-- `tasks.legacy_hours` with no date at all, so no time-series could plot it. The
-- home page's early years summed to ~3,995h (the dated entries) while the studio
-- had actually logged twice that.
--
-- Those hours are undated because a task's TITLE recorded a bigger total than its
-- comments accounted for: "Ui system - 165hrs" with comments totalling 8h leaves
-- 157h that is certainly real but has no day attached. What the comments DO give
-- is the window the work happened in (tasks.activity_from → activity_to) and,
-- often, its month-by-month shape.
--
-- Per Nitsan (2026-07-28: "when it happened can be estimate"), the remainder is
-- distributed across that observed window — proportionally to the task's real
-- dated entries where they exist, evenly across the window's months otherwise.
--
-- `date_estimated` keeps that honest and reversible. The HOURS are evidence (from
-- the studio's own hand-maintained title figures); only the DATE is inferred, and
-- these rows can always be found, excluded or removed:
--   delete from time_entries where date_estimated;
--
-- They carry user_id = null deliberately: pinning an estimated date on a NAMED
-- person would put invented specifics into that person's record. The hours belong
-- to the client and the task, not to somebody's timesheet.

alter table time_entries
  add column if not exists date_estimated boolean not null default false;

create index if not exists time_entries_date_estimated_idx
  on time_entries (date_estimated) where date_estimated;

comment on column time_entries.date_estimated is
  'The hours are real (from the task''s own recorded total) but the DATE was inferred from the task''s comment activity window. Always also legacy = true. Safe to exclude from anything that needs exact dating.';
