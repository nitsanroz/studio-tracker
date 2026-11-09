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
- [x] src/lib#10–#12 + supabase + advice — pulse() builds its six window maps once (was rebuilt per client); signals uses `startOfWeek`; 4 file-local exports dropped (+ snapshot's `PackedEntrySums`); `wakeTransition` one-liner; task-buckets push instead of copy-per-task; `taskMinutesDone` reuses `taskLegacyMinutes`; 2 stale comments (entries window, upload cap). Not applied: `TileScope` typing in advice/context.ts (ripples into `tilesFor`'s generic), snapshot.ts tier-cadence comments, vacation.test fixture hoisting
- [x] src/lib/store#1–#3 — `@/lib/store` back to its documented 5 names (test imports `withGroupInvariant` from helpers; `useMe` file-local); 4 context methods nothing calls dropped from the returned memos; taxonomy `tagRows.length + 1` and `beforeTag?.name`; refresh-cadence 2 file-local exports; 4 stranded docs moved; 5 stale comments (clients header undo claim, NEXT_PUBLIC_FULL_REFRESH, "400" → 1000, banner → toast ×2). Not applied: reorder/varied-update/insert-row/patch-row consolidations, `isEditable`/`focusHolds` dedupe — store DB paths are browser-verified only
- [x] src/lib/leads + gmail — dead `latestApproved`, `stageStyle`, `mapStage`/`Range` re-exports removed; `createEstimate`/`copyInto` call `nextVersion`; `fail` shared from actions.ts; nudges/stalled use period-math `daysBetween` + `toISODate`; lead page's suggestions read joins the `Promise.all`; gmail sync reuses `isRealMail` + `header`, `GmailMessage` imported once, backfill's two reads in parallel; loadBoard doc moved; stale "Phase 2" header. Not applied: stage-ladder round trip (Supabase column-string typing fights it), rate/VAT constants, phase-orphan tidy, shared `leads/row.ts`, `fx.formatIls`, `nowIso` once
- [x] src/lib/candidates — 6 file-local mappers no longer exported; redundant cast; `loadVocabulary` doc moved onto it; `appliedOnOf` uses `toISODate`; `removeRole` calls `roleUsage`; one Blob constructor; one URL key; one `now` in finishConversion; `profileId` doc + 0061 date note corrected. Not applied: `storageSafeName` shared with api/candidate-file (outside src/lib), batched link insert
- [x] Phase 3 — full gates green (tsc, eslint 0 errors / 38 warnings, 869 tests, build); Home, Weekly Plan, Leads board smoke-checked on localhost, no console errors

## Sweep 2 — src/components (report-only, started 2026-11-08)
Same digest and project.md. Reviewer brief: brief-components.md. 106 files, 16 batches.
- [x] src/components#1 (8 files)
  src/components/about-modal.tsx, src/components/account-inactive.tsx, src/components/advice.test.ts, src/components/advice.tsx, src/components/amp-loader.tsx, src/components/app-shell.tsx, src/components/auth-frame.tsx, src/components/brief-modal.tsx
- [x] src/components#2 (8 files)
  src/components/candidate-settings.tsx, src/components/cell-inspector.tsx, src/components/charts.tsx, src/components/client-avatar.tsx, src/components/client-contacts.tsx, src/components/client-files.tsx, src/components/client-info-modal.tsx, src/components/client-mark-picker.tsx
- [x] src/components#3 (8 files)
  src/components/client-mobile.tsx, src/components/client-notes.tsx, src/components/client-report-buttons.tsx, src/components/confirm-details-banner.tsx, src/components/confirm-dialog.tsx, src/components/count-up.tsx, src/components/desktop-only.tsx, src/components/editable-cell.tsx
- [x] src/components#4 (8 files)
  src/components/egress-banner.tsx, src/components/empty-state.tsx, src/components/global-search.tsx, src/components/hr-details-form.tsx, src/components/keys-write-down.tsx, src/components/lead-settings.tsx, src/components/links-editor.tsx, src/components/log-time-form.tsx
- [x] src/components#5 (8 files)
  src/components/logged-day.tsx, src/components/member-photo.tsx, src/components/member-select.tsx, src/components/member-week-hours.tsx, src/components/mobile-log-time.tsx, src/components/mobile-sheet.tsx, src/components/new-leads.tsx, src/components/notifications-bell.tsx
