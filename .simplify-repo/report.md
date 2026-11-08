# simplify-repo report — src/lib (report-only, 2026-11-08)

Scope: 164 files in `src/lib` (~31k lines; `version.ts` and `whats-new.ts` excluded, see project.md), 24 batches.
Reviewed by six read-only reviewers, then **every finding below was checked against the code by hand** — line
numbers are as of commit 2261157. Nothing in `src/` was changed. Format: `file:line — lens — what — fix`.

## Apply pass (2026-11-08)
The "Findings by batch" safe simplifications were applied in six commits (`simplify-repo(...)`, 16812b7…d8958fa)
except those listed as "Not applied" per group in `ledger.md` — mostly store/DB-path consolidations that only a
browser can verify, typing changes that ripple, and test-fixture tidy-ups. Gates after: tsc clean, eslint 0 errors /
38 warnings (unchanged), 869 tests, build clean; Home, Weekly Plan and the Leads board smoke-checked on localhost.
**Everything under Bugs, Behaviour-changing ideas and Cross-cutting below is still open** (except the two marked FIXED).

## Bugs noticed
Ordered by severity. Security first.

- ✅ FIXED 2026-11-08 (uncommitted) — **src/lib/candidates/fetch-document.ts:24 — SSRF guard bypass (security, verified in Node 24).** `new URL("https://[::ffff:127.0.0.1]")` normalises the host to `::ffff:7f00:1`; `isPrivate` strips `::ffff:` and gets `7f00:1`, `split(".").map(Number)` gives NaN, every comparison is false → treated as public. Same for `[::ffff:a9fe:a9fe]` (169.254.169.254, cloud metadata) and for a redirect `Location` or an AAAA record of that shape. Fix: convert a hex-mapped tail to dotted form, and fail CLOSED (an IPv4 that doesn't parse to four 0–255 octets counts as private); add test rows.
- src/lib/candidates/actions.ts:52 (and src/lib/leads/actions.ts:53) — `logEvent` wraps the insert in try/catch, but supabase-js returns `{ error }` rather than throwing, so a failed history write is never logged ("It logs and moves on" doesn't). Check the returned `error` and `console.error` it.
- src/lib/candidates/data.ts:362 — `loadCandidate` ignores `.error` on links/interviews/comments/events/scores, so a failed read renders as an empty dossier instead of "Could not load"; its scores `.in()` is unpaged unlike `loadBoard` — throw on error, read scores via `allIn`.
- src/lib/candidates/import-email.ts:112,138 — the existing-candidate lookup and the `held` links read ignore `error`: a failed lookup creates a duplicate candidate, a failed `held` read re-adds files — throw `CandidateWriteError`.
- src/lib/candidates/convert-server.ts:30 — the double-conversion guard ignores the event-count `error`, so a failed read means "go ahead" (fails open) — return an error message instead.
- src/lib/store/plan.ts:417 — `updatePlanColumn` rolls back a failed write with `setPlanColumns(prev)` (the whole list as of call time), wiping any column change or refresh that landed in between — revert only this column's keys via `inversePatch`.
- ✅ FIXED 2026-11-08 (uncommitted) — **src/lib/brief.ts:411 — `escapeHtml` doesn't escape `"`, but its output goes inside `href="…"` (:435, :445, `anchor()`).** The why-comment on `anchor()` says escaping protects against a `"` in client-supplied URLs; it doesn't, so a client link can break out of the attribute in the admin intake email. Escape `"` → `&quot;` (as `leads/mail.ts` `esc` does).
- src/lib/freelancer-link.ts:9 — `decodeURIComponent` throws `URIError` on a stray `%`, so the public `/api/log/[token]` answers 500 instead of 404 for a malformed link — try/catch, fall back to the raw segment.
- src/lib/hours-goal-server.ts:76, 81, 185, 189 — tasks/clients/freelancers/profiles/charges/plan/fx queries discard `error`; a failed batch silently undercounts billable hours (a failed fx read drops AB from the goal), while `studioGoal`'s doc says "Throws on a query error". `if (error) throw …` each. Mirrors finance-admin — check there too.
- Tests that can't fail: egress.test.ts:256 (`toBe(p.perWorkday > 0 ? p.bytes : 0)` is a tautology when perWorkday > 0); brief.test.ts:350 (`configuredForNew` is never passed, so it re-tests the null fallback); mint-cap.test.ts:54 ("forgets an idle key" — size is 2 either way). Need a real assertion — your call what.
- src/lib/gmail/sync.ts:110 — `matchCandidates`' `onlyLeadId` branch skips `.is("deleted_at", null)`. The lead page's threads tab auto-backfills when `backfilledAt` is null, so a deleted lead's page can file threads onto the hidden lead — add the filter there.
- src/lib/leads/estimates-data.ts:236 — `loadLibraryActuals` puts every won line's task_id into one `.in()` (grows without limit → v1.66.0's URL 400) and reads `time_entries` unpaged (silently wrong averages past 1000 rows) — chunk ids + `fetchAll`.
- src/lib/leads/estimates-data.ts:595, 1204, 216 — `estimate_lines select *` across all estimates and per-estimate `time_entries` reads are unpaged — will truncate at 1000.
- src/lib/gmail/sync.ts:111, src/lib/leads/data.ts:288 — every live lead selected unpaged (622 already imported per sync.ts header; data.ts:268's "dozens a year" comment is no longer true). At 1000 the board and mail matcher silently lose leads — `fetchAll`, re-sort client-side.
- src/lib/leads/actions.ts:583 — `convertToClient` ignores errors from the `estimate_lines.task_id` updates, though its doc says a part-way failure "says so".
- src/lib/leads/actions.ts:775, 796 — `proposeSuggestion` and `supersede` have the same try/catch-around-supabase problem as `logEvent` (errors returned, never thrown, never logged).
- **src/lib/advice/signals.ts:233 — `capFilling` (and the "Over cap" tile, :1140) count hours from the `billable` index, which includes PENDING tasks; Client Reports' cap counts `billable && !pending` (client-reports/page.tsx:177).** Its own doc says "exactly as the report reads it", and CLAUDE.md says &advice uses Client Reports' set — so the pane's cap % can disagree with the page you invoice from. Use `index(data).report` like `reportDue`/`periodUnpaid` do. (Money-adjacent — your call.)
- src/lib/use-vacation.ts:123 — a non-missing-schema error on `my_vacation` / `vacation_requests` / the approver RPC is swallowed and the UI shows "no payslip / no requests" with `ready = true` — treat it as an error.

## Behaviour-changing ideas

- src/lib/candidates/types.ts:273 — `isOnBoard` has no caller outside its test (the board filters by status in the query). Use it on the board, or drop it with its test — your call, since that removes assertions.
- src/lib/candidates/fetch-document.ts:43 — DNS-rebinding window: `lookup()` checks one resolution, `fetch` resolves again. Pin the checked address (undici dispatcher `connect.lookup`); also block 64:ff9b::/96, ::/96, ff00::/8, 198.18.0.0/15. Tightens only.
- src/lib/store/tasks.ts:683 — `ids.includes` inside a `filter` over every task is O(n·m) — use a `Set` (same result; flagged here only because it's a hot list).
- Four inline `new Map(tasks.map(t => [t.id, t.clientId]))` (client-reports/page.tsx:672, clients/page.tsx:159, feed/page.tsx:219, task-autocomplete.tsx:47) duplicate `aggregate.ts` `buildTaskClientMap` — but the helper OMITS client-less tasks; check each caller's `.has()`/falsy use before switching.
- src/lib/format.ts:137, 161 — `formatDayMonth` / `formatFeedDate` don't `.slice(0, 10)` like `parseISO`/`formatDate` do; a timestamp would print NaN. All callers pass dates today — hardening.
- src/lib/hours-goal-server.ts:75 — 100-id task batches awaited sequentially — `Promise.all`. Mirrors finance-admin actions.ts:347: both repos or neither.
- src/lib/gmail/sync.ts:378 — header lookup is case-sensitive while parse.ts's `header()` isn't — switch for robustness.
- src/lib/gmail/parse.ts:89 — `htmlToText` decodes `&amp;` first (so `&amp;lt;` → `<`) and ignores `&#NN;` — finish with `decodeEntities`.
- src/lib/leads/estimate.ts:131 — `phaseLines` is used only by its test — keep as a tested helper, or rewrite that test against `phaseLayout`.

## Docs vs code disagreements

- src/lib/candidates/types.ts:122 — `profileId` doc says it's set only by "Add to the team" and is null for a freelancer; since v1.90.0 "Convert to a freelancer" sets it to the freelancer's login-less profile (CLAUDE.md 0061 row). Reword the comment.
- src/lib/candidates/convert.ts:21 — says 0061 is "unapplied as of 2026-11-05"; CLAUDE.md says applied by Nitsan 2026-11-05. Keep the step-down, update the date.
- src/lib/store/clients.ts:5 — header says a billable flip in `updateClient` is recorded as ONE undo step via `asOneStep`; the code (:183) records NO undo for any patch with `billable`, and `asOneStep` isn't passed to this hook. Header is wrong (or the feature was dropped).
- src/lib/store/refresh-cadence.ts:91 — cites "NEXT_PUBLIC_FULL_REFRESH gives the tick above"; that env var exists nowhere (src, scripts, .env*), and the tick above is a constant.
- src/lib/store/types.ts:297 — `loadDayEntries` doc says `timeEntries` holds "the recent 400"; snapshot.ts:393 uses `.limit(1000)`.
- CLAUDE.md store bullet: `@/lib/store` "exports only" 5 names; index.tsx also exports `withGroupInvariant` and `useMe` (fixed by the two simplifications above).
- src/lib/store/preview-guard.ts:81, clients.ts:31 — still say "notice banner"; it's a toast now (wording).
- src/lib/csp-reports.test.ts:193 — "the reason `countIsFloor` exists" — no such symbol anywhere; point at the footnote (csp-reports.ts:239).
- src/lib/db.ts:121 — `updateWithOptional` doc says "the `fetchAll` … ladder above"; `fetchAll` is below (:191).
- src/lib/format.ts:191 — "(Finance)" header for code that left with finance-admin (the dead block above).
- src/lib/report-snapshot.ts:195 — `through` doc still mentions "Stored-week columns" / "a hand-edited list"; `custom_weeks` is gone (the file's own :37 says so). Same in report-snapshot.test.ts:249.
- src/lib/gantt-links.ts:7, intake-links.ts:7 — say they "mirror" report-links.ts, but report-links resolves via `canonicalReportLink` (published first, then oldest) while these take the newest active row. Comment or rule is wrong.
- src/lib/hours-goal.ts:6 — says the P&L rows are fetched by /api/hours-goal; since v1.80.0 that's hours-goal-server.ts (which the route calls). Wording.
- src/lib/report-sanitize.test.ts:207 — comment "40h cap", code `50 * 60`.
- src/lib/snapshot.test.ts:413 — "`catchUp` in store.tsx"; it's store/index.tsx now.
- src/lib/leads/data.ts:268 — "dozens a year, not thousands"; sync.ts:19 records 622 imported, and the unpaged board query relies on the comment.
- src/lib/leads/actions.ts:405 — "Gmail threads (by hand until Phase 2)" — Phase 2 shipped; reword.
- src/lib/advice/signals.ts:121 — Index says `billable` is "the cap and estimate budgets" vs CLAUDE.md's "client hours use Client Reports' own set" (see the capFilling bug).
- src/lib/snapshot.ts:9, 168, 302, 463, 520 — describe tasks as a ~3-min tier and entrySums as the ~10-min cold tier; refresh-cadence.ts has both at every tick (`*_EVERY_N_TICKS = 1`). Amend, keep the reasoning.
- src/lib/advice/run.ts:23 — "90-day unpaid window"; unpaid uses 60 days. signals.ts:65 — "at least the last four months", but pulse needs ~180 days; trimming to the comment would truncate the pulse.
- src/lib/uploads.ts:142 — "the cap is a round 10MB"; it's 30MB (:71).
- **src/lib/supabase/server.ts:20 — "middleware refreshes sessions instead". There is no middleware, and `src/proxy.ts` sets only the CSP.** Either the comment is stale or nothing refreshes session cookies server-side (refresh-token-reuse sign-outs). Worth deciding whether proxy.ts should refresh.

## Skipped (and why)
- `src/lib/version.ts` — bumped only by the release loop.
- `src/lib/whats-new.ts` — release copy with its own style rules; only its test was reviewed.
- `hours-goal.ts` / `hours-goal.test.ts` duplication (`withDays` fixture ×4, unused `beforeDay`/`before`) — verbatim mirror of finance-admin; change both repos or neither.
- Pre-flagged ms-maths hits judged fine: `about.ts:19` (span between commit timestamps), `gmail/sync.ts:106` (rough window), `jewish-holidays.ts:57` (deliberately noon-UTC — but deserves a why-comment, listed below).
- Import style (`../` vs `@/` mixed in src/lib) — not a documented rule; not flagged.
- Many "exported but only used in its own file" types/constants — listed per batch as optional; low value.

## Cross-cutting suggestions

- src/lib/candidates/actions.ts vs src/lib/leads/actions.ts — `*WriteError`, `fail`, `touch`, `logEvent`, `reorderStages` near-identical. Two call sites: not worth a shared kit yet, but the `logEvent` fix must land in both.
- src/lib/candidates/data.ts:339 `allIn` (chunked `.in()` + `fetchAll`) is hand-written again, UNPAGED, at src/app/api/admin/freelancers/route.ts:86, src/lib/hours-goal-server.ts:75, src/lib/gmail/sync.ts:120 — promote to db.ts as `fetchAllIn(...)` so both PostgREST gotchas live in one helper.
- src/lib/candidates/email-import.ts:35 — `STUDIO_DOMAINS` restates gmail/parse.ts:9. Don't import from gmail/* (server-only; email-import reaches the browser). Move it to a neutral pure module both import. (Sharing `htmlToText` too would change Gmail's output — behaviour-changing.)
- Store insert-and-append boilerplate (`counting(insert().select().single()).then(… noteWriteError … setX(p => [...p, map(data)]))`) repeats 9×: tasks.ts addTask/addSection, links.ts:48, dev-items.ts:41, taxonomy.ts:55/101, timeline.ts:104, billing.ts:154, plan.ts:397 — an `insertRow(table, row, label, map, set)` beside `counting` in index.tsx.
- Store "update one row" pattern (find → inversePatch → record → optimistic map → update → wrote) repeats 5×: links.ts:66, dev-items.ts:59, taxonomy.ts:73, tasks.ts:466, tasks.ts:708 — a shared `patchRow` helper (~15 lines saved per site).
- src/lib/store/index.tsx:629 — attachment row mapper inline, mapped again in api/task-attachments/route.ts — `mapAttachment` in db.ts (optional, 2 sites).
- HTML escaping exists three times: brief.ts:411 (weaker, no `"`), leads/mail.ts:8 `esc`, app/api/leads/inbound/[token]/route.ts:106 (inline copy). One `escapeHtml` in a neutral client-safe module (mail.ts is server-only; brief.ts isn't).
- "d/m" formatter three times: format.ts `formatDayMonth`, task-list-row.tsx:195 `formatDueShort`, public-report-view.tsx:21 `dm` — fold into `formatDayMonth` (add the slice first).
- Month names restated ~8×: long at gantt.ts:101, freelancers/shared.tsx:44, log-view.tsx:88, weekly-plan.tsx:768, billing-rollover.ts:23, studio-pace.tsx:35; short at period-math.ts:33, client-view/stats.tsx:12 — add `MONTH_NAMES_LONG` beside `MONTH_NAMES_SHORT` in format.ts.
- A third `daysBetween` (string-based) at about-modal.tsx:809 — fold in once gantt/period-math share one.
- Service-role clients built inline in ~20 API routes as well as sign-storage — `service()` exists for this.
- hours-goal.ts:32 `studioWeekdays`' `beforeDay`/`before` unused here (finance uses them) — verbatim mirror, leave or change both repos.
- `toISODate(shiftDays(parseISO(x), n))` appears ~29× (signals.ts 23, report-snapshot, billing-rollover, client-reports, run.ts) plus local aliases (`shift` run.ts:21, `d` signals.ts:846/:1091) — add `shiftISO(iso, n)` to format.ts.
- `MISSING_SCHEMA_CODES.has(err.code ?? "")` hand-rolled ~8× (use-vacation.ts:65, freelancer-sync.ts:127, candidates/data.ts:144, api/admin/freelancers ×3, api/log/[token], api/leads/inbound, api/advice) — `isMissingSchemaError(err)` beside `isMissingSchema` in db.ts.
- src/lib/use-member-portraits.ts:4 — lib imports a type from `@/components/member-photo` (inverted layering) — move `PortraitVariant` into lib.
- Server-only modules (advice/run.ts, supabase/service.ts, hours-goal-server.ts) are guarded by convention only; advice.tsx imports run.ts type-only today. The `server-only` package would make it a build error — new dependency, so your OK.
- src/lib/gmail/auth.ts:6 — `requireAdmin` is a general API guard filed under gmail/; two routes keep private copies and 11 inline `role !== "admin"` — move to `src/lib/api-auth.ts`, adopt route by route (return shapes differ).
- "max(position|version) + 1" open-coded 6× across leads estimates-data/actions — optional `nextOrdinal(...)`.

## Findings by batch (safe simplifications)

### src/lib#1–#5 (40 files) — verified
**Safe simplifications**
- src/lib/format.ts:191-217 — simplification — `formatILS`, `formatILSShort`, `formatPct`, `formatSignedPct` ("Money & percentages (Finance)") have no callers anywhere (grep src+scripts) — left behind by the 2026-07-13 finance split — delete the block.
- src/lib/egress.ts:106, 236 — reuse — local `iso` helper defined twice, byte-for-byte `toISODate` (format.ts:50) — import it.
- src/lib/egress.ts:176, 182, 263 — reuse — `split("-").map(Number)` + `new Date(y, m-1, d)` three times plus a hand-rolled next-day step — `parseISO` / `shiftDays(d, 1)` (inputs are always yyyy-mm-dd).
- src/lib/date-ranges.ts:22-31 — reuse — "This week"/"Last week" copy a Date and `setDate` — `shiftDays(...)`, the project idiom.
- src/lib/duplicate.ts:180 — simplification — loop discards `groupBy`'s run (`[clientId]`) then re-filters `pickedSections` by clientId — destructure `[clientId, run]` (groupBy preserves order).
- src/lib/duplicate.ts:190 — efficiency — `taskGroups.filter(g => g.sectionId === s.id)` computed twice — once.
- src/lib/duplicate.ts:213 — reuse — groups loop restates `copyGroup` only because it mints its own id — optional `id = newId()` param (id order unchanged; duplicate.test pins n1/n2…).
- src/lib/brief.ts:343-377 — simplification — `(answers as Record<string, unknown>)` cast 5× in `readSubmission` — cast once after the guard.
- src/lib/db.ts:276… — simplification — `r.x == null ? null : Number(r.x)` 8× in mappers — in-file `numOrNull(v)`.
- src/lib/egress.ts:59,67,124,210,212 (+ several types in about/billing-rollover/brief-diff/brief/duplicate/freelance-rate) — simplification — exported but file-local — drop `export` (cosmetic).
- Stranded doc comments (move unchanged): about.ts:37 (belongs to `MILESTONES` :92), brief.ts:187 (belongs to `briefParts` :226).
- Tests: billing-rollover.test.ts:40 `today` re-implements `parseISO`; chart-window.test.ts:11 / days-covered.test.ts:12 wrap `parseISO` in `d = (iso) => parseISO(iso)` — use `parseISO` directly.
- Pre-flagged `about.ts:19` (`/ 86_400_000`) is fine: a rough span between two commit timestamps, not calendar-day logic.

### src/lib#6–#9 (32 files) — verified
**Safe simplifications**
- src/lib/gantt.ts:82 — reuse — `toISO` is byte-for-byte `toISODate` — `export { toISODate as toISO } from "./format"`, like the existing `parseISO`/`shiftDays` re-exports at :20.
- src/lib/gantt.ts:77 — reuse — a second exported `daysBetween` (raw ms, rounded) beside period-math.ts:49 (floors to midnight first). All gantt callers pass midnight Dates, so re-exporting period-math's gives the same output and makes gantt.ts:15's "the app's only date arithmetic" true. (med)
- src/lib/period-math.ts:33 — reuse — `MONTH_SHORT` restates format.ts `MONTH_NAMES_SHORT`; nothing imports it — import and drop.
- src/lib/intake-fields.ts:255, 260 — simplification — two needless casts (`filter(Boolean) as WorkKind[]` → type guard; `.asks as (keyof IntakeAnswers)[]` already typed).
- src/lib/hours-split.ts:67 — reuse — `newSplit()` repeats the `EMPTY_SPLIT` literal — `{ ...EMPTY_SPLIT }`.
- src/lib/sign-storage.ts:55 — reuse — builds the service-role client inline with options identical to `service()` (supabase/service.ts) — call `service()`.
- src/lib/report-snapshot.ts:73 — simplification — `const last = lastDay;` pure alias.
- src/lib/report-snapshot.ts:233 — efficiency — every entry scans all ~238 week columns with `forEach`; weeks never overlap — `findIndex` (leave the periods loop: periods can nest).
- src/lib/report-links.ts:22 — efficiency — `.select("*")` pulls every link's frozen `snapshot` jsonb just to pick a token — select the columns `canonicalReportLink` needs. (med: confirm `mapReportLink` tolerates the narrower row)
- src/lib/overview-files.ts:40,69,83,109 — reuse — JSON-fetch boilerplate 4× — local `sendJson(route, method, body)`.
- Stranded doc comments (move unchanged): intake-fields.ts:124 (belongs to `ALWAYS_ASKS` :137); sign-storage.ts:31 (⚠️ doc lands on `TTL_SECONDS`, not `signStorageUrl`); report-snapshot.test.ts:298 (belongs to the `through` describe at :383).
- src/lib/jewish-holidays.ts:57 — altitude — `DAY = 86400000` + `toISOString().slice` LOOK like breaches of digest rules 1–2 but are deliberate (everything anchored at noon UTC). The only record is the working log — add a one-line why-comment so a future sweep doesn't "fix" it.
- Tests: period-math.test.ts:327 `days(from, count)` ignores `from` (`void from`) — drop the param; snapshot.test.ts:78/306 two identical thenable stubs — one builder.

### src/lib#10–#12 + supabase + advice (36 files) — verified
**Safe simplifications**
- src/lib/advice/signals.ts:1116, 1208, 1231 — efficiency — `pulse()` computes `billableByClient` per window, discards it, then recomputes it 6× per billable client (O(clients² × windows)) — build `byWindow` once and reuse.
- src/lib/advice/signals.ts:663 — reuse — `toISODate(shiftDays(t, -t.getDay()))` is `startOfWeek` (format.ts) — use it. (:194 the same, optional.)
- src/lib/advice/signals.ts:269, 485, 522, 597 — simplification — `PAYMENT_TERMS_DAYS`, `incomeCostSeries`, `SIGNALS`, `openPlanDays` exported but file-local — drop `export`.
- src/lib/snapshot.ts:94 — `PackedEntrySums` exported but file-local.
- src/lib/snapshot.ts:602 — simplification — `wakeTransition`'s ternary is `{ paused: false, catchUp: paused }`.
- src/lib/task-buckets.ts:40 — efficiency — `by.set(b, [...(by.get(b) ?? []), t])` copies per task (quadratic) — push; drop the copy before `.sort` at :45 (local array).
- src/lib/task-hours.ts:16 — simplification — `taskMinutesDone` repeats `taskLegacyMinutes`'s body — `taskMinutes(task.id) + taskLegacyMinutes(task)` (makes the invariant pinned at task-hours.test.ts:64 literal).
- src/lib/advice/context.ts:27, 41 — standards — tile scopes typed `string[]`/`Set<string>`, so a typo compiles and silently shows no tile — `import type { TileScope }`.
- src/lib/vacation.test.ts:35, 76 — duplicated fixtures (`sep`, `oct13`, `aki`) — hoist.
- Checked: no amounts leave the server (P&L leaves as a ratio; `promptFor` sends facts + % tiles); pace uses the shared `evenSpread`.

### src/lib/store#1–#3 (20 files) — verified
**Safe simplifications**
- src/lib/store/index.tsx:94 — simplification — `withGroupInvariant` re-export exists only for `src/lib/group-invariant.test.ts:2` — point the test at `./store/helpers`, drop the re-export (restores CLAUDE.md's documented 5-name surface).
- src/lib/store/index.tsx:1249 — simplification — `useMe` is exported but only `useIsAdmin` (:1255) calls it — drop `export` (same doc reason).
- src/lib/store/plan.ts:477, billing.ts:186, time-entries.ts:317 — simplification — `restorePlanEntry`, `plannedTaskToReopen`, `restoreBillingPeriod`, `restoreTimeEntry` are returned into the context but aren't on `Store` and nothing outside their file calls them (grep: only two comments) — drop from the returned memos (keep `applyEntryLocally`, used by keys-write-down), update the "eleven methods" comment at index.tsx:1170.
- src/lib/store/taxonomy.ts:100 — simplification — `Math.max(0, ...tagRows.map((_, i) => i + 1)) + 1` is always `tagRows.length + 1`.
- src/lib/store/taxonomy.ts:129 — simplification — `oldName` repeats `beforeTag`'s lookup — `beforeTag?.name`.
- src/lib/store/tasks.ts:195-231 — reuse — `updateTasksVaried`'s apply-and-write block copies `restoreTasksBulk` (112-132) — one local `applyVaried(items, label)`, keeping both labels.
- src/lib/store/tasks.ts:522, 586, 768 — reuse — `reorderTask` / `reorderSection` / `reorderTaskGroup` are one densify-and-write routine three times, differing in sibling filter, table, setter — one local helper (reviewer checked the missing `movedId===beforeId` guard yields the same result).
- src/lib/store/index.tsx:263 & 426 — reuse — editable-target test written twice — one module-level `isEditable(el)`.
- src/lib/store/index.tsx:711 & 750 — reuse — the focus-blocking expression is written twice and the comment at :747 says they must match — one `focusHolds()` closure.
- src/lib/store/refresh-cadence.ts:24, 88 — simplification — `DEV_SLOWDOWN`, `idleAfterMs` exported but file-local — drop `export`.
- Stranded doc comments (move, don't delete): refresh-cadence.ts:100 (belongs to `inversePatch`, helpers.ts:10); timeline.ts:94 (links note → links.ts:38 `addLink`); requests.ts:194 (sits above `updatedRequests`, belongs to `markRevisionReviewed`); types.ts:364 (old showNotice doc above `freshEntryId` — merge its "not writeError" point into showNotice's doc at :383).

### src/lib/leads#1–#3 + src/lib/gmail (24 files) — verified
**Safe simplifications**
- src/lib/leads/estimates-data.ts:1175 — simplification — `latestApproved` is dead (grep -w src+scripts: definition only) — delete.
- src/lib/leads/look.tsx:85 — simplification — `stageStyle` is dead (same grep) — delete.
- src/lib/leads/data.ts:67 — simplification — `export { mapStage }` re-export has no importers (callers import `stage-map`) — drop.
- src/lib/leads/estimate-import.ts:296 — simplification — `export type { Range }` has no importers and `Range` is otherwise unused there — remove with its import.
- src/lib/leads/estimates-data.ts:382, 465 — reuse — `createEstimate` / `copyInto` copy `nextVersion()` (:280) line for line — call it.
- src/lib/leads/estimates-data.ts:39 — reuse — `fail` copies actions.ts:36 (the file already imports `LeadWriteError` from there) — export and import.
- src/lib/leads/estimates-data.ts:66… — reuse — defaults `350` (rate) / `18` (VAT) repeated 8× — `DEFAULT_RATE` / `DEFAULT_VAT`; status narrowing at :639 copies `mapEstimate` :65 — share it.
- src/lib/leads/estimates-data.ts:599, 620 — simplification — `.map((r) => mapPhase(r))` → `.map(mapPhase)`; orphan filter run twice; its line mapper copies `phaseOf`'s.
- src/lib/leads/data.ts:238-248 — simplification — `stageRows` ladder re-runs its last rung after the loop (same select as rung 3) — return the last result (saves a round trip on a fully-unmigrated DB only; same data).
- src/lib/leads/data.ts:420 — efficiency — `lead_suggestions` read waits behind the `Promise.all` at :405 with no dependency — join it.
- src/lib/leads/nudges.ts:73, stalled.ts:54 — standards (rule 1) — hand-rolled midnight-to-midnight ms maths — `Math.max(0, daysBetween(…))` from **period-math** (gantt's doesn't floor to midnight).
- src/lib/leads/stalled.ts:60 — reuse — `isOverdue` hand-builds yyyy-mm-dd — `toISODate(now)`.
- src/lib/gmail/sync.ts:353 — reuse — DRAFT/SPAM/TRASH/CHAT check copies `isRealMail` (parse.ts:198).
- src/lib/gmail/sync.ts:401 — reuse — `repliesToKnown`'s `h()` is `header(meta, name) ?? ""`.
- src/lib/gmail/sync.ts:400, google.ts:153,158 — simplification — inline `import("./parse").GmailMessage` types — top-level `import type`.
- src/lib/gmail/sync.ts:425 — efficiency — `matchCandidates` and `accounts` independent but sequential — `Promise.all`.
- src/lib/leads/actions.ts:157, 465 — simplification — `nowIso()` 2–3× per row (stamps can differ by a ms) — one `now`.
- src/lib/leads/fx.ts:94 — reuse — `formatIls` ≈ `formatILS` (format.ts) apart from negative-sign placement, which pipeline amounts never hit. (med — and note format.ts's `formatILS` is flagged dead above: reuse it here or delete both, not one.)
- src/lib/leads/data.ts:36 + estimates-data.ts:32 — reuse — identical `str`/`nstr`/`nnum` — one `leads/row.ts` (candidates' `nstr` differs; leave it).
- src/lib/leads/data.ts:265 — altitude — stranded doc ("Every lead … ALL OF THEM") stacked on `leadRows`, belongs to `loadBoard` (:307).
- Pre-flagged gmail/sync.ts:106 (`Date.now() - 90 * 86_400_000`) is fine — a rough window against a timestamp.
- deleted_at audit: every other `from("leads")` is an id-keyed write or an intentional by-id read (lead-page Undo, `deletedLeadName`).

### src/lib/candidates#1, #2 (12 files) — verified
**Safe simplifications**
- src/lib/candidates/data.ts:154 — altitude — `loadVocabulary`'s JSDoc (incl. the ⚠️ RETIRED SUBJECTS note) sits above `subjectRows`' own JSDoc, so it documents the wrong function — move the block unchanged to above `loadVocabulary` (:185).
- src/lib/candidates/data.ts:62 — simplification — `as CandidateLinkKind` is redundant; the ternary already narrows — drop the cast.
- src/lib/candidates/data.ts:42-97 — simplification — `mapStage/mapRole/mapLink/mapComment/mapEvent/mapCandidate` are exported but imported nowhere (only `loadBoard/loadCandidate/loadVocabulary` are); same names exist in db.ts/leads, inviting a wrong auto-import — drop `export`.
- src/lib/candidates/email-import.ts:479 — reuse — `appliedOnOf` re-implements `toISODate` (format.ts:50) line for line — `return Number.isNaN(d.getTime()) ? null : toISODate(d)`.
- src/lib/candidates/actions.ts:459 — reuse — `removeRole` repeats `roleUsage`'s count query — call `roleUsage(id)`.
- src/lib/candidates/import-email.ts:168 — simplification — both ternary arms build the same Blob — one `new Blob([content as BlobPart], …)`.
- src/lib/candidates/import-email.ts:192 — simplification — `doc.url.toLowerCase().replace(/\/$/, "")` computed twice — one local.
- src/lib/candidates/convert-server.ts:75,80 — simplification — two `new Date().toISOString()` calls — hoist one `now`.
- src/lib/candidates/email-import.ts:461 + src/app/api/candidate-file/route.ts:186 — reuse — storage-name sanitising regex written in both; re-import dedupe depends on them agreeing (the comment says so) — export one `storageSafeName()` from email-import.ts.
- src/lib/candidates/import-email.ts:217 — efficiency — each `addLink` also runs `touch()`: N links = N inserts + N `last_activity_at` updates, sequential — batch insert + one touch (same rows written).

