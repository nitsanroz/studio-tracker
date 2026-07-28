-- 0016 — Recover the pre-Everhour history that was never imported.
--
-- Before Everhour (cutover 2022-12-04) the studio logged hours in ASANA TASK
-- COMMENTS — each person commented their hours as they worked — and the running
-- total was hand-copied into the task title, with the budget in parentheses:
--
--   "Logo Update (8) - 5.25h"          → budget 8,   actual 5.25
--   "Leg 2 (181h) - 150.75h"  section  → budget 181, actual 150.75
--
-- None of it reached the tracker: `task_comments` is empty studio-wide and
-- 2,782 tasks with an asana_gid have zero time entries, so years of real billed
-- work read as "0 hours" everywhere in the app.
--
-- This migration only adds the columns. The backfill itself runs from
-- scripts/fetch-asana-stories.mjs + scripts/reconcile-legacy-hours.mjs.

-- ── Backfilled time entries ───────────────────────────────────────────────
-- `legacy` marks a 2020–2022 entry reconstructed from an Asana comment. It is
-- deliberately a column and not a separate table: these are real hours on real
-- tasks and belong in client totals and reports. But they are attributed to
-- people who still work here, so every PERSONAL or TIME-SERIES surface (the
-- days-worked counter, "my hours", the period comparison, the feed timesheet)
-- must filter them out — a 2021 backfill must not invent working days for
-- someone in 2026. The flag is what makes that filtering possible, and it makes
-- the whole import reversible: `delete from time_entries where legacy`.
--
-- `asana_story_gid` is the Asana comment id, so a re-run of the importer can
-- never double-count.
alter table time_entries
  add column if not exists legacy boolean not null default false,
  add column if not exists asana_story_gid text unique;

create index if not exists time_entries_legacy_idx on time_entries (legacy) where legacy;

comment on column time_entries.legacy is
  'Reconstructed from a pre-Everhour Asana comment, not logged by the person in this app. Include in client/task totals; EXCLUDE from personal stats, the days-worked counter and the feed timesheet.';

-- ── Comment history ───────────────────────────────────────────────────────
-- The comment thread is the audit trail behind every recovered number, so it is
-- imported verbatim alongside the hours. `author_name` carries the raw Asana
-- name for people who predate the ASANA_USERS map (scripts/enrich-asana.mjs) and
-- therefore have no profile to point `user_id` at.
alter table task_comments
  add column if not exists asana_story_gid text unique,
  add column if not exists author_name text;

-- task_comments.user_id was NOT NULL: an imported comment may have no matching
-- profile, and dropping the comment would lose the evidence for its hours.
alter table task_comments alter column user_id drop not null;

-- ── Task-level recovered history ──────────────────────────────────────────
-- INVARIANT, per task:  total hours  =  Σ(legacy time_entries)  +  legacy_hours
--
-- `legacy_hours` is the UNATTRIBUTED REMAINDER — hours we know were worked (from
-- the title total) but could not pin to a person and a date. It is never a
-- duplicate of the entries; it is what is left over after them. Display-only:
-- it has no date and no person, so it must never enter a per-month or per-person
-- aggregation.
alter table tasks
  add column if not exists legacy_hours  numeric(8,2),
  add column if not exists legacy_title  text,
  add column if not exists activity_from date,
  add column if not exists activity_to   date;

comment on column tasks.legacy_hours is
  'Pre-Everhour hours with no attributable person/date (the remainder after legacy time_entries). Display-only — never aggregate by month or by user.';
comment on column tasks.legacy_title is
  'Original imported title before the hour figures were parsed out of it. Restores the name if a parse turns out wrong.';

-- ── Section-level recovered history ───────────────────────────────────────
-- Section names carried the same convention plus a closing date:
--   "Website (232+61/134) (Total 293-366) - 388.5 (27/1/2021)"
alter table sections
  add column if not exists legacy_hours   numeric(8,2),
  add column if not exists estimate_hours numeric(8,2),
  add column if not exists legacy_name    text,
  add column if not exists closed_on      date;

comment on column sections.estimate_hours is
  'Section-level budget parsed from the old name. Falls back to the sum of its tasks when null.';
comment on column sections.legacy_name is
  'Original imported name before the hour figures were parsed out of it.';