- [x] src/components#6 (8 files)
  src/components/occasions-settings.tsx, src/components/overview-files.tsx, src/components/password-input.tsx, src/components/period-stepper.tsx, src/components/picture-editor.tsx, src/components/plan-entry-modal.tsx, src/components/plan-mobile.tsx, src/components/primitives.tsx
- [x] src/components#7 (8 files)
  src/components/public-error.tsx, src/components/report-table.tsx, src/components/resizable.tsx, src/components/share-gantt-button.tsx, src/components/show-menu.tsx, src/components/skeleton.tsx, src/components/stage-track.tsx, src/components/studio-arrow.tsx
- [x] src/components#8 (8 files)
  src/components/task-autocomplete.tsx, src/components/task-bulk-controls.tsx, src/components/task-list-row.tsx, src/components/task-panel.tsx, src/components/time-entry-modal.tsx, src/components/toaster.tsx, src/components/ui.tsx, src/components/user-day-details.tsx
- [x] src/components#9 (4 files)
  src/components/vacation.tsx, src/components/week-timesheet.tsx, src/components/weekly-plan.tsx, src/components/whats-new-modal.tsx
- [x] src/components/client-timeline (8 files)
  src/components/client-timeline/cells.tsx, src/components/client-timeline/columns-menu.tsx, src/components/client-timeline/headers.tsx, src/components/client-timeline/index.tsx, src/components/client-timeline/layers.tsx, src/components/client-timeline/row.tsx, src/components/client-timeline/shared.ts, src/components/client-timeline/tooltip.tsx
- [x] src/components/client-view#1 (8 files)
  src/components/client-view/board.tsx, src/components/client-view/groups.tsx, src/components/client-view/index.tsx, src/components/client-view/row.tsx, src/components/client-view/section.tsx, src/components/client-view/selection.tsx, src/components/client-view/shared.ts, src/components/client-view/sort.tsx
- [x] src/components/client-view#2 (2 files)
  src/components/client-view/stats.tsx, src/components/client-view/toolbar.tsx
- [x] src/components/dashboard#1 (8 files)
  src/components/dashboard/celebrations.tsx, src/components/dashboard/day-log.tsx, src/components/dashboard/graphs.tsx, src/components/dashboard/index.tsx, src/components/dashboard/member.tsx, src/components/dashboard/pace-chart.tsx, src/components/dashboard/shared.ts, src/components/dashboard/studio-pace.tsx
- [x] src/components/dashboard#2 (2 files)
  src/components/dashboard/team-strip.tsx, src/components/dashboard/tiles.tsx
- [x] src/components/leads#1 (8 files)
  src/components/leads/attention-tip.tsx, src/components/leads/estimate-fields.tsx, src/components/leads/estimate-import-panel.tsx, src/components/leads/estimate-overview.tsx, src/components/leads/estimate-scope.tsx, src/components/leads/icon-select.tsx, src/components/leads/library-settings.tsx, src/components/leads/settings-popup.tsx
- [x] src/components/leads#2 (2 files)
  src/components/leads/stage-look-picker.tsx, src/components/leads/stage-modals.tsx

All 16 batches reviewed 2026-11-08 (report-only); findings in report-components.md.

