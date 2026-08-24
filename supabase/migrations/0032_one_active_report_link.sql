-- One active report link per client.
--
-- ⚠️ `ensureLink` already asks the database before minting a link (v1.20.0), and it
-- is NOT enough: it awaits between the read and the insert, so two concurrent
-- callers both see no rows and both insert. Visitt got two links 89ms apart that
-- way on 2026-08-21, two days after that check shipped; Blazepod got two 13h apart
-- before it existed. A duplicate is how a client's permanent URL goes stale, and it
-- is how an edit lands on a row the app no longer reads — Visitt's stray carried a
-- hand-edited column spanning 2–25 Jul that double-counted 57h, invisible because
-- the published link won canonical selection.
--
-- APPLIED by Nitsan 2026-08-24, after deactivating the two strays (the index cannot
-- be created while they exist). Partial, so deactivated rows and their tokens are
-- kept for ever — deactivating is reversible, deleting is not.
create unique index if not exists report_links_one_active_per_client
  on report_links (client_id)
  where active;
