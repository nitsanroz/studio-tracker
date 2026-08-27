-- A sane bound on a single time entry, enforced by the DATABASE rather than by
-- the form alone.
--
-- ⚠️ WHY: `time_entries.minutes` had no bound anywhere — not in the schema, not in
-- RLS. A member may write their own rows (`own time *` policies since 0001), so a
-- negative or absurd figure could be posted straight to the API and would flow
-- into client reports, the KPI tiles and every per-person total. `LogTimeForm`
-- already refuses `minutes <= 0`, so this is a backstop for the path that does not
-- go through the form, which is the path that matters.
--
-- ⚠️⚠️ `NOT VALID` IS LOAD-BEARING — WITHOUT IT THIS MIGRATION CANNOT APPLY.
-- Existing rows genuinely violate it, and all of them legitimately:
--   · 82 rows with NEGATIVE minutes — the `מפתח` hours REDUCTIONS recovered from
--     Asana comments (v0.99.31). They are real ledger lines; dropping them while
--     keeping the positives is what made comment totals run 4x over the studio's
--     own figures.
--   · 372 rows over 24h — recovered lumps and the v0.99.34 estimated-date spread
--     (the largest is 333h on one 2021 date), plus 20 NON-legacy rows that are
--     Everhour cut-over backfills dated 2022-11-29.
-- `NOT VALID` enforces the rule on every INSERT and UPDATE from now on while
-- leaving that history alone. It is the standard Postgres idiom for exactly this,
-- not a way of dodging a failing constraint.
--
-- ⚠️ LEGACY ROWS ARE EXEMPT ON PURPOSE, and it is not only about history: the
-- recovery scripts still insert legacy rows, and the roll-up REVERSAL SQL written
-- on 2026-08-27 re-inserts 31 of them. A bound without this escape would block our
-- own undo.
--
-- To tighten later: clean the 20 non-legacy outliers, then
--   alter table time_entries validate constraint time_entries_minutes_sane;
alter table time_entries
  add constraint time_entries_minutes_sane
  check (legacy or (minutes > 0 and minutes <= 1440))
  not valid;

comment on constraint time_entries_minutes_sane on time_entries is
  'A non-legacy entry is 1 minute to 24 hours. NOT VALID: pre-existing recovered rows are exempt.';
