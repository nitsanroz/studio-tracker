# simplify-repo report — src/app (report-only, 2026-11-09)

Scope: 87 files in `src/app` (~28k lines; the dev-only `design-lab/*` mock routes skipped — they return
`notFound()` in production and are kept on purpose). Six read-only reviewers; the key findings below were
checked against the code by hand (line numbers as of 2175148 / v1.94.1). Nothing in `src/` was changed.
Format: `file:line — lens — what — fix`.

**Auth audit (API routes):** every route checks its caller before any service-role read or write — none
missing, none late. The one security bug is on the sign-in confirmation route (open redirect).

## Bugs noticed
Security and money first.

- **src/app/(app)/freelancers/[profileId]/page.tsx:812/:886 — saving a freelancer's client list can silently drop a client (billing scope).** `picked` is set once from `f.clientIds`; approving a line on a new client adds that client server-side (route.ts:404 upsert) and refreshes `f`, but "Edit" opens the stale set, and Save deletes and re-inserts the whole list (route.ts:492) — dropping the client the approval just opened. Fix: `setPicked(new Set(f.clientIds))` when Edit opens.
- **src/app/(app)/freelancers/shared.tsx:55 — `act()` rejects on a network failure**, leaving Approve / Save terms / Save stuck busy (+ unhandled rejection) at ~8 call sites — the class 90485ac fixed in components. One try/catch inside `act`.
- src/app/(app)/freelancers/[profileId]/page.tsx:647/856/921 — Charges `run`, New link, Switch on/off and Save clients discard `act`'s error: a refused change looks done, and Save clients closes the editor on failure.
- src/app/(app)/freelancers/shared.tsx:97 — rate/hours inputs are controlled by `String(Number(...))`: typing "47." collapses to "47", so a decimal rate can't be typed (only pasted), and clearing snaps to 0 — keep raw strings, convert on submit.
- src/app/(app)/freelancers/[profileId]/page.tsx:566 — WaitingRow keeps the previous client's tasks in the select until the new list arrives, so an approve can file on the wrong client's task — `setFetched(null)` on change, as EditLineModal does. (med)
- src/app/(app)/freelancers/[profileId]/page.tsx:856 — native `confirm("Make a new link?…")`: dead in the desktop pane — `askConfirm`.
- src/app/(app)/freelancers/[profileId]/page.tsx:631/:699 — native `prompt()` to turn down a log AND a charge. The note is optional (the route stores empty as null), so `askText` needs an `allowEmpty` option (empty → "", cancel → null).
- src/app/(app)/freelancers/[profileId]/page.tsx:838 — `clipboard.writeText` uncaught — the tolerated copy fallback. (med)
- src/app/(app)/feed/page.tsx:614/573/592 — in a period view (rows from `fetched`), delete and edit change only the store, so the row stays unchanged on screen; delete passes no `known` row, so no ⌘Z outside the store window — pass the row and patch `fetched` (the user-day-details fix, 3c05571).
- src/app/(app)/feed/page.tsx:224 — switching a preset to "Recent" mid-fetch cancels it and `setLoading(false)` never runs: "loading…" sticks and the empty state never shows.
- src/app/(app)/feed/page.tsx:88 — CellDetails ignores a fetch error; its skeleton spins forever. (med)
- **src/app/(app)/leads/[leadId]/page.tsx:269 — `run()` catches every error and resolves, so callers' "on success" steps run after a failure and what was typed is lost**: the activity composer clears (`.finally`, :1043), the link-by-hand email form clears and closes (:1449), the new-offer form resets and closes (:1926), `finishStep` refocuses (:358). Have `run` return ok/false and clear only on success.
- **src/app/(app)/leads/[leadId]/page.tsx:628/:1989 — the date-typing bug fixed in editable-cell (e56f772)**: next-step due and offer sent dates save 0002 → 0020 → 0202 → 2026 while a year is typed, and each save reloads and re-keys (`d${…}`), remounting the field mid-typing — the same `< 1900` guard, or commit on blur.
- src/app/(app)/leads/page.tsx:1066 — the board's `reload()` after Settings closes doesn't re-read nudge settings, so edited rules don't reach the cards until a full reload. (med)
- src/app/(app)/leads/page.tsx:1408/:1435 — the List view with zero leads shows two empty messages.
- src/app/(app)/leads/page.tsx:913 vs :395 — the header's "N open · ₪X in play" counts no-stage/unknown-stage leads as open; the Summary tile doesn't — they disagree when "No stage" has cards. (med)
- src/app/(app)/leads/[leadId]/page.tsx:1609/:1816 — `loadEstimateSources()`/`loadEstimates()` uncaught: a failed read leaves the loading state forever. (med)
- src/app/(app)/leads/[leadId]/convert/page.tsx:134/:427 — `pickEstimate` uncaught and unguarded against stale responses (two quick switches can build from the older estimate). (med)
- src/app/(app)/leads/[leadId]/convert/page.tsx:181/:242 — `suggested` can be an ARCHIVED client the select doesn't list: Review shows an empty client and Create throws "Pick the client." (med)
- src/app/(app)/intake-queue/page.tsx:369/:379 — `clipboard.writeText` unguarded (Safari after an await) — catch + notice / copy fallback. (med)
- src/app/(app)/leads/[leadId]/page.tsx:1156/:1483 — `<p>` as a direct child of `<ol>`/`<ul>` (invalid HTML). (med)
- **src/app/auth/confirm/route.ts:10/19/22 — open redirect (security).** `next` goes unchecked into `${origin}${next}`; `next=@evil.com` makes `https://tracker.studionmore.com@evil.com`, which sends the browser to evil.com after a successful sign-in link (an attacker can use a link for their own account). Accept `next` only if it starts with "/" and not "//" or "/\", else "/".
- **src/app/api/admin/freelancers/route.ts:382 — racing approvals double-count a freelancer's hours.** Approve never checks that `updateLog(..., "pending")` updated a row: a double click or two admins both insert a time entry, the second log update matches 0 rows with no error, and an orphan entry double-counts. `editLog` (:450) already answers 409 on `!written?.length` — do the same (and delete the fresh entry).
- **src/app/api/leads/inbound/[token]/route.ts:188 — the website-lead email match is a pattern.** `.ilike("email", email)` treats `_` (common in real addresses) and `%` as wildcards, so a submission can match someone else's contact and log on the wrong lead — escape first (candidates' `likeLiteral` exists).
- **src/app/report/[token]/page.tsx:97 — a published report's as-of date is the UTC date (client-facing money page).** `String(published_at).slice(0, 10)`: published 00:00–02:00/03:00 Israel time reads a day early, so "days in period" is off by one — `studioDate(...)`.
- src/app/api/intake/[token]/route.ts:359 — the upload check `list(..., { search: basename, limit: 1 })` matches by PREFIX: a claimed path that doesn't exist can be "verified" by another object whose name starts with it, and its size/mime are read from that object — require `object.name === basename`.
- src/app/api/client-file/route.ts:97 — the browser PUTs bytes with its own Content-Type and nothing re-checks what storage stored (task-attachments does at commit) — an `x.png` stored as `text/html` would render through `/api/file`. Add a server commit step (lead-file has the same gap, admin-only). (med)
- src/app/api/intake/seen/route.ts:48, leads/offer-alert/route.ts:41 — read → send → stamp with no claim first: two concurrent clicks mail the client (or approvers) twice — guarded stamp before sending. (med)
- src/app/api/admin/users/route.ts:45 — a failed profile insert leaves the auth user behind (a retry then says "already registered"); the plan_columns insert error is ignored. (med)
- src/app/api/log/[token]/route.ts:158, admin/freelancers/route.ts:269 — full-history log and charge reads are unpaged; 0056 sheet history can pass 1000 rows — `fetchAll`. (med)
- src/app/api/intake/[token]/briefs/route.ts:55 — one non-UUID among the remembered ids fails the whole `.in()` and the chooser comes back empty. (med)
- src/app/intake/[token]/page.tsx:1306 — the brief submit fetch is uncaught: a network failure leaves "Sending…" stuck for the CLIENT. log/[token]/log-view.tsx:482/:646 — the freelancer's composer and deliverables add, same. (the 90485ac class)
- src/app/log/[token]/log-view.tsx:351/405/677 — DELETEs never check `r.ok`: a failed delete reloads with the row still there and no message. (med)
- src/app/log/[token]/log-view.tsx:298/:676 — native `confirm()` on the freelancer's page — `askConfirm` (it mounts its own root, works outside AppShell).
- src/app/gantt/[token]/public-gantt-view.tsx:233 — public timeline's `today` memoized once (the ea07cbb fix, not applied here). (med)
- src/app/(app)/settings/page.tsx:317 — "Reset to default" on the UPDATE-receipt editor loads the FIRST receipt's text (`SEEN_EMAIL_DEFAULT` instead of `fallback`); Save would store it as the update email.
- src/app/(app)/team/[profileId]/page.tsx:133 — age = ms / 365.25 days from a UTC-parsed birth date: on the birthday itself it can show the old age (born 2000-03-01 reads 25 on 2026-03-01) — calendar arithmetic.
- src/app/(app)/reports/page.tsx:537 — `exportCSV` sorts the memoized `enriched` array IN PLACE, reordering page state — `[...enriched].sort`.
- src/app/(app)/team/page.tsx:65 — Add user: no try/finally — stuck "Adding…" on a network failure or non-JSON 500.
- src/app/(app)/team/[profileId]/page.tsx:117 — HR `saveField` updates optimistically and never reverts; the same value can't be re-saved and the error only reaches the console. (med)
- src/app/(app)/settings/page.tsx:386 — clipboard not awaited: "Link copied ✓" shows even when it failed. (med)
- src/app/(app)/settings/page.tsx:900 — CSP "since" compares UTC dates but shows local ones. (med)
- src/app/(app)/candidates/[candidateId]/page.tsx:1511/:2022 — native `window.confirm` for deleting a candidate and an interview — dead in the desktop pane — `askConfirm`.
- src/app/(app)/candidates/page.tsx:128 — `ago()` floors 24h blocks (the same as leads; one shared fix).
- src/app/(app)/client-reports/page.tsx:1310 — `copyLink` awaits the clipboard uncaught: a refusal is unhandled with no feedback — the `publish` pattern (:1295) + fallback.
- src/app/(app)/candidates/[candidateId]/page.tsx:686/:1006 — `await res.json()` uncaught: a 500 with HTML shows "Unexpected token…". (med)
- src/app/(app)/candidates/page.tsx:649, [candidateId]/page.tsx:2115/2179 — `.slice(0,10)` on timestamps = UTC day; items made before 02:00/03:00 land on the previous day. (med)
- src/app/(app)/candidates/page.tsx:407 — switching In play / On hold / Archive shows the previous view's rows until the fetch lands. (med)

