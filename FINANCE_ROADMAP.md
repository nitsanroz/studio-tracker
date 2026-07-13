# Finance Admin — Roadmap & Handoff (for Claude Code)

Handoff for continuing the owner-only **Finance** section in studio-tracker.
Phases 0 and 1a are built and verified (tsc + eslint clean). This file is the
single source of truth for what's done, what's next, and the conventions to
follow. Full product spec: `../Claud cowork/financial sheets/consolidated/FINANCE_ADMIN_PLAN.md`.

Stack: Next.js 16 · React 19 · Tailwind v4 · Supabase. Currency ₪ (ILS).

---

## Status

### ✅ Phase 0 — data foundation (done)
- `supabase/migrations/0005_finance.sql` — schema: reference tables
  (`finance_pnl_monthly`, `finance_client_monthly`, `client_rates`, `fx_rates`,
  `finance_events`), entry tables (`finance_expenses`, `finance_salaries`,
  `finance_freelance`, `finance_income`), and `finance_locks`. Every value has a
  `state` (`predicted`|`actual`|`final`). A trigger (`finance_guard_locked`)
  blocks UPDATE/DELETE on `final` rows. All tables admin-only via RLS
  (`is_admin()`, "admin all" policy, no read-all).
- `supabase/migrations/0006_finance_seed.sql` — 10 years imported from
  `studio_more.db`. History = `final`; 2026 Jul–Dec filler = `predicted`.
  `client_rates` seeded from history (incl. 300→350). Import totals verified
  against the known figures (2025 ₪2,849,615 / 9.6%; 2024 −11.6%).
- Both migrations already applied to Supabase.
- Regenerate the seed: `../Claud cowork/financial sheets/consolidated/build_finance_seed.py`.

### ✅ Phase 1a (partial) — Overview: KPI header + 10-year trend (done)
- `src/lib/finance.ts` — calc module (VAT rules, state helpers, effective-dated
  rates, revenue-from-hours, `summarizeYear`, `rollupCurrentYear`, YoY). 25 unit
  tests passed on the rules.
- `src/lib/format.ts` — added `formatILS`, `formatILSShort`, `formatPct`,
  `formatSignedPct`.
- `src/components/finance-charts.tsx` — `TrendChart` (revenue bars + margin line
  + event annotations; 2026 flagged H1). Custom SVG, brand tokens.
- `src/app/(app)/finance/page.tsx` — Finance page: KPI header (Revenue, Profit,
  Margin, Hours, Avg rate, Salaries %), trend chart, by-year table.
- `src/components/app-shell.tsx` — admin-only **Finance** nav item (Wallet icon).

---

## Next up

### Phase 1a (remaining Overview views)
Build as sections on the Finance page (or split into sub-tabs). Read from
`finance_pnl_monthly` / `finance_client_monthly` via the same client-side
`fetchAll` pattern already in `finance/page.tsx`.

1. **Cost structure** — salaries / freelance / rent / other as % of revenue over
   time (stacked area or grouped bars). Highlight salaries % (the margin driver:
   49%→89% in 2024→64%). Line items: `salaries`, `freelance_salaries`,
   `rent_expenses`, `expenses_other`.
2. **Client view** — top clients by year from `finance_client_monthly`
   (`client_canon`), concentration (top-1 / top-3 share), loyalty (years active).
   Filter by `discipline`; expandable `sub_account`. Use `ClientChip` style.
3. **Rate & utilization** — avg rate trend (show 300→350); utilization vs
   capacity (only 2023→, from `num_designers`/`days_in_month`/`max_hours` line
   items — don't fabricate pre-2023).
4. **Break-even** — `min_hours_to_be` vs `total_hours` per month.

### Phase 1b — Data entry (owner's priority)
Tab with four inline-editable tables (mirror the Reports hours editor pattern):
**Expenses, Salaries, Freelance, Income (non-hourly)**. Write via the client
Supabase client; RLS already enforces admin-only.

- **State + locking (confirmed requirement):**
  - Every row carries `state` (`predicted`|`actual`|`final`).
  - Color-code cells by state: predicted = muted/amber tint + "est." marker;
    actual = normal; final = brand/success tint + lock icon. Add a legend.
  - **Review & Finalize** a month — whole month or a single block
    (`revenue|salaries|freelance|expenses|income`) — writes a `finance_locks`
    row and flips affected rows to `final`. **Unlock** removes the lock row and
    reverts `final`→`actual` (must happen before edits; the DB trigger enforces
    it). Use `isPeriodLocked()` / `isLocked()` from `finance.ts`.
- **Current-year rollup:** after any entry change, recompute the year's
  `finance_pnl_monthly` rows (source `'rollup'`) via `rollupCurrentYear()` in
  `finance.ts`. Revenue for the live year comes from tracker hours × effective
  `client_rates` — NOT re-typed. Non-hourly income goes in `finance_income`.
  - Needs a rate-admin UI: add/edit `client_rates` with an `effective_from` date
    (this is how a rate change is recorded).
  - Recommended: do the rollup in a Supabase RPC/server action so it's atomic;
    `rollupCurrentYear` gives the reference logic.
- **Export tab:** download current year/view as xlsx (reuse Reports' Download).

### Phase 2 — polish & freshness
- Design-brief-quality styling; empty/loading/error states; RTL for Hebrew
  fields (Hebrew names/vendors exist in the data).
- Confirm current-year auto-freshness from tracker hours end-to-end.

### Phase 3 — Insights & chatbot (later)
- Rule-based insight cards (margin alert, client concentration, salary-ratio
  watch, break-even flag).
- AI recommendations layer.
- Chatbot over the finance data that can generate graphs/tables on demand.

---

## Business rules (must hold everywhere — encoded in `finance.ts`)
- VAT 17% ≤2024, **18% from 2025** (`vatRate`).
- `state='predicted'` == forecast → excluded from actuals (`actualsOnly`).
- **2026 is partial (H1)** — never compare its raw total to full years; annualize
  with a clear label (`PARTIAL_YEARS`, `annualize`, `monthsElapsed`).
- Rates are effective-dated (`rateForClientOn`); revenue = Σ(hours × rate).
- `average_taarif` is derived (revenue ÷ hours), never an input.

## Conventions to follow
- Admin gating: nav `adminOnly: true` + RLS `is_admin()`; also guard the page
  (see `finance/page.tsx`). No designer read of finance tables.
- Charts = custom SVG in the `charts.tsx` / `finance-charts.tsx` style — no chart
  library. Use CSS vars (`var(--brand)`, `var(--foreground)`, `var(--muted)`,
  `var(--danger)`, `var(--success)`, `var(--border)`, `var(--surface)`).
- Data access: `fetchAll()` from `src/lib/db.ts`; `useData()` store for
  profiles/clients/tasks/time.
- Formatting: `formatILS` / `formatILSShort` / `formatPct` / `formatSignedPct`.
- **ESLint bans `any`** — type Supabase rows explicitly; use `catch (e: unknown)`.
- Migrations are applied by hand in the Supabase SQL editor (numbered files).

## Verify before done
- `node_modules/.bin/tsc --noEmit -p tsconfig.json`
- `node_modules/.bin/eslint <changed files>`
- `npm run build` (works locally; needs network for the SWC binary).
- Locking: confirm a `final` row can't be edited via UI or direct API (trigger).
- Access: a designer sees no Finance nav and can't read finance tables.
