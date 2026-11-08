# simplify-repo ledger
Scope: src/lib  ·  Mode: report-only  ·  Started: 2026-11-08

## Standards digest
1. No millisecond date arithmetic; use `shiftDays`/`daysBetween` (format.ts / period-math.ts). (CLAUDE.md: Gotchas)
2. Date strings never via `toISOString().slice(0,10)` — UTC shifts the day in Israel; use format.ts helpers. (CLAUDE.md: Gotchas)
3. Missing-schema step-down only via `isMissingSchema`/`updateWithOptional`/`MISSING_SCHEMA_CODES`, only on a missing-schema code. (CLAUDE.md: Gotchas)
4. Any select that can exceed 1000 rows pages with `fetchAll` ordered by `id`; never put hundreds of ids in `.in()`. (CLAUDE.md: Gotchas)
5. Leads queries filter `.is("deleted_at", null)`. (CLAUDE.md: Gotchas v1.63.1)
6. `period-math.ts` functions take `now`; no hidden `new Date()` in pure logic. (CLAUDE.md: Key lib)
7. `entrySums` excludes legacy, `entrySumsAll` includes — per-person/time-series figures use `entrySums`. (CLAUDE.md: Gotchas)
8. `@/lib/store` public surface is fixed; domains talk via `methodsRef`; leads/candidates/gmail stay out of the store. (CLAUDE.md: Key lib)
9. `?viewAs=` writes blocked by preview-guard by default; local mirrors of API writes join the allowlist. (CLAUDE.md: Gotchas)
10. Confirmed writes → `toast()`; `showNotice` is a toast with tone info; no second notice mechanism. (CLAUDE.md: UI conventions)
11. Reduced motion via `prefersReducedMotion()`. (CLAUDE.md: UI conventions)
12. Server-only modules (service key, gmail, advice/run, hours-goal-server) never imported by client code. (CLAUDE.md: Access control)
13. &advice: no amounts leave the server; client hours = Client Reports' set; pace = Home's spread. (CLAUDE.md: advice/)
14. `any` only at the DB boundary with an eslint-disable reason. (db.ts header)
15. Keep why-comments (⚠️ notes, version refs); hand-formatted ~100 cols, no prettier. (CLAUDE.md: Gotchas)
16. Don't rename symbols named in CLAUDE.md. (skill rule 5)

## Shared helpers
See exports.txt (generated map of every exported symbol in src/lib). Key reuse targets:
- format.ts — dates (`shiftDays`, day/week formatting) · period-math.ts — period/bucket arithmetic, `daysBetween`
- db.ts — row mappers, `fetchAll`, `isMissingSchema`, `updateWithOptional`, `MISSING_SCHEMA_CODES`
- aggregate.ts — task→client map, minutes by client · task-hours.ts / task-rollup.ts — task hour totals
- studio-days.ts, jewish-holidays.ts — workdays/holidays · gantt.ts — shared timeline maths
- toast.ts, celebrate.ts, reduced-motion.ts, drag-lift.ts — UI feedback

## Batches
- [x] src/lib#1 (8 files)
  src/lib/about.ts, src/lib/aggregate.test.ts, src/lib/aggregate.ts, src/lib/app-origin.ts, src/lib/avatar-variant.test.ts, src/lib/avatar-variant.ts, src/lib/billing-rollover.test.ts, src/lib/billing-rollover.ts
- [x] src/lib#2 (8 files)
  src/lib/brief-diff.test.ts, src/lib/brief-diff.ts, src/lib/brief.test.ts, src/lib/brief.ts, src/lib/cap-tone.test.ts, src/lib/cap.ts, src/lib/celebrate.ts, src/lib/chart-window.test.ts
- [x] src/lib#3 (8 files)
  src/lib/cron.ts, src/lib/csp-reports.test.ts, src/lib/csp-reports.ts, src/lib/csp.test.ts, src/lib/csp.ts, src/lib/date-ranges.ts, src/lib/days-covered.test.ts, src/lib/db.test.ts
- [x] src/lib#4 (8 files)
  src/lib/db.ts, src/lib/drag-lift.ts, src/lib/duplicate.test.ts, src/lib/duplicate.ts, src/lib/egress.test.ts, src/lib/egress.ts, src/lib/estimate-pct.test.ts, src/lib/format.test.ts
- [x] src/lib#5 (8 files)
  src/lib/format.ts, src/lib/freelance-rate.test.ts, src/lib/freelance-rate.ts, src/lib/freelancer-details.test.ts, src/lib/freelancer-details.ts, src/lib/freelancer-link.test.ts, src/lib/freelancer-link.ts, src/lib/freelancer-sync.test.ts
- [x] src/lib#6 (8 files)
  src/lib/freelancer-sync.ts, src/lib/gantt-links.ts, src/lib/gantt-workdays.test.ts, src/lib/gantt.ts, src/lib/group-invariant.test.ts, src/lib/hours-goal-server.ts, src/lib/hours-goal.test.ts, src/lib/hours-goal.ts
- [x] src/lib#7 (8 files)
  src/lib/hours-split.test.ts, src/lib/hours-split.ts, src/lib/intake-fields.test.ts, src/lib/intake-fields.ts, src/lib/intake-links.ts, src/lib/jewish-holidays.ts, src/lib/links.test.ts, src/lib/links.ts
- [x] src/lib#8 (8 files)
  src/lib/members.ts, src/lib/mint-cap.test.ts, src/lib/mint-cap.ts, src/lib/overview-files.ts, src/lib/period-math.test.ts, src/lib/period-math.ts, src/lib/reduced-motion.ts, src/lib/report-links.ts