## Behaviour-changing ideas

- feed/page.tsx:509 lowercase "loading…" line → `LoadingLine`; feed/page.tsx:136/863 hand-written empty states → `EmptyState` (outside table cells).
- feed/page.tsx:614 — delete has no confirmation and no toast/Undo; freelancer approve / turn down / charges / terms / clients don't toast either.
- feed/page.tsx:72-97/230/365, freelancers/[profileId]/page.tsx:139 — Supabase straight from page components — move to src/lib.
- intake-queue/page.tsx:272/:710 — native `confirm()` → `askConfirm` (⚠️ :272's message relies on `\n\n`; ConfirmBox's `<p>` has no `whitespace-pre-line` — add it or reword).
- leads/page.tsx:136, [leadId]/page.tsx:1263 — `ago()` floors 24h blocks (closed 23:00 last night reads "today" at 08:00) — `daysSince(iso, now)` (calendar days). leads/page.tsx:393/408/411 are durations between instants — fine.
- leads/page.tsx:1494 — lucide `ArrowRight` is an inline marker, not a go-there arrow — swap for `SlidersHorizontal` (already imported) to clear the grep.
- intake-queue/page.tsx:853 "Open the task →" — `StudioArrow`; [leadId]/page.tsx:1727 "Loading estimates…" — `SkeletonRows`.
- Hand-drawn empty states: leads/page.tsx:580 (a copy of EmptyState tone=success), :1294; [leadId]/page.tsx:1156/1173/1483/1863/2037; intake-queue:1021.
- convert/page.tsx:266 — `window.alert` on a partial file-copy failure blocks the redirect — `toast()` survives navigation.
- leads/page.tsx:1424 — "Show every lead" doesn't persist like the View menu switches.
- estimates/[estimateId]/page.tsx:158 — version-note `window.prompt` is dead in the pane; an empty note is allowed, so it needs `askText` with `allowEmpty`. settings/page.tsx:478/539 — native `confirm()` → `askConfirm`.
- settings/page.tsx:191 — a failed `app_settings` read shows the default template; saving then overwrites the stored one — show the error, disable Save.
- team/page.tsx:83 — `AddUserModal` hand-rolled overlay — `Modal`; team/page.tsx:38 `tenureShort` counts a leaver to today (not `endDate`) and can go negative; [profileId]/page.tsx:212 due date as `MM-DD` — `formatDayMonth`.
- reports/page.tsx:460 — a failed query says "No hours in this range"; :636 the user filter lists active people only (a former member's past hours can't be isolated).
- report/[token]/page.tsx:54, gantt/[token]/page.tsx:129 — "nothing yet" placeholders draw a letter box though `signedIcon` is computed — `ClientAvatar`.
- estimate + report public views — `toLocaleDateString` in a client component renders in UTC on the server and local on hydrate (wrong day / hydration mismatch near midnight) — `studioDate`.
- login/page.tsx:25 — Supabase's message shown as-is: "Email not confirmed" vs "Invalid login credentials" reveals an address has an account — one generic message.
- log/[token]/ has no `error.tsx`, unlike the other public token routes.
- leads/fx/route.ts:16 — any member can call it (with RLS they read nothing, so each call hits the Bank of Israel and the upsert fails) — `requireAdmin`.
- admin/freelancers/route.ts:492 (`clients` delete-then-insert ignores the delete error; a failed insert leaves no clients), :509 (duplicate → 500, should be 409); task-attachments:142, occasions:51 (bad JSON → 500, should be 400).
- celebrations/route.ts:45, leads/fx/route.ts:37, leads/inbound:184 — UTC slices / ms days; harmless in effect (slack absorbs it) — `studioToday`/`shiftDays` for rule 1–2.
- Status lines ("Saved ✓", "Link copied ✓", "added ✓") → `toast()`; "loading…"/"Reading…" → `LoadingLine`; plain empty lines → `EmptyState` (reports, settings, team, member-table).
- client-reports/page.tsx:700/1172/1844 — a private toast banner (a second notice mechanism; an earlier timer can kill a later toast) — `toast()`. Live money page: your call.
- client-reports/page.tsx:706 — `report_links` loads `*`, so every published snapshot jsonb downloads on open (egress) — named columns; snapshot only where `periodOnly` needs it.
- candidates/page.tsx:1086 — "Nobody in play" plain `<p>`, a filter that hides everyone shows nothing, copy still says "bring the Asana history across"; clients/page.tsx:306 reads `No clients match ""` with no query — `EmptyState`.
- clients/page.tsx:85 `CreateClientModal` hand-rolled overlay — `Modal`.
- candidates (page.tsx:50/278, [candidateId]:110) — three score tone→colour maps that DISAGREE on "mid" and "high" — one map (a visual change).

