# Finance — the reference page

> **This is finance-admin's `CLAUDE.md` as it stood at its last release
> (v1.33.0, commit `50afd33`), kept whole.** Finance was a separate app from
> 2026-07-13 until the merge of November 2026; it is now the `/finance` area of
> the tracker. The rules below are still the rules. The ADDRESSES have moved,
> and a few sections describe things that no longer exist — read it through
> this table:
>
> | Written here | Now |
> | --- | --- |
> | `src/lib/<x>` | `src/lib/finance/<x>` — except the rules both apps shared, which have one copy in `src/lib/`: `hours-goal.ts`, `hours-goal-server.ts`, `freelance-rate.ts`, `payment-terms.ts`, `finance-paid.ts` |
> | `src/components/<x>` | `src/components/finance/<x>` |
> | pages `/plan`, `/expenses`, … | `/finance/plan`, `/finance/expenses`, … (`src/app/(app)/finance/`) |
> | `/api/mail/*`, `/api/scenarios/*` | `/api/finance/mail/*`, `/api/finance/scenarios/*` |
> | `reference/00NN_*.sql` | `supabase/finance-reference/finance-00NN_*.sql` — already run, never re-run |
> | "no migrations folder; schema by hand" | ordinary tracker migrations, numbered from 0068 |
> | **Stack & running**, **Deploy**, **Verify before done** | the tracker's own (`CLAUDE.md`): one dev server (`studio-tracker`, port 3000), one deploy, one version |
> | **Access** — `finance-access.ts`, `proxy.ts`, `EXPENSES_APIS` | `src/lib/access.ts` (four tiers) + the server layouts under `(app)/finance/`; there is no proxy gate. `adminClient()` in `finance/actions.ts` still guards every server action |
> | **&advice** — "the tracker's is the model", its own pane, store and peek | ONE engine: `src/lib/advice/run.ts`, one pane, one store. The money RULES described here (`signals.ts`, `tax.ts`, `tools.ts`, `review.ts`, `redact.ts`, the mail scan) are unchanged in `src/lib/finance/advice/` |
> | **Hours goal** — "mirrored in studio-tracker, change BOTH repos" | one copy, `src/lib/hours-goal.ts` |
> | **Big brother: studio-tracker** | the same repository |
> | `HANDOFF.md`, `FINANCE_ROADMAP.md`, `people-hr-*.sql`, `tracker-history-*.sql` | left in the archived finance-admin folder; not brought over |

---

# Finance Admin — Studio&more

Owner-only finance product for the Studio&more design studio: P&L, plan vs.
actuals, salaries, freelance, expenses, people cost, client rates. Split out of
studio-tracker on 2026-07-13 (see `HANDOFF.md` for why). **Owner:** Nitsan
(nitsan@studionmore.com). UI is English; Nitsan often writes in Hebrew.

**Keep this file short.** It holds what a new session needs to work safely —
not a changelog. History lives in git commit messages (they are detailed; read
`git log` for "what's in flight"). Update a section here only when a fact in it
changes.

## Big brother: studio-tracker
`~/Documents/Claude/studio-tracker` is the parent app this grew out of — same
stack, same Supabase project, same brand (Saans, Studio Black `#06112f`, blue
`#0b43ed`, `public/brand/` logos), same app-shell/sidebar pattern. Changes to
shared things (logo, shell, formatting) are often made in one and mirrored in
the other. When unsure how something is done here, check how the tracker does
it — its `CLAUDE.md` holds many hard-won gotchas (deploys, preview pane, brand,
PII). Its data is the source of live hours; this app only reads it.

## Stack & running
- **Next.js 16** (App Router) · React 19 · Tailwind v4 · Supabase · Vercel. No
  chart library — charts are custom SVG (`src/components/finance-charts.tsx`).
- ⚠️ **This Next.js differs from training data.** Read the relevant guide in
  `node_modules/next/dist/docs/` before writing Next-specific code. Request
  hooks live in **`src/proxy.ts`** (the renamed `middleware.ts`).
- **Node 24** at `~/.local/node/node-v24.18.0-darwin-arm64/bin` (system Node is
  older). `dev` and `test` scripts prepend it; for `build`/other tools prepend
  it yourself.
- Dev server: `preview_start` with name **`finance-admin`** (port 3210, from
  `.claude/launch.json`).
- Credentials: `.env.local` (Supabase URL / anon / service-role keys).

## Verify before done
- `npx tsc --noEmit` · `npx eslint src` · `npm test` (Vitest, `src/lib/*.test.ts`)
  · `npm run build` for anything structural.
- UI changes: check in the preview, including phone width (one breakpoint; see
  `src/lib/use-phone.ts`).

## Deploy
- Remote `git@github.com:nitsanroz/finance-admin.git`, branch `main`.
- ⚠️ **Pushing to `main` auto-deploys to production on Vercel** (project
  `finance-admin`). A push is a release — don't push unless Nitsan asked.
