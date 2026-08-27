-- Automatic billing-period rollover: the client's invoice day, and the constraint
-- that makes opening a period safe to retry.
--
-- ⚠️ WHY: nothing ever created billing periods. They are hand-added rows, so when
-- a client's last period ended, hours kept logging and the report's Total and week
-- columns stayed correct WHILE THE PERIOD BREAKDOWN SILENTLY DROPPED THEM — a
-- period bucket only counts entries inside its own date_from…date_to. A report
-- that looks right and is incomplete is the worst possible shape for something a
-- client is invoiced from. `src/app/(app)/client-reports/page.tsx` now opens the
-- next period(s) when Client Reports is opened.
--
-- ⚠️⚠️ THE UNIQUE INDEX IS NOT AN OPTIMISATION, IT IS THE ONLY REAL GUARD, and it
-- exists because the in-memory one demonstrably was not. On 2026-08-27 the
-- rollover effect ran THREE TIMES against an already-open Client Reports page —
-- saving the file hot-reloads it, which remounts the component and resets the
-- guard ref, and each run read the same stale state and inserted. 60 unwanted rows
-- across 20 clients in one second, which had to be backed up and deleted. The app
-- now upserts with `onConflict: client_id,date_from` and `ignoreDuplicates`, so
-- WITHOUT THIS INDEX the upsert fails and the feature is inert — which is the
-- correct failure direction. Do not drop it while that code exists.
create unique index if not exists client_billing_periods_client_from_key
  on client_billing_periods (client_id, date_from);

-- ⚠️ Day of the month a client is invoiced on, so new periods align to the
-- invoicing cycle instead of drifting. NULL means "just run a calendar month",
-- which is what every client does today.
--
-- ⚠️ Read by a SEPARATE, tolerant query in the app, never folded into the main
-- clients select: selecting a column that does not exist fails the WHOLE request,
-- so a missing column here must not be able to take Client Reports down.
--
-- ⚠️ The check allows 31 and the app CLAMPS to the month's length — an invoice day
-- of 31 in February means the 28th, not the 3rd of March. `new Date(y, 1, 31)`
-- rolls over silently, and that rollover would shift every later period.
alter table clients add column if not exists invoice_day int
  check (invoice_day is null or (invoice_day between 1 and 31));
