-- The day a published report's hours were counted up to, inclusive. NULL = everything,
-- which is exactly the behaviour before this column existed.
--
-- ⚠️ A RECORD, NOT A FILTER: the scoping is baked into `report_links.snapshot` when it
-- is built (see `buildReportSnapshot`'s `through` argument), so nothing at read time
-- consults this column and the public `/report/[token]` page is unaffected by whether
-- this migration has run. Publishing also survives without it — the write goes through
-- `updateWithOptional`, so it steps down to "scoped, but not recorded".
--
-- ⚠️ No policy work: `report_links` is admin-only for all operations under 0001, and
-- the public page reads it with the service role.
alter table report_links add column if not exists through_date date;

comment on column report_links.through_date is
  'Inclusive cut-off used when this snapshot was built. NULL = no cut-off.';