- Commits must be authored as `nitsan@studionmore.com` (Vercel rejects
  unverified author emails); this repo's git config already sets it.
- **Every publish bumps `APP_VERSION`** in `src/lib/version.ts` (patch for a
  fix or UI tweak, minor for a feature). It shows in the sidebar footer and on
  the login page, so anyone can see which build is live.
- **A push is not a deploy until Vercel says so.** After pushing, check
  `vercel ls finance-admin` (Node 24 PATH; the CLI is logged in) until the new
  deployment is `Ready`, then confirm production serves the new version.
  `git_info_fail` (seen 2026-10-12: build 0ms, no logs) is Vercel failing to
  fetch the commit from GitHub, not a code error — the next push, or
  `vercel --prod`, retries it.
- Functions are pinned to **`fra1`** (`vercel.json`), next to Supabase
  (eu-central-1, Frankfurt). Vercel's default is iad1 (Washington), which made
  every query cross the Atlantic. Same in the tracker.

## Data (shared Supabase with studio-tracker)
- Finance tables: `finance_pnl_monthly` (the P&L, one row per year/month/line
  item), `finance_client_monthly`, `client_rates`, `fx_rates`,
  `finance_events`, `finance_expenses`, `finance_salaries`, `finance_freelance`,
  `finance_income`, `finance_locks`, `finance_payslips` (0008; `sick_used` 0009),
  `finance_person_factors` (0009: the owner's "Beyond the hours" levels per
  person, written from the person page), `finance_not_hourly` (0013: clients
  the new-client prompt shouldn't ask a rate for). RLS: full finance
  (`is_finance_full_access()`, tightened by hand) except what the Expenses page
  uses — `reference/0014` checks it live (run 2026-10-31: `finance_undo_log`
  was the one table left on bare `is_admin()`, now fixed).
- `finance_freelance.paid_at` / `finance_salaries.paid_at` (reference/0011,
  applied 2026-10-25): paid is the step AFTER `final` — Draft → Predicted →
  Final → Paid (paid = final + paid_at; earlier steps clear it). Green = final,
  dark green amount with a ✓ = paid; set from the card beside a selected cell,
  or a whole month at once from its column header (✓✓).
  Written through `db.ts writeStep` (the guard-trigger workaround) by every
  step card; reopening a month clears paid with final.
- `finance_client_monthly.paid_at` / `finance_income.paid_at` (reference/0012,
  applied 2026-10-25): the same Paid step on the Plan,
  meaning the client paid us. **The Plan is finance's word on "client paid"**
  (2026-10-31): &advice's unpaid-period card goes quiet once the Plan marks
  every month of the period paid, whatever the tracker's billing-period tick
  says. The Plan's "Owed to the studio" list (`lib/receivables.ts`) is every
  final, unpaid income month, with VAT and days late.
- `invoiced_at` on the same two tables (reference/0013, applied 2026-10-31): Invoiced between Final and Paid, Plan only (↗
  mark). The Plan loads without it (`db.ts fetchAllOptional`) and hides the step.
- `finance_salaries.gross_amount` is the **employer cost**, not the gross
  salary. Gross salary, job share and vacation/sick balances come from the
  payslips (`finance_payslips`).
- Live-year hours are **suggested** by the tracker's `time_entries` → `tasks` →
  `clients` (billable task of a billable client) through "Sync tracker hours";
  ⚠️ **the Plan's rows are what count** (Nitsan, 2026-11-10): the P&L recompute
  takes hours and hourly income from `finance_client_monthly`
  (`plan-model.ts planHoursCells`, priced exactly as the Plan's rollup), not
  from the tracker's log — what you kept or typed on the Plan is the figure.
  Clients match rates by **name** (`client_canon`). Never write tracker tables
  from here.
- **Spreading an expense over months has ONE rule** (Nitsan, 2026-11-10:
  "Expenses follows the P&L"): `finance.ts expenseShares` — yearly renewals
  across year ends (their end date doesn't cut it), monthly rows to their end
  date, the rest once. The P&L and the Expenses page both use it.
- **Gmail: finance never revokes at Google.** It signs in with the tracker's
  OAuth client, and a revoke drops the user's whole grant — the tracker's own
  connection included. Disconnect deletes finance's stored key only.
- **Schema changes are applied by hand in the Supabase SQL editor.** This repo
  has no migrations folder; `reference/0005–0007*.sql` document the original
  schema (already applied — never re-run). Later columns
  (`finance_full_access`, `filed_at`, …) were added by hand. Write any new
  migration as a numbered SQL file and give it to Nitsan to run.
- `src/lib/db.ts`: `fetchAll()` (pages past Supabase's 1000-row cap) and the
  snake_case → calc-type mappers. Type rows explicitly; no `any`.

## Business rules (encoded in `src/lib/finance.ts` — keep them true everywhere)
- VAT 17% through 2024, **18% from 2025** (`vatRate`).
- Row states: draft (`actual` in the DB) → `predicted` (a considered estimate)
  → `final` (locked). **All three count in every total** — state is a workflow
  signal, not a filter. What's left out is by month: `isForecastMonth` (this
  month on, and any later year) is the one definition of "still a plan";
  `sumLine` leaves those months out of the current year's totals only.
- Unfinished months are **estimated**; never compare a partial year's raw total
  to a full year — annualize and label it.
- Rates are effective-dated; revenue = Σ(hours × rate). `average_taarif` is
  **derived** (revenue ÷ hours), never an input.
- FX: `fx_rates` stores the **official** Bank of Israel rate; conversion adds
  `FX_MARKUP` (5%) for what the bank/card charges (`src/lib/fx.ts`).
- Yearly renewals are spread across the months they cover (up to 3 years).
- **Closed years are kept as booked** — the recompute never touches a past year.

## The P&L recompute (most dangerous code — read before changing)
`runRollup` in `src/lib/actions.ts`, triggered by `src/lib/auto-rollup.ts`
(on opening Overview/Plan, and debounced after any save that feeds the P&L).
Guards that must survive any rewrite:
1. Only months that **have** granular data are written — an empty month must
   not be zeroed (this once wiped imported Jan–Jun 2026).
2. Never overwrite a row with `source='import'` AND `state='final'`. Locked
   rows are still compared; a difference is returned as a `LockedGap` for the
   owner to accept, never written silently.
3. Totals sum the same lines the Plan grid sums (`EXPENSE_LINES`), including
   P&L-only lines like Accounting/Gur.
- The `finance_guard_locked()` trigger blocks updates that keep a row `final`.
  Editing a locked row = drop to `actual`, write, restore `final`
  (`updatePreservingLock` in `db.ts`).
- Known gap: the recompute is a client-driven upsert, not an atomic
  server-side RPC.

## Salary docs (payslips, employer-cost reports)
The Michpal PDFs live in the studio's Salaries folder on Google Drive, synced
to Nitsan's Mac by Insync (`~/Insync/…/Logistical&more/Salaries`). They are
read **on the Mac only** — never uploaded; only figures are stored.
- `npm run payslips` (`scripts/import-payslips.mjs`, parser `lib/payslip.ts`):
  `Employees - <year>/<Person>/…` and `Past Years/<year>/<Person>/…` (2017 on,
  imported 2026-10-14) → `finance_payslips` (salary rate/share/paid, gross,
  vacation + sick accounts). Month and year from the file name (the slip's
  month line prints digits missing). Person folder → profile by `ALIASES`, full
  name, or a first name only one profile has — older years have several Noas
  and Itays, which are reported, never guessed; a Past Years slip is also
  stored only if finance paid that profile that month. Skips files by SHA-256.
- `npm run employer-cost` (`scripts/import-employer-cost.mjs`, parser
  `lib/employer-cost.ts`): `עלות מעביד- תמחיר חודשי/<year>/` → `finance_salaries`
  for months NOT final (replaces plan placeholders; never `final` rows or locked
  months — reports differences). The total column prints only its cents, so the
  total is summed and checked against them. Employee = the payslip whose gross =
  the report's payments. From 2026 on. Nitsan's standing go-ahead (2026-10-13).
- `npm run salary-docs` runs both. A launchd job to run it every 3h was
  blocked by the permission classifier — Nitsan to install if wanted.
- The tracker's vacation feature (its migration 0058) reads `finance_payslips`
  through `my_vacation()` / `vacation_balances()` — vacation lines only.

## Hours goal (Overview)
`hoursGoal` in `src/lib/overview.ts` + `components/hours-goal-card.tsx`: the
month in progress as billable hours a workday — the minimum that covers its
costs, a goal that also leaves `TARGET_MARGIN` profit (not shown as a %), and
the pace so far as a speedometer. Inputs from the tracker via
`getGoalInputs` (actions.ts): designers away in the weekly plan
(`plan_entries` type `absence` in member columns — a day with someone away
weighs less), and freelancers paid by tracker hours. **Freelancers cost ONLY
the hours logged so far this month** (v1.9.0, Nitsan's choice — no projection
over the days left), with their planned amount swapped out, so the goal rises
as they log. Two kinds: a `finance_freelance` row linked by `profile_id`
(priced through `HOURLY_TERMS` if it has them, else their recent ₪/hour), and
**sliding-rate freelancers kept in the tracker** (AB, Milica, Dima — tracker
`freelancers` / `freelancer_logs` / `freelancer_charges`, migrations 0054–0057)
priced through `lib/freelance-rate.ts` (a mirror of the tracker's) plus their
charges, × the month's OFFICIAL `fx_rates` rate — the latest month that HAS a
rate for that currency (Nov 2026 had USD but no EUR, which dropped AB). Hours
are their link logs, or for a tracker LOGIN (Dima) his own time entries. Someone
in `freelancers` is never also costed as a linked finance row (Milica was
counted twice). Plan amounts match by profile, else by name — AB's finance
rows are deliberately NOT linked to his profile. **Pace** (`actualPerDay`)
counts finished days only; today joins at 17:30 Tel Aviv (`studioDayLogged`,
`todayLogged`/`hoursToday` options; `getGoalInputs` returns `hoursToday`).
Rate = last 3 months' hourly income ÷ hours. The **Freelance page** shows each
tracked freelancer's current month in brackets, "(42h · ₪5.9K)", via
`getFreelanceTracked` (actions.ts) and `LockableCell`'s `aside`.
- ⚠️ **Finance data is read-only for Claude** unless Nitsan names a specific change
  (2026-10-13: he allowed replacing one freelancer's Oct 2026 placeholder with
  the forecast — the amounts are left out of this copy). Report gaps, don't fix them.
- ⚠️ **Mirrored in studio-tracker** (`src/lib/hours-goal.ts` + its test, fed by
  `/api/hours-goal`, shown as the "Studio pace" strip on the admin home for
  Nitsan and Michal). A change to how the goal is worked out goes in BOTH
  repos. The tracker's route returns hours only — never ₪ — since Michal has
  no finance access.

## Access (three levels, decided in `src/lib/finance-access.ts` only)
- **Full finance** = tracker `role='admin'` **and** `profiles.finance_full_access`.
- **Expenses-only** = tracker admin without that flag (e.g. Michal) — confined to
  `/expenses` by `proxy.ts`, the nav, and RLS. ⚠️ The proxy redirects their
  `/api/*` calls too — an API route the Expenses page needs for them must be
  in `EXPENSES_APIS` (proxy.ts), or their fetch silently gets HTML.
- Everyone else: no access. Every server action calls `adminClient()`, because
  server actions are callable POST endpoints regardless of which page shows the
  button.

## &advice (v1.6.0) — the owner's advisor pane
The money version of studio-tracker's &advice (its v1.80.0). Nitsan's choices,
2026-10-24: the tracker's Night pane and corner ampersand as they are; real
₪/€ amounts; **owner only** (admin + `position='owner'` + full finance, not
every full-finance user); its **own tables** `finance_advice_items` /
`finance_advice_runs` (reference/0010, applied 2026-10-24) — the tracker's
`advice_items` must never hold an amount.
- `lib/advice/signals.ts` = pure rule checks in four groups: Profit & pace
  (pace vs the hours goal, losing months, year outlook), Clients' money
  (unpaid last period in ₪, hours with no rate, one client over 40% of the last
  90 days' hours, a client under 40% of its 3-month average), Costs (salaries' share, a freelancer over plan + sliding rate, an
  expense line jumping), Close (Monthly invoices not filed, last month not
  `final` or not paid, older months still unpaid, payslips missing, no FX rate). `merge.ts` is a COPY of the
  tracker's (snooze/done/escalation); `context.ts` = Here/Elsewhere per page.
- `run.ts` checks with the owner's own session (RLS), no service key. ⚠️ The
  peek runs the full check too — finance has no cron to write rows, so a peek of
  stored rows found nothing and hid the button.
- **Claude wording WITHOUT amounts** (`word.ts`, `redact.ts`): titles never hold
  an amount, bodies/facts are stripped to "[amount]" before sending, and any
  wording that comes back with an amount is dropped; the card shows the rule's
  exact figure beside it. Runs on the **day's first pane open** (no crons here),
  Opus 5.5, only with `ANTHROPIC_API_KEY` set in this Vercel project.
- **Tools (v1.11.0, Nitsan 2026-11-05):** `lib/advice/tools.ts` links monthly
  and yearly expense rows into one chain per subscription (live, next renewal,
  price change, job via `TOOL_KINDS`). Rules in `signals.ts`: `renewalSoon`
  (≤45 days, ₪200+), `toolOverlap` (two tools for one job, or one for a job done
  in-house — Everhour), `priceUp`, `fxFee`. A yearly with no renewal entered
  45 days past its day has lapsed (`LAPSE_DAYS`, v1.22.1 — Envato); overlap
  cards leave out what won't renew (`renews`). "Review the studio's tools" in the
  pane on Expenses = one Claude call per click (`review.ts`, prompt in
  `review-prompt.ts`, amount-free with cost ranks); its suggestions are items
  with signal `tools` (never resolved by the rules — `NOT_FROM_RULES`), its runs
  logged in `finance_advice_runs` as model `tools-review/…`, which the daily
  wording's "ran today?" check skips.
- **Billing mail (v1.12.0, Nitsan 2026-11-05):** nitsan@, office@ and
  studio@studionmore.com, connected in Settings (`components/mail-settings.tsx`,
  `/api/mail/*`) — finance's OWN connection (`finance_mail_accounts`,
  reference/0015), not the tracker's `gmail_accounts` (one per team member, so
  no shared mailboxes). Same Google OAuth client as the tracker (its redirect
  URIs must include `https://finance.nmore.co/api/mail/callback` and
  `http://localhost:3210/api/mail/callback`); env `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `FINANCE_MAIL_TOKEN_KEY` (32 bytes, base64).
  `gmail.readonly`; reads From, Subject and the preview line — and the full
  text of RECEIPTS only, for their amount (v1.14.0); never stores any text —
  only a receipt's PDF/scan attachment as a document (v1.16.0).
  `lib/mail/scan.ts` runs in the background (below) and from "Scan now"; `lib/mail/classify.ts` (pure, tuned on nitsan@'s real mail)
  matches the sender to an Expenses vendor and sorts it into
  receipt/renewal/price/plan/cancel/failed/trial → `finance_tool_mail`. Rules:
  `mailNotice`, `receiptMismatch`; the tools review gets each vendor's
  `recentMail` (amounts stripped).
- **Scan + one-click fixes (v1.13.0, Nitsan 2026-11-05: "be proactive"):** the
  mail is read in the background from ANY page every 6h (`MAIL_EVERY_MS`; the
  peek returns `mailDue`; `lib/advice/client.ts scanMail` dedupes). A card can
  carry a `Fix` (signals.ts; stored as JSON in `facts.fix`, never sent to
  Claude): `cancelledStill` = a cancel mail (≤400 days) for a tool Expenses
  still renews → remove the unpaid renewal rows / end the row on the mail's
  day. `POST /api/advice/[id]/fix` re-checks it against the DB (same vendor,
  monthly/yearly, never `final`, removals dated after today) and returns the
  rows for the notice's Undo. Billing trouble links to the vendor's billing
  page (`BILLING_URLS`).
- **Price / plan changes (v1.21.0, Nitsan 2026-11-08):** `receiptMismatch` →
  `priceChange` reads the plan-change mail (`planNameOf`) and the first charge
  at the new price, says so, and for a monthly row offers a `Fix.add`: end the
  row the month before, add the new price from that charge (₪ net worked out
  in the fix route). Vendor plans are one family (`sameFamily`: "Claude max" /
  "Claude pro"). An open card puts a red note + its fix on the Expenses row
  (`PriceNote`, read from `finance_advice_items`, owner only).
- **Receipts → expenses (v1.14.0, Nitsan 2026-11-05):** the scan also reads
  receipts (the vendors' ones it sorted, plus a subject search for anyone's,
  last `RECEIPT_DAYS`=120) in full for the amount → `finance_mail_receipts`
  (reference/0016, owner-only; `finance_mail_ignored` = "never suggest this
  site"). `lib/mail/receipts.ts` (pure): amount reading, new-vendor naming,
  `covered` (a running monthly row of the vendor, a payment within 10 days,
  or the same amount within a week) and `suggestions` (category guessed from
  the vendor's own rows). Expenses shows "From your mail"
  (`components/mail-receipts.tsx`, `/api/mail/receipts`) to add, dismiss or
  silence each; &advice's `receiptsWaiting` card points there. Invoicing and
  payment platforms (Green Invoice, PayPal…) are never suggested — the
  sender isn't the vendor. **Noise rules (v1.15.1, Nitsan 2026-11-06)**,
  applied when the list is read (`clearedBecause`, stored rows untouched):
  replies/forwards; the studio's own invoice threads and clients (tracker
  `clients` by site or display name — a known vendor is never a client);
  freelancers (`finance_freelance` names + tracker `freelancers`) → Freelance
  page; Gur (`PLAN_LINE_SITES`, its own Plan line); one copy per receipt across
  mailboxes; "on Expenses" also by vendor family ("Claude pro" ← "Claude
  max") and any of the vendor's payments within 10 days. A new sender is named
  by its company site, not the person who wrote; an approved receipt teaches
  its sender → vendor (`learned`). The list says what it left out.
- **Renewals you can turn off (v1.15.1, Nitsan 2026-11-06):** a monthly or
  yearly row still running (`stillRunning`, expenses page) is editable whatever
  year it was entered in — cycle, end date, everything; closed years' P&L is
  still never recomputed. An end date BEFORE the next payment means it won't
  renew (`chainFrom`; an end ON the renewal day is an imported period end), the
  Yearly tab shows "Ends <day>", and every renewal card offers "Won't renew"
  (`wontRenew` Fix: end the day before, remove a renewal entered for later).
- **Invoice number + paid with (v1.15.1, reference/0018):**
  `finance_expenses.invoice_number` / `paid_with` ("Visa ••3562"), their own
  columns on Monthly/Yearly/Misc/Investments with the invoice file(s) beside
  them (v1.19.0 — `PaperworkCells`; hidden until 0018/0019 are run, loaded
  best-effort). An envelope marks a value still as the receipt email gave it
  (rows a `finance_mail_receipts` row was added as) or a file the mail saved. Read from receipt mail (`receiptDetails`, only those two
  strings kept) into `finance_mail_receipts`, carried onto the row on Add;
  receipts scanned earlier are read once when the list shows them
  (`fillReceiptDetails`, "" = none found).
- **Documents (v1.16.0, reference/0019, Nitsan 2026-11-06 "preview and
  download them"):** private bucket `finance-docs` + `finance_documents`
  (expense_id / receipt_id, path, filename, mime), owner-only via storage
  policies (no service key). The scan saves a receipt's PDF/scan attachments
  (`attachmentsOf` — no logos/signatures, ≤15 MB; `saveReceiptDocs`, once per
  email via `docs_checked_at`; older receipts when the list first shows them);
  Add moves them onto the expense. The browser previews/downloads through
  5-minute signed links and uploads more (`lib/docs-client.ts`,
  `components/doc-list.tsx`) from each row's Invoice column. Google Drive sync:
  not built — Nitsan downloads to Drive for now.
- **Files by month (v1.22.0, Nitsan 2026-11-09):** a receipt a row already
  covers (`coveredBy`: the vendor's monthly row running that day, or its
  payment within 10 days — same name before family) isn't suggested: on the
  owner's list load its files are read and moved onto that row, and the
  receipt becomes `added` to it (`attachCovered`, receipts-data.ts; 20 a
  load; never from a local copy without the mail keys). A Monthly row's file
  icon shows months with an invoice ("3/4") and opens a table by month; a
  file's month = its receipt's day, else `expense/<id>/<YYYY-MM>/…` in its
  path (uploads into a month), else when it was saved. **v1.23.0:** a row's
  receipts also fill its EMPTY fields (`rowFill`, `fillRows`): card, invoice
  number (not on Monthly rows — one per month, shown in the month table with
  each receipt's amount and item), description = the item they most often
  name. Never a `final` row, never over typed values.
- **Rent bills (v1.24.0, Nitsan 2026-11-09):** `lib/mail/rent.ts` (pure) —
  `RENT_SOURCES` (Aluel's "חשבונית מרכזת" = the rent only; IEC, arnona, Mei
  Avivim, Partner, Idan Shani's ועד בית for ניצנה 11, insurance — all to
  office@), `rentQuery` (its own search in each scan), `rentMonthsFor`
  (two-month bills take the line's pair on the grid; arnona billed ahead,
  electricity/water after). A Rent bill is a suggestion of category `rent`
  (line, months, what the cells hold); `fileRentBill` (rent-data.ts) splits
  it into the cells, refuses a final month. When the cells already hold it,
  its files go on them (`Attach.also` → `copyToCells`). ניצנה 20 = the owner's
  home: never Rent. The cleaner is cash, no invoice. Rent cells show a file
  mark → `CellFilesDialog`. **v1.24.3:** the grid holds Rent WITHOUT VAT —
  `RentSource.vat` (rent, electricity, water, Partner include it; arnona,
  ועד בית, insurance don't), `rentNet`; a final month takes the bill's file
  and № only (`filesOnly`, "Attach"); Rent bills reach back to Jan 1
  (`rentSince`). Storage keys are ASCII only (`storageName`, v1.24.2).
  **v1.24.4:** a bill goes to the cells already HOLDING its amount
  (`monthsHolding`) before any guess — **v1.24.11:** a two-month bill's own
  period comes first (`periodPair`), and IEC's total is the number BEFORE
  "סה"כ כולל מע"מ לתקופת חשבון" (`rtlPdfTotal`; its notes name the previous
  bill, which was read instead — the grid was right, the files one pair early); water is `loginOnly` (no file, amount typed
  without VAT; Milgam's payment mails are left out); arnona's "תלוש";
  skipped / "never suggest" Rent bills come back; a locked month (Rent tab
  lock) = Attach, a final cell in an open month = Update (stays final);
  a bill's link is kept in the cell's `link` (`keepBillLink`).
  **v1.24.8:** Partner bills come from `partner.net.il`; a bill with no
  amount (water) still asks when its cells hold the plan's figure. **v1.24.9:**
  Partner's PDF text comes out right-to-left (`rtlPdfTotal`: "18.140{" = ₪140.18);
  the mail panel keeps a slim "Read now" line when nothing waits. **v1.24.10:** a two-month
  bill's files stay on its first month; the second shows a dimmed mark that
  opens them (`fileHome`, expenses page) — no more copies (`copyToCells`).
- **Receipt reading v1.16.1 (reference/0020, Nitsan 2026-11-07):** each receipt
  is CLAIMED (`docs_checked_at`) before its files are saved — Gmail's
  attachment ids change on every read, which saved files 3×; paths are now
  `mail/<receipt>/<n>-<name>` and copies are removed on load. PDFs are read
  (unpdf) for amount/number/card and `item_description` ("קבלה בגין רכישת …",
  Stripe's item line) → the expense's description. Octet-stream PDFs (Wolt)
  are kept. Payment requests (`PAYMENT_REQUEST`, "דרישת תשלום") are left out.
  Vendors match across Hebrew/English by `skeleton` (וולט = Wolt); a new one
  shows close Expenses names to pick. A receipt after its monthly row ended
  (≤92 days) is flagged on the suggestion and in red on that row. The panel
  is folded by default and tinted.
- **Panel layout v1.17.0 (reference/0021):** header says when the mail was
  last read and when next (`scan` in `/api/mail/receipts`, every
  `MAIL_EVERY_MS`, only while the app is open) with "Read now". Cards in two
  groups: "Get the invoice first" (no file — button to the email's own
  invoice/log-in link, `invoiceLink` → `invoice_url`, else `billingUrl`, else
  the email) and "Ready to add". Fields are borderless until hovered; one date
  (the email's, editable); explanations behind ⓘ (`InfoDot`).
- **Michal sees "From your mail" (v1.18.0, reference/0022, Nitsan
  2026-11-08):** the receipts list, its files and "never suggest" are open to
  every Expenses user (`is_admin()`; routes use `expensesUser()` in
  `lib/advice/owner.ts`). Only the owner READS the mail (the mailbox tokens,
  `finance_tool_mail` and "Read now" stay owner-only): anyone else sees what
  that reading found, its time via `finance_mail_last_scan()`, freelancers'
  names via `finance_freelance_names()` (no amounts).
- Figures must match the pages they echo — checked live 2026-10-24: pace = the
  Overview card, unpaid hours = the tracker's Client Reports, filing = the
  Expenses Monthly tab's count (this year's rows, synthetic yearly row out).

## Scenarios (v1.29.0) — the owner's what-if page
`/scenarios`, Nitsan 2026-11-11. **Owner only** (nav `ownerOnly`,
`scenarios/layout.tsx`, `ownerOnly()` on `/api/scenarios/advise`, RLS
`is_finance_owner()` on reference/0023's tables) — never Michal.
- A scenario = decisions (`lib/scenarios/decisions.ts`, each with its month),
  shown as tick-boxes in foldable groups — office, each person, new people,
  pricing & AI, costs, you (`board.ts`; a tick IS a decision, its fields are
  the levers; each group shows its effect on the middle 12-month profit).
  Demand = ONE middle (today's sold hours) + how wide the range is
  (`starters.ts futuresFrom`: bad/good = ±spread). No project income (Nitsan:
  non-hourly work isn't relevant). ⚠️ Nothing forecasts demand from history
  ("the past is a reference, not a forecast") — past hours are marks only.
- Look = the tracker's offer page (v1.94.1): brand-blue titles, nothing under
  ~14px, big figures with bad→good range bars, explanations in `Hover` boxes.
  Panels inside white cards use `--strip` (#edf1f8 — `--light-white` vanishes
  on white); cards carry a thin ring.
- Layout (v1.30.0): &advice bar on top (answer in a side drawer); scenario
  pills + a "Compare all" button (full-width table: stability 0–100 from the
  bad future — `engine.ts stabilityGrade` — profit/month, best first by
  bad-future profit, one colour per scenario). Build view = tabbed left card
  (Decisions · Work coming in · Today's studio · Company facts) + sticky
  tabbed results pane (`pane.tsx`: grip in the gap drags its width, folds).
- **English / Hebrew** (`i18n.ts`, `he.ts`, `components/scenarios/lang.tsx`):
  English is the source, Hebrew keyed by the English text; RTL page, figures
  and bars stay LTR. ⚠️ `he.test.ts` fails on any new English string without
  its Hebrew line. The advisor answers in the page's language.
- Team: an employee not paid in the last finished month has left (Shaked,
  9 Sep 2026). Freelancers take as much as the work needs (≥160h each); extra
  work is shared by today's mix (recent hours), a freelancer a decision gives
  hours to gets them first.
- `engine.ts` (pure, 12 months): volume → AI gain / in-house / fixed-price →
  revenue; Keys use capacity; capacity fills owner+staff → employees →
  freelancers cheapest first; profit AND a cash track (write-off no cash;
  refund, dividend tax, loan moves cash only). `baseline.ts` = last 3
  finished months; "Today's studio" shows model vs booked profit as a check.
- Saved scenarios re-run on the LIVE baseline (no frozen data). The page
  writes no finance table. Before 0023 is run it plays but doesn't save.
- Company facts (cash, shareholder loan, retained earnings, leasehold, tax
  constants) are typed by the owner, prefilled from the accountant's 2025
  report (`facts.ts`). ⚠️ The owner's personal (non-company) income never
  goes in any scenario or prompt.
- Advisor: unlike &advice it sends REAL ₪ figures (Nitsan's choice) — people
  only as initials + ref (`briefOf` swaps full names, first names,
  nicknames and added people). One Opus call per click; runs logged in
  `finance_scenario_advice`.

## App map
- Pages in `src/app/(app)/`: Overview (`page.tsx`), `plan`, `salaries`,
  `freelance`, `people` (+ `[id]`), `expenses`, `rates`, `settings`.
- Person page (`people/[id]`): loads + works out once (`PersonModel`), tabs in
  `components/person/` (Overview, Performance, Pay, History, HR). Pay vs work,
  efficiency and HR advice are pure in `lib/people.ts` (`payAdvice`,
  `grossPay`, `hrAdvice`, `recommendedTerms`, `raiseAdvice` — the Pay tab's
  raise box, `supportedPayByMonth` — its all-time chart; Studio hours aren't
  held against a designer, Keys hours are). It loads the whole studio's history
  (the People list's cached load) to set them against any month.
- Big files: `expenses/page.tsx` (~4.2k lines), `components/plan-grid.tsx`
  (~2.4k), `finance-charts.tsx` (~1.6k). Logic that can be pure lives in
  `src/lib/*` with tests (`plan-model`, `overview`, `people`, `fx`, `filing`,
  `amount-vat`).
- Plan grid layout (v1.10.0): three outlined panes in ONE table (`.plan-panes`
  in globals.css, split by `PaneGap` rows) so they share the month header and
  scroll — Income (ends in Total income), Expenses (ends in Total expenses),
  Profit (green/red). Income and Expenses fold to their total (localStorage
  `plan.fold`). Min hours to break-even lives only in the Total income /
  Total expenses / Profit hovers (`plan-explain.tsx`). Income cells: Invoiced =
  orange + bold arrow; Final with no invoice = red dashed outline + alert mark
  (`incomeLook`). The legend is colour + name; explanations are hover-only.
- **New in the tracker (v1.15.0):** Salaries and Freelance show a card for
  anyone the tracker has with no row in that table (any year, by
  `profile_id` or name) — freelancers from the tracker's `freelancers`;
  salaries = active members with a login, not the owner, not in
  `freelancers`. "Add line" inserts a ₪0 row linked to the profile in the
  month they started (never before this year; refused in a locked month);
  "Not here" goes to `finance_tracker_ignored` (reference/0017 — browser-only
  until run). Pure logic in `lib/tracker-lines.ts`. Clients are covered by the
  existing new-client rate prompt (`new-clients.tsx`).
- Expenses: **Description** = what the expense is (typed, or the receipt's
  item line from the scan); **Notes** = the owner's own comments (Monthly's
  Notes column, the comment badge elsewhere). Never fill one from the other.
  The mail suggestions' Kind includes Investment (v1.19.0).
- Expenses tables (v1.20.0): drag a header to move its column, its edge to
  resize — both per table in localStorage (`lib/column-order.tsx`,
  `lib/resizable-columns.tsx`, joined in `useTableColumns`); ↺ in the
  actions header resets. Rows render cells by column key (`Row` /
  `MonthlyRow` take `cols`). Date (and Monthly's ✓) stay pinned first. The
  charts sit stacked in a right pane that folds (`useChartsPane`,
  `expenses.charts`).
- Hover "explain" cards everywhere (`explain-card.tsx`, `plan-explain.tsx`,
  `overview-explain.ts`); `privacy-blur.tsx` hides figures on demand.
- **"Hide numbers"** (sidebar foot, v1.32.0–v1.32.1): hides ONLY AMOUNTS —
  dates, years, hours, % stay readable (Nitsan's ask). It's a FONT, not a
  blur: `public/fonts/hidden-digits.woff` (built by
  `scripts/build-hidden-digits-font.py`) draws 0-9 as one smudge, and goes
  only on `[data-money]` / `[data-money-auto]`. PrivacyBlur stamps the auto
  mark on any element whose text holds ₪/$/€ (`moneyHostOf`). ⚠️ **A new
  table whose amounts print WITHOUT ₪ must carry `data-money`** (like
  month-amount-grid's tbody/tfoot) or it shows them. The inline script in
  `app/layout.tsx` hides every digit on a reload until the marks are in.
  `/brand/` and `/fonts/` skip proxy.ts — the Expenses-only redirect used
  to answer them with a page.
- Formatting: `src/lib/format.ts` (`formatILS`, `formatILSShort`, `formatPct`…).
- `reference/` = the old tracker code, kept as raw material; ESLint ignores it.

## Local-only files — do not open or commit
`people-hr-*.sql`, `tracker-history-*.sql` and `src/app/api/audit-dump/` are
excluded via `.git/info/exclude`. The HR files hold personal data (IDs,
salaries). Once that kind of PII is in a session, the safety classifier can
block tool calls for the rest of the session — don't read them unless Nitsan
asks, and then preferably in a fresh session.

## Review agents
`.claude/agents/`: `code-reviewer`, `security-reviewer`,
`studio-manager-reviewer`, `ux-reviewer`.

## Open items
- Excel (xlsx) export — only a Plan CSV export exists today.
- Make the recompute an atomic server-side RPC.
- `HANDOFF.md` / `FINANCE_ROADMAP.md` are from Sept 2026 and partly outdated;
  trust their business rules, not their UI plans.