- [x] src/lib#9 (8 files)
  src/lib/report-period-focus.test.ts, src/lib/report-period-focus.ts, src/lib/report-sanitize.test.ts, src/lib/report-sanitize.ts, src/lib/report-snapshot.test.ts, src/lib/report-snapshot.ts, src/lib/sign-storage.ts, src/lib/snapshot.test.ts
- [x] src/lib#10 (8 files)
  src/lib/snapshot.ts, src/lib/storage-url.test.ts, src/lib/storage-url.ts, src/lib/studio-days.ts, src/lib/task-buckets.test.ts, src/lib/task-buckets.ts, src/lib/task-hours.test.ts, src/lib/task-hours.ts
- [x] src/lib#11 (8 files)
  src/lib/task-rollup.test.ts, src/lib/task-rollup.ts, src/lib/tick-tooltip.test.ts, src/lib/toast.ts, src/lib/toggle.ts, src/lib/types.ts, src/lib/uploads.test.ts, src/lib/uploads.ts
- [x] src/lib#12 (8 files)
  src/lib/use-enter-transition.ts, src/lib/use-is-narrow.ts, src/lib/use-member-emails.ts, src/lib/use-member-portraits.ts, src/lib/use-vacation.ts, src/lib/vacation.test.ts, src/lib/vacation.ts, src/lib/whats-new.test.ts
- [x] src/lib/advice#1 (8 files)
  src/lib/advice/context.test.ts, src/lib/advice/context.ts, src/lib/advice/merge.test.ts, src/lib/advice/merge.ts, src/lib/advice/owner.ts, src/lib/advice/run.ts, src/lib/advice/signals.test.ts, src/lib/advice/signals.ts
- [x] src/lib/advice#2 (1 files)
  src/lib/advice/word.ts
- [x] src/lib/candidates#1 (8 files)
  src/lib/candidates/actions.ts, src/lib/candidates/convert-server.ts, src/lib/candidates/convert.test.ts, src/lib/candidates/convert.ts, src/lib/candidates/data.ts, src/lib/candidates/email-import.test.ts, src/lib/candidates/email-import.ts, src/lib/candidates/fetch-document.test.ts
- [x] src/lib/candidates#2 (4 files)
  src/lib/candidates/fetch-document.ts, src/lib/candidates/import-email.ts, src/lib/candidates/types.test.ts, src/lib/candidates/types.ts
- [x] src/lib/gmail (6 files)
  src/lib/gmail/auth.ts, src/lib/gmail/crypto.ts, src/lib/gmail/google.ts, src/lib/gmail/parse.test.ts, src/lib/gmail/parse.ts, src/lib/gmail/sync.ts
- [x] src/lib/leads#1 (8 files)
  src/lib/leads/actions.ts, src/lib/leads/data.ts, src/lib/leads/estimate-import.test.ts, src/lib/leads/estimate-import.ts, src/lib/leads/estimate.test.ts, src/lib/leads/estimate.ts, src/lib/leads/estimates-data.ts, src/lib/leads/fx.ts
- [x] src/lib/leads#2 (8 files)
  src/lib/leads/leads.test.ts, src/lib/leads/look.tsx, src/lib/leads/mail.ts, src/lib/leads/nudges.ts, src/lib/leads/purge.ts, src/lib/leads/rules.test.ts, src/lib/leads/rules.ts, src/lib/leads/stage-map.ts
- [x] src/lib/leads#3 (2 files)
  src/lib/leads/stalled.ts, src/lib/leads/types.ts
- [x] src/lib/store#1 (8 files)
  src/lib/store/billing.ts, src/lib/store/boot-progress.test.ts, src/lib/store/boot-progress.ts, src/lib/store/clients.ts, src/lib/store/comments.ts, src/lib/store/dev-items.ts, src/lib/store/helpers.ts, src/lib/store/index.tsx
- [x] src/lib/store#2 (8 files)
  src/lib/store/keys-write-down.ts, src/lib/store/links.ts, src/lib/store/plan.ts, src/lib/store/preview-guard.test.ts, src/lib/store/preview-guard.ts, src/lib/store/refresh-cadence.ts, src/lib/store/requests.ts, src/lib/store/tasks.ts
- [x] src/lib/store#3 (4 files)
  src/lib/store/taxonomy.ts, src/lib/store/time-entries.ts, src/lib/store/timeline.ts, src/lib/store/types.ts
- [x] src/lib/supabase (3 files)
  src/lib/supabase/client.ts, src/lib/supabase/server.ts, src/lib/supabase/service.ts

## Result (report-only)
All 24 batches reviewed 2026-11-08; no code changed. Findings in report.md.

## Apply pass (started 2026-11-08, from report.md's safe simplifications)
Bugs and behaviour-changing ideas stay in report.md for Nitsan. Store/DB-path refactors that only a browser
could verify are skipped and noted under report.md → Skipped.
- [x] src/lib#1–#5 — dead finance formatters out of format.ts; egress/date-ranges use parseISO/shiftDays/toISODate; duplicate.ts reuses groupBy's run + one section-groups filter; brief.ts one cast; db.ts numOrNull; 2 stranded docs moved; 2 stale comments fixed
- [x] src/lib#6–#9 — gantt `toISO` = re-exported `toISODate`; period-math uses `MONTH_NAMES_SHORT`; intake-fields 2 casts + stranded doc; hours-split `{...EMPTY_SPLIT}`; sign-storage uses `service()` (+ doc now on the function); report-snapshot alias + week `findIndex`; jewish-holidays why-comment; 3 stale/misplaced comments. Not applied: gantt `daysBetween` swap, report-links narrower select, overview-files `sendJson`, test-fixture tidy-ups (period-math.test `days`, snapshot.test stubs)
