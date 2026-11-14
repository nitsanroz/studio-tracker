-- 0070 — ONE &advice store (the finance merge, stage 4).
--
-- &advice was two advisors: the tracker's wrote `advice_items` (0059, no
-- amounts), finance's wrote `finance_advice_items` (its reference/0010, with
-- amounts). They are one engine now (src/lib/advice/run.ts) and it writes only
-- `finance_advice_items` — the table whose policy is `is_finance_owner()`.
--
-- This carries the owner's snoozes and dismissals over, so nothing he hid in
-- the tracker's pane comes back on the first day. It changes no table and no
-- policy, and deletes nothing.
--
-- WHEN TO RUN: at the cutover to v2.0.0, just before the deploy. Safe to run
-- earlier and again then — a second run only refreshes a snooze or dismissal on
-- a row that has none yet; it never un-hides anything.
--
-- The app works without it: the studio's findings are simply found again, as
-- new rows with nothing hidden.
--
-- NOT COPIED, on purpose:
--   · pace, unpaid, concentration, client-quiet, income — finance's rules say
--     the same thing with the amount, and theirs are the cards that stay
--     (run.ts SUPERSEDED). Their rows are already in the finance table.
--   · idea — written by Claude each day; yesterday's are replaced anyway.
--   · resolved rows — a finding that is no longer true has no state to keep.
--
-- `advice_items` and `advice_runs` are LEFT IN PLACE: the tracker on `main`
-- reads them until the cutover, and they are the way back for four weeks after.

begin;

insert into finance_advice_items (
  key, signal, kind, area, client_id, severity, facts, title, body,
  worded_title, worded_body, is_reminder, first_seen, last_seen,
  resolved_at, done_at, snoozed_until, snoozed_at_severity
)
select
  a.key, a.signal, a.kind, a.area, a.client_id, a.severity, a.facts, a.title, a.body,
  a.worded_title, a.worded_body, a.is_reminder, a.first_seen, a.last_seen,
  null, a.done_at, a.snoozed_until, a.snoozed_at_severity
from advice_items a
where a.resolved_at is null
  and a.signal not in ('pace', 'unpaid', 'concentration', 'client-quiet', 'income', 'idea')
on conflict (key) do update
  set done_at             = excluded.done_at,
      snoozed_until       = excluded.snoozed_until,
      snoozed_at_severity = excluded.snoozed_at_severity
  -- Only onto a row with nothing hidden: what the owner did in the new pane wins.
  where finance_advice_items.done_at is null
    and finance_advice_items.snoozed_until is null
    and (excluded.done_at is not null or excluded.snoozed_until is not null);

commit;

-- What landed (read-only): how many of the tracker's open findings now sit in
-- the one store, and how many of those are hidden.
select
  count(*)                                                              as carried_over,
  count(*) filter (where f.done_at is not null)                         as dismissed,
  count(*) filter (where f.snoozed_until is not null)                   as snoozed
from finance_advice_items f
join advice_items a on a.key = f.key
where a.resolved_at is null
  and a.signal not in ('pace', 'unpaid', 'concentration', 'client-quiet', 'income', 'idea');