## Docs vs code disagreements

- src/app/(app)/freelancers/shared.tsx:5 — says it's shared by the two /freelancers pages; `TermsForm` is also imported by the candidate page (the Convert-to-freelancer form) — belongs in src/components, or say so.
- src/app/(app)/intake-queue/page.tsx:926 — describes a three-item header with `sm:order-2/3`; the checkbox moved to the list and no order classes remain. :942 — says the title is `text-xl` on a phone; it's only `page-title`.
- **The backfill question again, now in src/app:** team/page.tsx:219, team/[profileId]/page.tsx:258 and reports/page.tsx (raw `time_entries`, legacy included, :236) draw per-person and per-month figures WITH pre-Everhour backfill, on purpose with why-comments — vs CLAUDE.md's "must not leak backfill" gotcha. Same open decision as report-components.md.
- CLAUDE.md "App structure" lists the routes that skip the session check but omits `log/[token]` (public, token-gated).
- src/app/api/leads/digest/route.ts:14 — "04:00 UTC (07:00 Israel in winter…)": 04:00 UTC is 06:00 in winter, 07:00 in summer.
- src/app/api/intake/seen/route.ts:17 — claims a double click "cannot" mail twice; it can (Bugs).
- src/app/api/csp-report/route.ts:23 — "the one write path any stranger can reach" — intake, its upload, leads/inbound and log/[token] are too.
- src/app/api/leads/fx/route.ts:10 — says the caller is an admin; any member is accepted. src/app/api/client-file/route.ts:97 — "The Content-Type is ours… never the browser's" — the browser sets it (Bugs). src/app/api/intake/[token]/route.ts:499 — a comment that argues with itself mid-sentence.
- src/app/gantt/[token]/public-gantt-view.tsx:1045 ("No 'Show all' reset" — one is rendered), :1040 (chips "under the header" — under the chart), :1090 ("Color types" vs "Color by type"), :80 (pinned column "and its budget" — removed 2026-08-19).
- src/app/report/[token]/public-report-view.tsx:26 — orphaned doc for a deleted function; :46 `PublicReportView`'s doc sits above `AmpMark`. report/[token]/page.tsx:48 (and gantt :64) — "awaited BEFORE the early return so both branches share one value" — the early branch doesn't use it.
- src/app/intake/[token]/page.tsx:834 — "Logo skips the Details step… five screens"; `stepsFor` always returns six. src/app/estimate/[token]/public-estimate-view.tsx:12 — "nothing under 16px"; `Tag` is 13px. src/components/public-error.tsx:6 — "three" pages; estimate uses it too.
- src/app/globals.css:684 — describes the removed lead-card crown.
- src/app/(app)/candidates/[candidateId]/page.tsx:959 — says `alive` stops a late response setting state; `reload()` sets state itself, so it's inert.
- **Correction to report-components.md:** Client Reports does NOT match the Keys task by name (it uses `keysTaskId`; `/keys/i` only orders the picker). The task-panel Move-entries item still stands.