## Sweep 3 — src/app (report-only, started 2026-11-08)
Brief: brief-app.md. 87 files (design-lab/* skipped: dev-only mock routes, notFound() in production, kept on purpose).
- [x] src/app (4 files)
  src/app/global-error.tsx, src/app/globals.css, src/app/layout.tsx, src/app/not-found.tsx
- [x] src/app/(app)#1 (8 files)
  src/app/(app)/error.tsx, src/app/(app)/layout.tsx, src/app/(app)/page.tsx, src/app/(app)/candidates/page.tsx, src/app/(app)/candidates/[candidateId]/page.tsx, src/app/(app)/client-reports/page.tsx, src/app/(app)/clients/page.tsx, src/app/(app)/clients/[clientId]/page.tsx
- [x] src/app/(app)#2 (8 files)
  src/app/(app)/feed/page.tsx, src/app/(app)/freelancers/page.tsx, src/app/(app)/freelancers/shared.tsx, src/app/(app)/freelancers/[profileId]/page.tsx, src/app/(app)/intake-queue/page.tsx, src/app/(app)/leads/page.tsx, src/app/(app)/leads/[leadId]/page.tsx, src/app/(app)/leads/[leadId]/convert/page.tsx
- [x] src/app/(app)#3 (8 files)
  src/app/(app)/leads/[leadId]/estimates/[estimateId]/page.tsx, src/app/(app)/my-tasks/page.tsx, src/app/(app)/plan/page.tsx, src/app/(app)/reports/page.tsx, src/app/(app)/settings/page.tsx, src/app/(app)/team/member-table.tsx, src/app/(app)/team/page.tsx, src/app/(app)/team/[profileId]/page.tsx
- [x] src/app/(app)#4 (2 files)
  src/app/(app)/vacation/page.tsx, src/app/(app)/welcome/page.tsx
- [x] src/app/api#1 (8 files)
  src/app/api/admin/freelancers/route.ts, src/app/api/admin/invite/route.ts, src/app/api/admin/member-emails/route.ts, src/app/api/admin/users/route.ts, src/app/api/advice/route.ts, src/app/api/advice/[id]/route.ts, src/app/api/avatar/route.ts, src/app/api/candidate-file/route.ts
- [x] src/app/api#2 (8 files)
  src/app/api/celebrations/route.ts, src/app/api/client-file/route.ts, src/app/api/client-icon/route.ts, src/app/api/csp-report/route.ts, src/app/api/egress/route.ts, src/app/api/file/route.ts, src/app/api/gmail/backfill/route.ts, src/app/api/gmail/callback/route.ts
- [x] src/app/api#3 (8 files)
  src/app/api/gmail/connect/route.ts, src/app/api/gmail/disconnect/route.ts, src/app/api/gmail/push/route.ts, src/app/api/gmail/renew/route.ts, src/app/api/gmail/status/route.ts, src/app/api/hours-goal/route.ts, src/app/api/intake/[token]/route.ts, src/app/api/intake/[token]/briefs/route.ts
- [x] src/app/api#4 (8 files)
  src/app/api/intake/[token]/briefs/[id]/route.ts, src/app/api/intake/[token]/upload/route.ts, src/app/api/intake/seen/route.ts, src/app/api/lead-file/route.ts, src/app/api/leads/digest/route.ts, src/app/api/leads/fx/route.ts, src/app/api/leads/inbound/[token]/route.ts, src/app/api/leads/offer-alert/route.ts
- [x] src/app/api#5 (6 files)
  src/app/api/log/[token]/route.ts, src/app/api/me/hr/route.ts, src/app/api/member-avatars/route.ts, src/app/api/member-image/route.ts, src/app/api/occasions/route.ts, src/app/api/task-attachments/route.ts
- [x] src/app/auth/confirm (1 files)
  src/app/auth/confirm/route.ts
- [x] src/app/estimate/[token] (3 files)
  src/app/estimate/[token]/error.tsx, src/app/estimate/[token]/page.tsx, src/app/estimate/[token]/public-estimate-view.tsx
- [x] src/app/gantt/[token] (3 files)
  src/app/gantt/[token]/error.tsx, src/app/gantt/[token]/page.tsx, src/app/gantt/[token]/public-gantt-view.tsx
- [x] src/app/intake/[token] (2 files)
  src/app/intake/[token]/error.tsx, src/app/intake/[token]/page.tsx
- [x] src/app/log/[token] (2 files)
  src/app/log/[token]/log-view.tsx, src/app/log/[token]/page.tsx
- [x] src/app/login (2 files)
  src/app/login/layout.tsx, src/app/login/page.tsx
- [x] src/app/report/[token] (3 files)
  src/app/report/[token]/error.tsx, src/app/report/[token]/page.tsx, src/app/report/[token]/public-report-view.tsx
- [x] src/app/reset (3 files)
  src/app/reset/layout.tsx, src/app/reset/page.tsx, src/app/reset/update/page.tsx

All src/app batches reviewed 2026-11-09 (report-only); findings in report-app.md.
