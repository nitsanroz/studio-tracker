# simplify-repo report — src/components (report-only, 2026-11-08)

Scope: 106 files in `src/components` (~31.5k lines), 16 batches, five read-only reviewers; **every finding
below was checked against the code by hand** (line numbers as of commit 41a3d8a/2fc19be). Nothing in `src/`
was changed. Components have no unit tests, so anything applied from here needs a browser check.
Format: `file:line — lens — what — fix`.

## Bugs noticed
Ordered roughly by severity — money and lost work first.

- **src/components/dashboard/day-log.tsx:39 — editing an entry on a day older than the store's recent window looks like it did nothing.** `updateTimeEntry` patches only rows already in `timeEntries` (store/time-entries.ts:242); this row comes from the page's own `loaded` snapshot, so the DB updates but the row keeps its old minutes/description, and a description edit gets no undo. Delete already handles it (`setLoaded`) — give the row an `onSaved(patch)` that patches `loaded` the same way.
- src/components/dashboard/celebrations.tsx:165 — the hero's dots use `key={o.at}`; two occasions on one day (holiday + birthday) collide (React warning, a dot can be dropped). The admin list uses `o.at + o.text` — use that.
- src/components/dashboard/studio-pace.tsx:42 — `goalRequest` is cached at module level for the tab's life: one failed/slow fetch caches `null` and the pace banner + goal band stay gone until a full reload; a morning tab also keeps `todayCounted: false` past 17:30. Reset the cache on a null result, or key it by `studioToday()`.
- src/components/client-contacts.tsx:140 — `window.confirm` answers "no" instantly in the desktop pane, so a contact can't be removed there (v1.63.0 convention) — `askConfirm`.
- src/components/client-mark-picker.tsx:41 — `await res.json()` unguarded: a non-JSON reply (413, HTML error) or failed fetch leaves `busy` stuck ("Uploading…" forever) with no error — try/finally + `.json().catch`.
- src/components/client-mark-picker.tsx:53 — `clearUpload` ignores `res.ok` and clears the mark locally even when the DELETE failed — patch only on ok, else show the error.
- src/components/client-notes.tsx:28 — comment promises never to clobber typing, but the effect adopts every `client.notes` change, including a background refresh mid-typing — skip while focused. (med)
- src/components/editable-cell.tsx:309 — the date input saves on every change; Chrome fires as each segment becomes valid, so typing a year can write 0002 → 0020 → 0202 → 2026 (four writes, four undo steps). Not browser-verified. (med)
- src/components/app-shell.tsx:669 — folded-sidebar state read in one effect, written in another; under dev StrictMode the write runs first, so it never survives a reload in dev (prod fine). (med)
- src/components/advice.tsx:117 — every failed `peek` starts its own 60s retry timer, never cleared; outages stack loops and they outlive unmount — one timer in a ref. (med)
- src/components/client-timeline/row.tsx:484 — the left-edge drag chip sits ~half its height too high: Tailwind 4's `-translate-y-1/2` uses the `translate` property and the inline `transform: translate(-100%,-50%)` adds a second −50% — inline `translateX(-100%)`.
- src/components/client-timeline/row.tsx:521/:661 — `ring-2 ring-brand` while dragging never paints: rings are box-shadows and the inline `boxShadow` overrides them (the comment at :553 says exactly this) — add the ring into `barShadow`.
- src/components/client-timeline/headers.tsx:327/:368 — a section's count chip and tooltip "Tasks" use `group.rows.length` = LOOSE rows only, so a section whose tasks are all in groups shows 0, unlike its summary and the Tasks tab — `allRowsOf(group).length`.
- src/components/client-timeline/index.tsx:1191 — help text says "click a dimmed swatch in the legend"; the legend is gone (folded into the Show menu).
- src/components/client-timeline/layers.tsx:26/:276 — `title` tooltips on the today line and weekend/holiday stripes never show (wrappers are `pointer-events-none`). (low)
- src/components/client-timeline/index.tsx:310 — `today` memoized with `[]`: a tab left open past midnight keeps yesterday's today-line and shading. (med)
- **Native `prompt()` is dead in the desktop pane like `confirm()`** (working log): new section/group at client-timeline/index.tsx:1217/1232/1246, client-view/index.tsx:320/326, client-view/row.tsx:608, task-bulk-controls.tsx:50; copy-fallbacks at task-panel.tsx:597, lead-settings.tsx:578, estimate-import-panel.tsx:66 — an `askText()` beside `askConfirm()`.
- **src/components/keys-write-down.tsx:93/:124 — the Keys write-down refuses its own pre-filled value (live client money).** `toggle` pre-fills `formatHoursDecimal(entry.minutes)` (2 decimals), so any entry not a multiple of 3 minutes reads "not a whole number of minutes" (20m → "0.33" → 19.8) and can't be written down whole; float error also refuses exact figures ("4.1" × 60 = 245.99999999999997; "2.05", "8.2", "8.3" too). Fix idea: `m = Math.round(raw * 60)`, refuse only when `|raw*60 − m| > 1e-6`, and keep the entry's exact minutes while the field still holds the pre-fill. Your call.
- **src/components/plan-mobile.tsx:424/432 — the phone's Move sheet makes plan entries vanish.** A waiting-list entry (or "No date" picked) moved to a member column writes `{ date: null, columnId: <member> }`; both plan builds only show null-date rows in the waiting column, and `movePlanEntryToCell` doesn't guard it. Require a day for a member column (default the day on screen) or hide "No date" there.
- src/components/log-time-form.tsx:64 — when `addTimeEntry` fails (null: write error, description refusal) the form still clears and calls `onAdded`; two hosts close the popup on it, so a failed save throws away what was typed — return before clearing when `!entry`.
- hr-details-form.tsx:96, occasions-settings.tsx:72/85/104, picture-editor.tsx:34/47 — fetches with no try/finally: a network failure leaves `busy` stuck (button disabled until reload) + an unhandled rejection; occasions keeps the optimistic toggle after a failure.
- share-gantt-button.tsx:56 — `clipboard.writeText` unhandled; on the late-fetch path Safari rejects it (as the file's own comment predicts) and the click does nothing — catch + fallback. (med)
- src/lib/leads/data.ts:586 — `loadMailSettings` ignores `error`, so a failed read shows "every admin ticked" as if saved. (med)
- src/components/task-panel.tsx:857 — the phone "Talk · N" tab counts every comment loaded this session (`comments.length`), not this task's — `taskComments.length`.
- src/components/user-day-details.tsx:151 — a deleted (or reassigned, or written-down-to-0) entry stays in the day popup and its total; `fetched.rows` is never refreshed (the working log already notes the flaw) — use `useDayEntries` + `reload()` like logged-day's hosts.
- src/components/task-panel.tsx:318 — attachment delete removes the file locally, then fires DELETE without checking `res.ok`; a failure shows it gone while it still exists. (med)
- src/components/whats-new-modal.tsx:124/147 — bare `localStorage` get/set inside an effect; blocked storage throws and the app has no error boundary — try/catch like resizable.tsx. (med)
- **Native `confirm()`**: weekly-plan.tsx:315 ("Delete column") and time-entry-modal.tsx:154 ("Delete time entry") do nothing in the desktop pane — `askConfirm`.

## Behaviour-changing ideas

- day-log.tsx:224, estimate-overview.tsx:80/:148 — plain `<p>` empty states; convention is `EmptyState compact`.
- library-settings.tsx:86 — returns `null` while loading (Pricing popup opens blank) — `SkeletonRows`.
- estimate-overview.tsx:144 — "Edit on the lead →" text arrow; convention is `StudioArrow`.
- library-settings.tsx:30 — `Num` ≈ `NumField step={0.5}` minus Enter-to-commit (switching adds it).
- estimate-import-panel.tsx:66 — clipboard fallback uses `window.prompt` (dead in the preview pane) — a selectable textarea.
- member.tsx:69 — filters+sorts all `planEntries` per day card per render — group once in a `useMemo`.
- celebrations.tsx:68-122 — untested occasion logic (year roll, year count, wording; already had a sort bug) inside a component — move to `lib/occasions.ts` taking `now`, with a test.
- brief-modal.tsx:99 "Loading the brief…", cell-inspector.tsx:154 "Loading the log…" — loading convention says Skeleton/LoadingLine.
- client-report-buttons.tsx — hand-rolled toast (moot if deleted).
- client-contacts.tsx:99, app-shell.tsx:1045 — text arrows "→" — `StudioArrow`.
- client-contacts.tsx:162, client-mobile.tsx:119/371 — hand-styled empty `<p>`s — `EmptyState`.
- client-contacts.tsx:96, client-notes.tsx:35/54 — card titles `text-sm font-semibold` — `.card-title`.
- client-contacts.tsx:62 — initial load has no catch; a rejected `leadForClient` means the card silently never renders.
- candidate-settings.tsx:84/273 — the "press remove again" mark is never reset, so a role warned about earlier is removed later with one press — reset it, or `askConfirm`.
- client-timeline/index.tsx:873 — empty chart is a hand-rolled box, not `EmptyState`, and still says "No open tasks with a due date yet" when the type filter hid everything.
- client-timeline/cells.tsx:217/336 — Dates/Assignee popovers are fixed + flipped but not portalled (works only while no ancestor transforms).
- section.tsx:392 vs headers.tsx:457 — the same rollup dates print "18/8 – 24/8" on Tasks and "18 – 24 Aug" on Timeline.
- hr-details-form.tsx:111 "Loading your details…" → Skeleton; overview-files.tsx:86 blank while loading → SkeletonRows; egress-banner.tsx:162 text arrow → `StudioArrow`.
- **report-table.tsx:949 (client-facing)** — a task row prints `${estimateHours}h` unrounded while section/total rows use `fmtEst` (one decimal): 2.25h in the row, 2.3h in the subtotal. Pick one.
- lead-settings.tsx:333 inline Gmail-disconnect fetch, new-leads.tsx:40/63 Supabase reads/writes from a component — move into src/lib/leads.
- task-panel.tsx:403, weekly-plan.tsx:236/374 — hand-rolled overlays (no Escape/focus/stack) where `Modal` was built to replace exactly that.
- task-panel.tsx:424 — Move-entries finds the Keys task by `/keys/i.test(title)` — use `client.keysTaskId` (CLAUDE.md: chosen, never matched by name; client-reports/page.tsx:169 does the same).
- task-panel.tsx:349 — removing an attachment is irreversible (no undo path) and unconfirmed — `askConfirm`.
- task-panel.tsx:1405 — a leftover "Current tag:" footer repeats the status shown twice above.
- user-day-details.tsx:19 — offers editing on legacy rows that `TimeEntryModal` gates with `canEditEntry` (and trigger 0038 refuses for members).
- time-entry-modal.tsx:68 (Supabase `freelancer_logs` from a component), task-panel.tsx:243 (storage upload protocol in a component) — move to src/lib.

## Docs vs code disagreements

- **CLAUDE.md gotcha "per-person and time-series figures must not leak backfill" (v0.99.29) vs the dashboard:** four places read `entrySumsAll` on purpose, each with a why-comment — team-strip.tsx:22 (per-person cards), tiles.tsx:115 (Avg / designer), shared.ts:47 (admin hours-over-time series, also feeds pace-chart), graphs.tsx:243 (client trend). Either the gotcha needs a "studio-wide admin views are exempt" clause, or the code is wrong. Your call.
- celebrations.tsx:5 — header says the admin pane "looks 30 days ahead"; :30/:190 say v0.99.37 removed that horizon.
- dashboard/index.tsx:269-277, :321 — describe the old 12-column grid / `lg:col-span-2`; replaced by the `@container` block (`@min-[720px]:col-span-2`).
- team-strip.tsx:101 — two stacked comments contradict each other (half-width vs full-page width); the first is stale.
- shared.ts:37 — "the by-client donut"; it's bars now.
- member.tsx:159 — "then 3 KPI tiles"; there are four.
- app-shell.tsx:87 — says Candidates is `mobile: false` + a desktop-only entry; code is `mobile: true`, no entry (code right per v1.55.0).
- desktop-only.tsx:27 — "Longest prefix wins", but it uses `find` (first match); no overlap today.
- client-mobile.tsx:24 — "desktop-only.tsx still covers those" (Timeline/Board) — it doesn't.
- editable-cell.tsx:180 — says the date editor closes on a committed change; `onChange` saves without closing.
- app-shell.tsx:681 — explains JS desktop-only by "the client one mounts a Gantt", but /clients left desktop-only in v1.14.0.
- client-timeline/headers.tsx:495 — says the group bar is `pointer-events-none`; it takes mouseenter/leave.
- client-timeline/layers.tsx:6/:43 — say the milestone line is under the bars (z-0); it's z-20, above.
- client-timeline/index.tsx:114/245/854, client-view/index.tsx:542/595 — still describe a portalled "legend"; only the Columns menu is portalled.
- client-timeline/index.tsx:76/859 — the how-to (i) "beside the client name" — moved onto the Timeline tab.
- client-view/toolbar.tsx:78 — quotes `z-10`/`z-20`; the z-scale table says `z-[25]`/`z-[22]` now.
- client-view/index.tsx:663 — says the task block stays mounted; the table unmounts on the Board tab.
- client-view/shared.ts:203 — "The two tabs that list tasks" above a three-member type.
- report-table.tsx:1137 — `ViewToggle` lives here "so ui.tsx (which imports the store) stays out of the public report's bundle", but report-table imports `ContextMenu` from ui.tsx, so the store IS in /report/[token]'s bundle. Moving `ContextMenu` to its own file makes the comment true.
- report-table.tsx:107 ("edit column dates") vs :73 (no longer editable); :779 "Say so on the face of it" — nothing is printed any more.
- member-photo.tsx:94, use-member-portraits.ts:16, avatar-variant.ts:11 — say the fallback is the neutral cut-out; `DEFAULT_PORTRAIT = "man"` (Nitsan, 2026-08-24).
- logged-day.tsx:21 "most recent 400 rows" (store holds 1000); logged-day.tsx:22 + member-week-hours.tsx:52 "cold tier, ten minutes behind" (every tick now).
- overview-files.tsx:122 — "up to 25MB each" for both hosts; lead files allow 30MB.
- plan-entry-modal.tsx:10 — "one set of colours", but `ABSENCE_CHOICES` restates `ABSENCE_FILL` (day_off gray-600 vs -500).
- notifications-bell.tsx:10 + CLAUDE.md "Key components" — the bell also shows vacation requests.
- weekly-plan.tsx:772 — describes `border-collapse` + box-shadow edges; the table is `border-separate` and the next block says the opposite.
- ui.tsx:188 — "The nudge matches the button's bottom padding", but no nudge class is applied.

## Skipped (and why)
- Component test file `advice.test.ts` — clean.
- Visual-convention misses (Loading lines, text arrows, hand-styled empty states, card titles) are listed as
  behaviour-changing: they change the rendered look, however slightly.

## Cross-cutting suggestions

- `QUIET` inline-field class defined 4× (leads/estimate-fields.tsx:6 exported, library-settings.tsx:27, app/leads/[leadId]/page.tsx:130, client-contacts.tsx:22 +`min-w-0`) — import the exported one.
- Outside-pointerdown + Escape + resize/scroll close effect for anchored popovers hand-written in ~8 files (icon-select, stage-look-picker, show-menu, editable-cell, task-panel, client-view/toolbar, client-timeline/columns-menu, leads page) — a `useDismiss(open, refs, close)` hook.
- library-settings.tsx:102/:107 restate the 350/18 rate+VAT defaults (with the lib report's `DEFAULT_RATE`/`DEFAULT_VAT`).
- settings-popup.tsx:18 `TAB_KEY` must match settings/page.tsx:740 by hand — a lib constant.
- studio-pace.tsx:19-33 hand-writes the `/api/hours-goal` response type — export one from lib/hours-goal.ts for route + client.
- Sign-out written twice from UI (account-inactive.tsx:23 with router.push, app-shell.tsx:405 with location.href) — one `signOut()` in src/lib.
- The Supabase usage URL hard-coded twice (app-shell.tsx:1040, egress-banner.tsx:157) — one constant.
- Section header vs group header (client-view/section.tsx:102 vs groups.tsx:72): same drop + reorder props with section/group swapped; the grip span copied 3×, select-all 2× — `useContainerDrag` + `<GripGutter>` (~80 lines).
- Hidden-columns localStorage block duplicated (client-timeline/index.tsx:181, client-view/index.tsx:180; `setItem` unguarded in both) — fold into the shared ColumnsMenu owner.
- `SortHeader` duplicated (app/(app)/clients/page.tsx:28, client-view/sort.tsx:87) — one component.
- **No in-app text prompt exists**: seven native `prompt()` calls create sections/groups (dead in the desktop pane like `confirm()`), plus four copy-link fallbacks — an `askText()` beside `askConfirm()` fixes all of them.
- `initials()` twice (member-photo.tsx:54 trims, ui.tsx:509 doesn't). (2 sites, optional)
- Long month names: weekly-plan.tsx:767, vacation.tsx:61, dashboard/studio-pace.tsx:35, plus the lib copies — one `MONTH_NAMES_LONG`.

## Findings by batch (safe simplifications)

### src/components#1–#3 (24 files) — verified
**Safe simplifications**
- src/components/client-report-buttons.tsx:9 — simplification — `ClientReportButtons` is dead (nothing imports it; grep src/scripts/docs) and is the only caller of `ensureClientReportLink`, so `src/lib/report-links.ts` dies with it (gantt-links.ts:7 only names it in a comment) — delete both, reword that comment.
- src/components/charts.tsx:311 — altitude — `MultiLineChart` doc stranded above `smoothPath`'s — move to :337.
- src/components/about-modal.tsx:715/724 — simplification — `Math.round(claudeHours / wallClockHours * 100)` twice — one const.
- src/components/about-modal.tsx:297/323 — standards — `let offset` mutated inside `models.map` during render (a lint warning) — precompute offsets with a reduce. (med)
- src/components/cell-inspector.tsx:96 — simplification — `profiles.find(...)` twice per person — once.
- src/components/app-shell.tsx:139… — reuse — the active-item style object written 7×, the active-route test 3× (:830's `/` branch can't fire) — `ACTIVE_STYLE` + `isActive(href, pathname)`.
- src/components/app-shell.tsx:813… — simplification — `pendingIntake + updatedIntake` summed 4× — one const.
- src/components/app-shell.tsx:53 — altitude — comment fragment above `DRAWER_MS` belongs to `NAV`.
- src/components/candidate-settings.tsx:229/320/438 — reuse — three identical "+ Add" submit buttons — a local `AddButton`. (med)
- Pre-flagged about-modal.tsx:809 `daysBetween` copy: exact (yyyy-mm-dd parse as UTC), still ms maths — fold into period-math once gantt/period-math share one.
- Checked: &advice is mounted only for owner && !viewingAs, the API 403s others, imports from run/merge/signals are type-only, no amounts rendered.

### src/components#4–#7 (32 files) — verified
**Safe simplifications**
- global-search.tsx:41, mobile-log-time.tsx:67, task-autocomplete.tsx:204 — reuse — the same "narrow client chips by typed name, else all" memo 3× (mobile's comment says "exactly as the desktop pickers do") — one `useClientChips` / `narrowClientChips` beside `namesClient`.
- member-photo.tsx:14 — simplification — `DEFAULT_TEAM_PHOTO` unused (grep src+scripts) — delete.
- primitives.tsx:126 — simplification — `Card`/`CARD_PAD` imported nowhere — delete, or keep deliberately as the adoption target. (med)
- period-stepper.tsx:35 — simplification — no caller passes `right`; its doc example is false — drop the prop.
- notifications-bell.tsx:20/147 — simplification — every item is `tone: "brand"`; the danger branch never runs. (med)
- plan-mobile.tsx:112 — standards (rule 2) — `formatDayLabel(new Date(iso))` parses UTC — `parseISO(iso)`.
- src/lib/use-member-portraits.ts:4 — altitude — confirmed: the API only returns `AvatarVariant`; type the map as `Record<string, AvatarVariant>` and the inverted import from the component goes away.
- report-table.tsx:40 — altitude — `estimatePct`/`estimateTone` are pure logic tested by `src/lib/estimate-pct.test.ts`, which imports a component — move to `src/lib/estimate-pct.ts`, re-export.
- keys-write-down.tsx:73 vs :283 — reuse — the keys-task resolve + the hours→minutes check are written twice in the file whose header says "ONE IMPLEMENTATION"; extract one pure `parseWriteDown` in src/lib with a test (identical copy first; the fix is in Bugs). Live client money.
- Stranded comments: picture-editor.tsx:11 (PictureEditor doc above `usePicture`), plan-entry-modal.tsx:48 ("dev-item status" — that's weekly-plan's `DEV_STATUS`), report-table.tsx:121 (removed prop), report-table.tsx:1089 (sits on `ContextMenu`).
- Pre-flagged egress-banner.tsx:71/105 — only the per-day dismissal key, same UTC date on read and write: "hide for today" rolls over at 02:00/03:00 instead of midnight. Harmless; `studioToday()` if wanted.

### src/components#8–#9 (12 files) — verified
**Safe simplifications**
- task-list-row.tsx:194 — reuse — `formatDueShort` is byte-identical to the already-imported `formatDayMonth` — delete, pass `formatDayMonth`.
- task-autocomplete.tsx:47 — reuse — inline task→client map — `buildTaskClientMap`; safe here (read only through `if (cid)`).
- task-autocomplete.tsx:208 — reuse — restates `namesClient`, whose doc promises "the same test that put the chip on screen".
- time-entry-modal.tsx:215 — simplification — repeats `owner` from :62.
- week-timesheet.tsx:134 — reuse — `new Date(iso + "T00:00:00")` is `parseISO`.
- weekly-plan.tsx:767 — reuse — long month names (also vacation.tsx:61) — add `MONTH_NAMES_LONG` to format.ts.
- user-day-details.tsx:165/153 — simplification — needless fragment; recomputes `ready`.
- ui.tsx:682 — simplification — `BudgetBar label="none"` never passed — drop the branches.
- ui.tsx:78 `TabItem`, task-panel.tsx:45 `TASK_PARAM`, vacation.tsx:52 `VacationStatusPill` — exported but file-local. (med)
- task-panel.tsx:1011 — the Billable chip's class ternary twice — one const; :1201/:1417 the selected-minutes sum twice. (med)
- vacation.tsx:223 — the error line gates on comparing `problem` to literal sentences; editing copy silently breaks it — track a kind. (med)
- week-timesheet.tsx:104, weekly-plan.tsx:96 — efficiency — `tasks.find`/`clients.find` per entry per cell/chip each render — memoised id maps. (med)
- Stranded comments: task-list-row.tsx:237 (belongs to `MobileTaskCards` :279), weekly-plan.tsx:232 (orphaned divider), weekly-plan.tsx:1397 (cut off from its code at :1431).

### src/components/client-timeline + client-view (18 files) — verified
**Safe simplifications**
- src/components/client-view/index.tsx:29 — simplification — empty `import {} from "../editable-cell"` — delete.
- src/components/client-view/stats.tsx:12 — reuse — `MONTH_SHORT` = `MONTH_NAMES_SHORT`, export unused elsewhere — import it.
- src/components/client-view/stats.tsx:21/119 — simplification — `inTab` prop always passed by the only caller — drop the prop and the dead branch.
- src/components/client-view/selection.tsx:84 — efficiency — `tasks.filter(t => ids.includes(t.id))` over every studio task per render — a `Set`.
- src/components/client-timeline/index.tsx:1068/1073, 1103/1106 — efficiency — `rollupOf(...)` computed twice per header per render — once.
- src/components/client-view/stats.tsx:26 — efficiency — four passes over all tasks — one. (med)
- src/components/client-view/index.tsx:246, 366/794/808 — efficiency — per-section filters over all/client tasks repeated — bucket by sectionId once. (med)
- src/components/client-view/index.tsx:663 — efficiency — the hidden Board renders on Timeline/Overview tabs — render it only on its tab. (med)
- src/components/client-timeline/columns-menu.tsx vs client-view/toolbar.tsx:18 — reuse — `TimelineColumnsMenu` and `ColumnsMenu` line-for-line (its own comment says identical) — one generic menu. (med)
- src/components/client-view/index.tsx:714 — reuse — restates `useNameCell`'s width rule — a pure `nameWidth()` in shared.ts. (med)
- Stranded/stacked comments: client-timeline/shared.ts:119 (belongs to `GROUP_LAYER_COLORS` :145), client-timeline/index.tsx:87 (constants moved to shared.ts), :699 (two docblocks on `dropRow`, first superseded — merge, keep the reason).
- Exported but file-local: `TOOLTIP_W`, `TOOLTIP_H`, `TIP_TINT`, `cmpNullable`, `SORT_HINTS`; sort.tsx:108's fallback can't fire.

### src/components/dashboard + leads (20 files) — verified
**Safe simplifications**
- src/components/dashboard/index.tsx:29 — simplification — empty `import {} from "@/lib/hours-split"` left from a refactor — delete.
- src/components/dashboard/graphs.tsx:245-257 — reuse — `StudioClientTrend` re-implements `useHoursScope(filter, true)` (entrySumsAll + range/client/billable filter + the two maps) — call the hook.
- src/components/dashboard/celebrations.tsx:104 — standards (rule 1) — `Math.round(delta / 86400000)` between two local midnights; rounding absorbs DST so no live bug — period-math `daysBetween(today, next)` gives the same output.
- src/components/dashboard/celebrations.tsx:111, pace-chart.tsx:174/:192, member.tsx:239 — reuse — hand-built `${d.getDate()}/${d.getMonth()+1}` (+ `DAY_NAMES`) labels — format.ts `formatDayLabel(d)`.
- src/components/dashboard/studio-pace.tsx:36 — reuse — `SHORT` restates `MONTH_NAMES_SHORT`; `MONTHS` (long) joins the month-names fold. (`dayLabel` is month-first "Nov 8", so `shortDate` is not a drop-in.)
- src/components/dashboard/day-log.tsx:175 — reuse — inline split + `new Date(y, m-1, d)` is `parseISO`.
- src/components/dashboard/shared.ts:94 — standards (rule 2) — `new Date(startIso)` parses yyyy-mm-dd as UTC; right only east of UTC — `parseISO`. (med)
- src/components/dashboard/tiles.tsx:238 — altitude — stray StatTiles doc stacked on `UpdatedBriefsAlert`; move to :83 (and it says "active tasks", the tile is "Tasks worked").
- src/components/leads/library-settings.tsx:27 — reuse — `QUIET` copies estimate-fields' exported one (minus a disabled-hover class no field here needs). (med)
- src/components/leads/library-settings.tsx:62 — simplification — mount effect copies `reload` minus its alive guard — one loader. (med)
- Unused exports (grep -w src+scripts): `DayLogRow`, `HoursByClientBars`, `StudioClientTrend`, `ApiOccasion`, `relativeDays`, `MEMBER_OCCASION_DAYS`, `Level`, `Goal`, `IconOption` — drop `export` (low value).