## Skipped (and why)
- `src/app/design-lab/*` — dev-only mock routes, `notFound()` in production, kept on purpose (v1.78.0).
- Copy-link `window.prompt` fallbacks after a clipboard failure — tolerated (they only run when copying fails).

## Cross-cutting suggestions

- `askText` needs an `allowEmpty` option for optional-note flows (freelancer turn-down of a log and of a charge; check the estimate version note too).
- One network-safe `act()` in freelancers/shared.tsx covers ~8 call sites (mirrors 90485ac).
- "YYYY-MM" helpers `monthLabel`/`shortMonth`/`shiftMonth` (freelancers/shared.tsx) likely restated in log/[token]/log-view.tsx — fold with `MONTH_NAMES_LONG` if confirmed.
- `ago()` 3× (candidates/page.tsx:125 and leads/page.tsx:136 byte-identical; leads/[leadId]/page.tsx:1263 a variant) — one helper in format.ts on `daysSince`, with the calendar-day fix.
- "open = no stage or an open-kind stage" written 4× in leads/page.tsx (:394/491/901/921) — one helper fixes the open-count mismatch too.
- More QUIET near-copies at convert/page.tsx:294/477/496; leads/page.tsx:662 is another copy of the outside-click/Escape popover effect (`useDismiss`).
- **Service-role client built inline instead of `service()`** — 25 routes + the three public pages (estimate/gantt/report `admin()`): admin/freelancers, admin/invite, admin/member-emails, admin/users, avatar, candidate-file ×2, celebrations, client-file, client-icon, csp-report, egress, file, intake/[token] + briefs + briefs/[id] + upload, intake/seen, lead-file, leads/inbound, log/[token], me/hr, member-avatars, member-image ×2, task-attachments.
- **Inline/private admin checks** (all correct today): admin/* ×4, candidate-file ×2 (GET must keep its 404), client-file, client-icon, csp-report GET, egress, hours-goal, intake/seen, lead-file, member-image, occasions (needs the session client), task-attachments DELETE — move `requireAdmin` to `src/lib/api-auth.ts`.
- Timing-safe compare written 3× (gmail/push, leads/inbound, lib/cron.ts) — export one `safeEqual`.
- Resend boilerplate 4× (admin/invite, intake/[token], intake/seen, leads/inbound) while `lib/leads/mail.ts` has `sendMail` — one server-only sender with `reply_to`.
- Storage-name sanitiser 5× (candidate-file, client-file, lead-file, task-attachments, intake upload) — `storageSafeName(name, max)` (candidate copy must keep matching email-import).
- Unpaged chunked `.in()` at admin/freelancers:86 — `fetchAllIn`. Inline HTML escaper at leads/inbound:106 — the shared `escapeHtml`. `d/m/yy` + UTC slice at leads/digest:81.
- Network-stuck buttons on PUBLIC pages (intake submit, log composer/deliverables/deletes) — the 90485ac fix.
- The `rounded-xl bg-background … focus:ring-2` field-well class is repeated 33× across 11 files — a `FIELD_WELL` constant or `Input variant="well"`.
- Supabase straight from pages: reports:451, settings:191/230/339/354/663, team/[profileId]:30/43/99/118 — `lib/app-settings.ts`, `lib/member-hr.ts`, `loadReportEntries` (member_hr stays admin-only).
- `SortHeader` (clients/page.tsx:28 vs client-view/sort.tsx:87): the app copy adds `align` + its own hints — a merged component needs both props.
- Client Reports' Supabase calls (report_links load/ensure/publish, rollover upsert, `client_months_paid` rpc) and the candidate page's admin fetches — a byte-for-byte move into `lib/client-reports.ts` / `finance-paid.ts`. Live money: pure move only.
- `TermsForm` imported page-to-page (candidates → freelancers/shared) — move to components/.
- Absolute (not fixed + portalled) popovers: candidate ⋯ menu, Client Reports "more clients" and period picker — low risk today; fold into the popover work.

## Findings by batch (safe simplifications)

### src/app/(app) candidates, client-reports, clients (8 files) — verified
**Safe simplifications**
- src/app/(app)/client-reports/page.tsx:1856 — `const {  } = useData();` does nothing — delete.
- src/app/(app)/client-reports/page.tsx:1455 — `parseInvoiceDay(c.invoiceNote)` 4× per tab per render — once.
- src/app/(app)/client-reports/page.tsx:842/1117 — `effHideEmpty`/`effFolded`/`effPeriodIndex` are plain aliases (keep the ⚠️ comment). (med)
- src/app/(app)/client-reports/page.tsx:731, clients/page.tsx:158 — inline task→client maps — `buildTaskClientMap` (safe: read only through `if (cid)` / falsy skips).
- src/app/(app)/client-reports/page.tsx:170/242 — stranded docs: the Keys-picker note belongs to `keysCandidates` (:199), the hour-cap note to `commitClientCap` (:265).
- src/app/(app)/clients/page.tsx:193 — efficiency — `tasks.filter` per client, recomputed per search keystroke — count once in a memo.
- src/app/(app)/clients/page.tsx:235 — `{isAdmin && …}` can't be false after the gate at :223.
- src/app/(app)/clients/page.tsx:105/124 — duplicate `outline-none`; `focus:border-brand` with no border. (med)
- src/app/(app)/candidates/page.tsx:262 — orphan NameAvatar doc on `StageProgress` (not a why-comment) — delete; :362 the "FETCH LIVES INSIDE THE EFFECT" doc belongs to the board effect at :407 — move.
- src/app/(app)/candidates/page.tsx:829/876/911/965 — the same four card props repeated for each `CandidateCard`; make drag handlers optional. :898 `byStage.get("") ?? []` 3×.
- src/app/(app)/candidates/[candidateId]/page.tsx:695/796 — `field` class + Job-title select duplicated in the two convert modals (med); :2198 comment belongs to the `MobileSheet` at :2237.
- Checked: Client Reports picks the Keys task by `client.keysTaskId` (:191); `/keys/i` only sorts the picker's options. v1.94.0's paid months fall back to "nothing paid" on an rpc error, and `paid` never reaches a published snapshot.

### src/app/(app) feed + freelancers (4 files) — verified
**Safe simplifications**
- src/app/(app)/feed/page.tsx:200,907 — simplification — `menu`/`setMenu` is never set to anything but null: the `ContextMenu` mount, its import and the state are dead — delete.
- src/app/(app)/feed/page.tsx:73,134 — simplification — `loadedIds` is only tested for `null` — fold into one `loaded` state.
- src/app/(app)/feed/page.tsx:219 — reuse — inline task→client map; `buildTaskClientMap` is safe here (only compared with `!==` to a picked id). (med)
- src/app/(app)/feed/page.tsx:302,696,719 — standards (rule 2) — `new Date("yyyy-mm-dd")` (UTC) then local `getDay()` — `parseISO`.
- src/app/(app)/feed/page.tsx:337 — reuse — `weekLabel` hand-rolls `d/m` twice — `formatDayMonth`.
- src/app/(app)/feed/page.tsx:328,545,805 — efficiency — `profiles.find`/`clients.find` per row over a fetched month — id maps beside `taskById`.
- src/app/(app)/feed/page.tsx:655,665 — simplification — `toISODate(startOfWeek(new Date()))` twice per render — one const.
- src/app/(app)/freelancers/shared.tsx:8 — reuse — `Terms` is field-for-field `RateTerms` (lib/freelance-rate.ts).
- src/app/(app)/freelancers/shared.tsx:44 — reuse — long month names (the `MONTH_NAMES_LONG` fold); `shortMonth` from `MONTH_NAMES_SHORT`.
- src/app/(app)/freelancers/[profileId]/page.tsx:111 — reuse — `thisMonth()` rebuilds the studio date — `studioToday().slice(0, 7)`.
- src/app/(app)/freelancers/[profileId]/page.tsx:358 — simplification — `monthLabel(...).split(" ")[0]` recovers a month name from a string. (med)

### src/app/(app) intake-queue + leads (4 files) — verified
**Safe simplifications**
- src/app/(app)/intake-queue/page.tsx:146/:550 — simplification — `formatDate(x.slice(0, 10))`: `formatDate` already slices (format.ts:124) — drop the slices.
- src/app/(app)/leads/page.tsx:278/1398, leads/[leadId]/page.tsx:435 — simplification — `as LeadSource` casts on a field already typed (and narrowed at :435).
- src/app/(app)/leads/page.tsx:88 — simplification — second import lines from `@/lib/leads/data` / `actions` — fold into the existing ones.
- src/app/(app)/leads/page.tsx:490 — reuse — hand-built yyyy-mm-dd — `toISODate(now)`.
- src/app/(app)/leads/[leadId]/page.tsx:1497 — altitude — stranded "New estimate" doc stacked on `EstimateSourceCard`; belongs to `NewEstimateModal` (:1585).
- src/app/(app)/leads/[leadId]/page.tsx:1292 — reuse — studio-domain regex repeats `STUDIO_DOMAINS` (gmail/parse.ts is client-safe here). (med)
- src/app/(app)/leads/[leadId]/page.tsx:130 — reuse — `QUIET` copy (joins the QUIET fold). (med)
- src/app/(app)/leads/[leadId]/convert/page.tsx:524/556/573 — simplification — the same Set add/delete updater 3×. (med)
- src/app/(app)/leads/page.tsx:215, [leadId]/page.tsx:1026/1904 — `Parameters<typeof Avatar>[0]["profile"]` — the `Profile` type. (med)

### src/app/(app) reports, settings, team, estimate page, globals.css (14 files) — verified
**Safe simplifications**
- src/app/globals.css:110 — `--background` set twice in one rule; the first never applies — delete.
- src/app/globals.css:687 — `.lead-crown` is dead (no element has the class; the crown was removed per the working log) — delete with its stale comment.
- src/app/globals.css:96/118/189/219/257 (+ :59/:227) — `--sb-logo-*` and `--brand-deep` (+ bridges) have no consumer — remove, or keep as a palette record.
- src/app/globals.css:143/147/358 — `.card` appears unused (everything uses `shadow-card`). (med)
- src/app/(app)/settings/page.tsx:83-146/448 — `ClientsSection`/`TagsSection` only render under `isAdmin &&`, so their `isAdmin` prop and non-admin branches are dead.
- src/app/(app)/settings/page.tsx:1055 — comment about the intake block sits above hiring/leads/pricing — move.
- src/app/(app)/team/page.tsx:9 — two `@/lib/format` imports; reports/page.tsx:17 — a const/type declared inside the import block.
- src/app/(app)/reports/page.tsx:289 — hand-built `d/m` — `formatDayMonth(key)`.
- src/app/(app)/leads/[leadId]/estimates/[estimateId]/page.tsx:386 — another `?? 350`/`?? 18` copy (the DEFAULT_RATE/VAT fold).
- …/estimates/[estimateId]/page.tsx:94 — the `alive` flag guards nothing. (med)
- src/app/(app)/reports/page.tsx:758 — each task tooltip filters all entries during render — collect in the existing memo. (med)
- src/app/(app)/settings/page.tsx:435-648 — `TagRow`/`TaskTypeRow` and their add-forms share one shape. (med)

### src/app/api (38 routes) — verified
**Auth audit:** every route checks its caller (session + role, owner, token or secret) before any service-role read or write; none missing, none late. Token routes use timing-safe compares; `/api/log/[token]` selects rate columns by name.
**Safe simplifications**
- src/app/api/avatar/route.ts — simplification — the whole route is dead (no caller; `member-image` replaced it) — delete.
- src/app/api/log/[token]/route.ts:200 — `filter(status !== "rejected")` after a query that already excludes them.
- src/app/api/admin/freelancers/route.ts:214/240 (`?? []` on an array), :246/252 (same filter twice), :290/301 (`summary(people[0])` built twice).
- src/app/api/admin/freelancers/route.ts:155, log/[token]/route.ts:59, leads/digest/route.ts:42 — reuse — hand-rolled Israel-time `en-CA` formatter — `studioToday()`.
- src/app/api/admin/freelancers/route.ts:227, log/[token]/route.ts:245 — standards (rule 2) — `created_at.slice(0,10)` = UTC date — `studioDate()`. (med)
- src/app/api/leads/offer-alert/route.ts:3 — altitude — imports `service` through `@/lib/gmail/sync` — from `@/lib/supabase/service`.
- src/app/api/candidate-file/route.ts:43, lead-file/route.ts:46 — identical `safePath()` — one copy. (med)

### src/app public token pages + auth (19 files) — verified
**Safe simplifications**
- src/app/report/[token]/public-report-view.tsx:5/7 — two imports from `@/lib/format` — merge.
- src/app/report/[token]/public-report-view.tsx:21 — reuse — `dm` = `formatDayMonth` + `.slice(0,10)` (add the slice to `formatDayMonth`; the lib report item).
- src/app/gantt/[token]/public-gantt-view.tsx:288 — efficiency — `all` is a new array each render and a dep of the `chartWindow` memo, so it recomputes on every mousemove — `useMemo`.
- src/app/gantt/[token]/public-gantt-view.tsx:1116 — `Tip` re-parses dates `rows` already resolved. (med)
- src/app/log/[token]/log-view.tsx:84-95 — reuse — `money/hrs/dayLabel/MONTHS/monthLabel/shift/short` are byte-identical to `(app)/freelancers/shared.tsx` — one `src/lib/freelancer-format.ts`.
- src/app/estimate/[token]/public-estimate-view.tsx:26 — reuse — local `Range` restates lib/leads/estimate.ts's.
- src/app/intake/[token]/page.tsx:1068 — a doc comment repeated word for word at :1073; :1128 belongs to `checkStep` (:1205); :1493 a no-op `setValues((p) => ({ ...p }))`; :918/:1282 and :432/:950 repeated predicates; :1221 `go` only calls `setStep`.
- Checked: no token/auth page is prerendered (prerender manifest lists only /_global-error, /favicon.ico) — no CSP-nonce risk.

