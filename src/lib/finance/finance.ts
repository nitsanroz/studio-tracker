// Finance calc module — pure functions for the owner-only Finance section.
// Money is in ₪ (ILS) as plain numbers (unlike time, which is in minutes).
// Business rules live here so every view applies them identically.
//
// Rules baked in (CLAUDE.md "Business rules" holds the same list):
//  - VAT 17% through 2024, 18% from 2025.
//  - Per-value state: draft ("actual" in the DB enum, unreviewed filler) →
//    predicted (a deliberate, considered estimate) → final (locked/paid). All
//    three count in every real total — state is a workflow/confidence signal
//    for the UI, not a filter on what gets summed. is_forecast == (state ===
//    'predicted') is used only for display (e.g. dashed "still a plan" styling).
//  - Current-year revenue is derived from tracker hours × the client's effective
//    rate (rates are effective-dated, e.g. the 300→350 transition).
//  - The year in progress is partial — never compare its raw total to full
//    years; annualize it and say so.
//  - Every money figure is NET OF VAT. Foreign-currency expenses carry no
//    Israeli VAT and are converted at their month's rate (fx.ts).

import { fxQuote, type FxTable } from "./fx";

// ── Types ────────────────────────────────────────────────────────────────────
export type FinanceState = "predicted" | "actual" | "final";

/**
 * A money cell's step: Draft → Predicted → Final → Paid (Nitsan, 2026-10-25).
 * Paid comes after final — a final cell is one not paid yet — and is `final`
 * plus `paid_at` (reference/0011 for Salaries/Freelance, 0012 for the Plan:
 * the client paid us). The Plan's income cells also have Invoiced between
 * them (reference/0013, 2026-10-31): `final` plus `invoiced_at`, the invoice
 * out and the money not in. Paid wins over invoiced; every earlier step
 * clears both.
 */
export type Step = "actual" | "predicted" | "final" | "invoiced" | "paid";
export const stepOf = (state: FinanceState, paidAt: string | null = null, invoicedAt: string | null = null): Step =>
  state !== "final" ? state : paidAt ? "paid" : invoicedAt ? "invoiced" : "final";
/** The row state a step writes: invoiced and paid are final. */
export const stateOf = (step: Step): FinanceState => (step === "paid" || step === "invoiced" ? "final" : step);
/** The `paid_at` a step writes — now for paid, cleared for any earlier step. Take it once per write and patch local state with the same value. */
export const paidAtOf = (step: Step): string | null => (step === "paid" ? new Date().toISOString() : null);
/** The `invoiced_at` a step writes: kept (or now) for invoiced and paid — paid implies invoiced — and cleared for any earlier step. */
export const invoicedAtOf = (step: Step, had: string | null = null): string | null =>
  step === "invoiced" || step === "paid" ? (had ?? new Date().toISOString()) : null;
/** A step past final: the amount is checked and locked; only these move between each other in a locked month. */
export const isSettled = (step: Step) => step === "final" || step === "invoiced" || step === "paid";

export type ExpenseCategory = "monthly" | "yearly" | "misc" | "investment" | "rent";
export type Recurrence = "one_off" | "monthly" | "yearly";
export type IncomeSource = "hourly" | "fixed_project" | "other";
export type LockBlock =
  | "revenue" | "salaries" | "freelance" | "expenses" | "income" | "all";

export interface PnlMonthly {
  year: number;
  month: number; // 1–12
  lineItem: string;
  value: number;
  state: FinanceState;
  source: string; // 'import' | 'rollup' | 'manual'
  /** Why a booked figure differs from its sheet (set by an audit correction). */
  note?: string;
}

export interface ClientMonthly {
  year: number;
  month: number;
  clientId: string | null;
  clientCanon: string;
  discipline: string | null;
  subAccount: string;
  hours: number;
  rate: number | null;
  revenueGross: number;
  state: FinanceState;
  comment: string;
  /** the client paid it (reference/0012) — the step after final; absent before 0012 */
  paidAt?: string | null;
  /** the invoice went out (reference/0013) — between final and paid; absent before 0013 */
  invoicedAt?: string | null;
}

export interface ClientRate {
  clientId: string | null;
  clientCanon: string;
  rate: number;
  effectiveFrom: string; // ISO date
  effectiveTo: string | null; // ISO date, null = current
}

export interface FinanceLock {
  scopeYear: number;
  scopeMonth: number | null; // null = whole-year
  block: LockBlock;
}

export interface ExpenseRow {
  date: string; // ISO — for "monthly", the accrual start date
  endDate: string | null; // "monthly" only — accrual end (null = still active)
  category: ExpenseCategory;
  vendor: string;
  amountGross: number;
  amountNoVat: number | null;
  state: FinanceState;
  // Optional so hand-built rows (tests) can omit them — defaults: ILS,
  // VAT-inclusive, 12-month renewal, no description.
  currency?: string;
  vatIncluded?: boolean;
  /** "yearly" only — how many months one payment covers (default 12). */
  renewMonths?: number | null;
  description?: string;
}

export interface SalaryRow {
  year: number;
  month: number;
  grossAmount: number;
  state: FinanceState;
}

export interface FreelanceRow {
  year: number;
  month: number;
  amount: number;
  state: FinanceState;
}

export interface IncomeRow {
  date: string; // ISO
  source: IncomeSource;
  amount: number;
  state: FinanceState;
}

/** Hours pulled from the tracker, bucketed by client + month, for revenue calc. */
export interface HoursCell {
  year: number;
  month: number;
  clientId: string | null;
  clientCanon: string;
  hours: number;
  /** what the cell billed, when already priced (the Plan's `cellRevenue`: a
   * final month keeps its booked revenue); else hours × the rate in effect */
  revenue?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────
/** Years whose data is a partial actual (only some months real) — either
 * because the year is still in progress (the current one, and any later), or
 * because the business itself hadn't started yet for part of it (2016: founded
 * May 2016, so Jan–Apr never happened and carry no rows at all). Every "yearly"
 * stat (sumLine/summarizeYear, cost/rate/utilization charts, YoY comparisons)
 * already treats a partial year as not comparable to a full 12-month one —
 * this is the single place that says which years qualify.
 *
 * ⚠️ A FUNCTION, not the fixed set `{2016, 2026}` it was until 2026-11-10: on
 * 1 Jan 2027 that set would have compared 2027's first weeks with a whole 2026,
 * kept 2026 "partial" for good and silenced &advice's year outlook. */
export const FOUNDING_YEAR = 2016;
export function isPartialYear(year: number, now = new Date()): boolean {
  return year === FOUNDING_YEAR || year >= Number(now.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }).slice(0, 4));
}

/** Studio is an internal, non-billable hours bucket (no rate, no revenue) —
 * it must never count toward total hours, average rate, or active-client
 * metrics. Its own hours still get tracked and edited like any other row. */
export const NON_BILLABLE_CLIENT_CANON = "Studio";

/** These expense vendors get their own dedicated Plan-grid line instead of
 * being folded into "Misc expenses" — entered on the Expenses page under
 * whichever category fits their actual accrual (usually "yearly"), broken
 * out here by vendor name alone. Exact match, same pattern as
 * NON_BILLABLE_CLIENT_CANON. */
export const ACCOUNTING_VENDOR_CANON = "Accounting";
export const LAWYER_VENDOR_CANON = "Lawyer";
export const GUR_VENDOR_CANON = "Gur";

/**
 * Synthetic monthly-total rows the yearly-expenses sync inserts so the P&L
 * rollup gets the sheet's own amortized total for that month. They're already
 * "this month's share" — the rollup counts them in their own month only (never
 * spread), and the Expenses page never lists them as subscriptions.
 */
export const SYNTHETIC_YEARLY_MARKER = "Yearly subscriptions (amortized this month)";

/** Canonical P&L line items the rollup produces / the views read. */
export const LINE = {
  totalRevenues: "total_revenues",
  totalExpenses: "total_expenses",
  profit: "profit",
  profitPct: "profit_pct",
  totalHours: "total_hours",
  hoursIncome: "total_hours_income",
  projectIncome: "total_project_income",
  avgRate: "average_taarif",
  salaries: "salaries",
  freelance: "freelance_salaries",
  rentExpenses: "rent_expenses",
  expensesOther: "expenses_other",
  expensesMonthly: "expenses_monthly",
  expensesYearly: "expenses_yearly",
  expensesMisc: "expenses_misc",
  expensesAccounting: "expenses_accounting",
  expensesLawyer: "expenses_lawyer",
  expensesGur: "expenses_gur",
  investments: "investments",
  // capacity / break-even lines (capacity data exists from 2023 only)
  numDesigners: "num_designers",
  daysInMonth: "days_in_month",
  maxHours: "max_hours",
  minHoursBE: "min_hours_to_be",
  /** Total revenue expressed as an hours-equivalent at the average rate —
   * lets revenue be compared to break-even/worked hours on the same scale. */
  incomeInHours: "income_in_hours",
} as const;

// ── VAT ──────────────────────────────────────────────────────────────────────
/** VAT rate for a given year (17% ≤2024, 18% from 2025). */
export function vatRate(year: number): number {
  return year >= 2025 ? 0.18 : 0.17;
}

/** Strip VAT off a gross amount for the year. */
export function netOfVat(gross: number, year: number): number {
  return gross / (1 + vatRate(year));
}

/** Round to 2 decimal places — the one definition every money grid/page uses
 * so a future rounding-rule change (e.g. banker's rounding) can't apply to
 * some money and not other money. */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ── Currency ─────────────────────────────────────────────────────────────────
export type ExpenseCurrency = "ILS" | "USD" | "EUR";
export const EXPENSE_CURRENCIES: ExpenseCurrency[] = ["ILS", "USD", "EUR"];
export const CURRENCY_SYMBOL: Record<ExpenseCurrency, string> = { ILS: "₪", USD: "$", EUR: "€" };

/** Which month's exchange rate applies, and the rates to look it up in. */
export interface FxAt {
  table?: FxTable;
  month: number;
}

/**
 * Net ILS — WITHOUT VAT — for one expense line. Every figure the app totals
 * is net of VAT, and these are the only two rules:
 *  - ILS: strip VAT only when the price includes it (`vatIncluded`).
 *  - Foreign currency: an overseas supplier charges no Israeli VAT, so NOTHING
 *    is ever deducted — the amount is just converted at that month's rate
 *    (Bank of Israel month-end + FX_MARKUP, see fx.ts). `vatIncluded` is
 *    ignored for a foreign line on purpose.
 */
export function netIls(gross: number, currency: string, vatIncluded: boolean, year: number, fx?: FxAt): number {
  if (currency !== "ILS") return gross * fxQuote(fx?.table, currency, year, fx?.month ?? 12).rate;
  return vatIncluded ? netOfVat(gross, year) : gross;
}

/** Net ILS (no VAT) for a raw finance_expenses row — the one definition every
 * view that groups/sums raw expense rows (by vendor, by month) should use.
 *  - Foreign currency with a Bank of Israel rate for that month (or an earlier
 *    one): converted fresh at that month's rate. The stored amount_no_vat is
 *    only a snapshot from the day it was typed, so it doesn't win.
 *  - Otherwise the stored amount_no_vat (a stored 0 beside a real gross is a
 *    leftover seed gap, not a genuine zero, so it counts as "not stored"),
 *    else netIls from the price and the VAT flag. */
export function expenseNetIls(
  r: {
    amount_gross: number | string;
    amount_no_vat: number | string | null;
    currency: string;
    vat_included: boolean;
  },
  year: number,
  fx?: FxAt,
): number {
  const gross = Number(r.amount_gross);
  if (r.currency !== "ILS" && fx?.table) {
    const q = fxQuote(fx.table, r.currency, year, fx.month);
    if (q.official != null) return gross * q.rate;
  }
  const stored =
    r.amount_no_vat != null && !(Number(r.amount_no_vat) === 0 && gross !== 0)
      ? Number(r.amount_no_vat)
      : null;
  if (stored != null) return stored;
  return netIls(gross, r.currency, r.vat_included, year, fx);
}

// ── State helpers ────────────────────────────────────────────────────────────
export const isForecast = (state: FinanceState): boolean => state === "predicted";
export const isLocked = (state: FinanceState): boolean => state === "final";

/**
 * Tailwind classes for a numeric cell by its finance state — shared across
 * every money grid (Rent, Salaries, Freelance, Plan) so "locked" always looks
 * the same: bold black text on green, vs. greyed-out text when unlocked.
 */
export function cellStateClass(state: FinanceState | undefined): string {
  if (state === "predicted") return "bg-[var(--state-predicted-bg)] text-[var(--state-predicted-fg)]";
  if (state === "final") return "bg-[var(--state-final-bg)] font-bold text-foreground";
  return "text-muted";
}

/** Is a (year, month, block) finalized by any covering lock? */
export function isPeriodLocked(
  locks: FinanceLock[],
  year: number,
  month: number,
  block: LockBlock,
): boolean {
  return locks.some(
    (l) =>
      l.scopeYear === year &&
      (l.scopeMonth === null || l.scopeMonth === month) &&
      (l.block === "all" || l.block === block),
  );
}

// ── Rates (effective-dated) ──────────────────────────────────────────────────
/** The client's hourly rate effective on `isoDate`, or null if none applies. */
export function rateForClientOn(
  rates: ClientRate[],
  clientCanon: string,
  isoDate: string,
): number | null {
  let best: ClientRate | null = null;
  for (const r of rates) {
    if (r.clientCanon !== clientCanon) continue;
    if (r.effectiveFrom > isoDate) continue;
    if (r.effectiveTo && r.effectiveTo < isoDate) continue;
    // pick the latest-starting applicable rate
    if (!best || r.effectiveFrom > best.effectiveFrom) best = r;
  }
  return best ? best.rate : null;
}

/** The 15th of a month — the day a month's rate is read on. */
export const MONTH_MID = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}-15`;

/** The client's rate for a month — the one in effect on its 15th (MONTH_MID);
 * null if none applies. */
export function rateForMonth(rates: ClientRate[], clientCanon: string, year: number, month: number): number | null {
  return rateForClientOn(rates, clientCanon, MONTH_MID(year, month));
}

/** Gross revenue for one hours cell = hours × the rate effective mid-month. */
export function revenueForCell(cell: HoursCell, rates: ClientRate[]): number {
  const rate = rateForMonth(rates, cell.clientCanon, cell.year, cell.month);
  return rate == null ? 0 : cell.hours * rate;
}

/**
 * Whether a just-added rate is the one that prices `month` of `year` — its
 * start is on or before the 15th and no later-starting rate has taken over.
 * `rates` must already include `added`. A backdated rate must not reprice
 * months a newer rate covers.
 */
export function newRateCovers(rates: ClientRate[], added: ClientRate, year: number, month: number): boolean {
  const mid = MONTH_MID(year, month);
  return mid >= added.effectiveFrom && rateForClientOn(rates, added.clientCanon, mid) === added.rate;
}

// ── Yearly aggregation (for the overview / trend) ────────────────────────────
export interface YearSummary {
  year: number;
  revenue: number;
  profit: number;
  margin: number; // fraction, e.g. 0.096
  hours: number;
  avgRate: number; // revenue ÷ hours
  salaries: number;
  salariesPctRev: number; // fraction
  freelance: number;
  rent: number;
  otherExpenses: number;
  expenses: number; // total_expenses P&L line — salaries+freelance+rent+other+investments
  partial: boolean; // fewer than 12 months booked (isPartialYear)
}

/** Sum one line item for a year's pnl rows — every STATE counts (draft,
 * predicted and final alike). Only for the CURRENT calendar year does a
 * not-yet-elapsed month (per `isForecastMonth`) get excluded: a partial
 * year's to-date total must not be dragged around by future months'
 * forecasted expenses with no matching revenue yet. A fully-elapsed past
 * year has no forecast months anyway, so it always sums all 12. A fully
 * FUTURE year (e.g. next year's plan) is excluded from this filter on
 * purpose — `isForecastMonth` would otherwise mark every one of its months
 * as forecast and zero it out entirely, which would break the Plan page's
 * forward-planning view (it deliberately shows next year's real predicted
 * totals, not "0 because none of it happened yet"). */
export function sumLine(pnl: PnlMonthly[], year: number, lineItem: string): number {
  const isCurrentYear = year === new Date().getFullYear();
  let total = 0;
  for (const r of pnl) {
    if (r.year !== year || r.lineItem !== lineItem) continue;
    if (isCurrentYear && isForecastMonth(r.year, r.month)) continue;
    total += r.value;
  }
  return total;
}

/** Like YearSummary but for an arbitrary set of pnl rows (a filtered period). */
export type PeriodSummary = Omit<YearSummary, "year" | "partial">;

/** The summary figures, given how to total one line item — shared by
 * summarizeYear (sumLine's rule) and summarizeRows (every row given). */
function summarize(sum: (lineItem: string) => number): PeriodSummary {
  const revenue = sum(LINE.totalRevenues);
  const profit = sum(LINE.profit);
  const hours = sum(LINE.totalHours);
  // The earliest sheet (2016) has no hours-income row — its revenue is all hours.
  const hoursIncome = sum(LINE.hoursIncome) || (hours ? revenue - sum(LINE.projectIncome) : 0);
  const salaries = sum(LINE.salaries);
  return {
    revenue,
    profit,
    margin: revenue ? profit / revenue : 0,
    hours,
    // Hourly revenue only — a one-off project fee must never inflate the
    // ₪/hour rate for a month with few billable hours.
    avgRate: hours ? hoursIncome / hours : 0,
    salaries,
    salariesPctRev: revenue ? salaries / revenue : 0,
    freelance: sum(LINE.freelance),
    rent: sum(LINE.rentExpenses),
    otherExpenses: sum(LINE.expensesOther),
    expenses: sum(LINE.totalExpenses),
  };
}

/** Build a per-year summary from pnl rows — every state counts (see sumLine). */
export function summarizeYear(pnl: PnlMonthly[], year: number): YearSummary {
  return { year, ...summarize((lineItem) => sumLine(pnl, year, lineItem)), partial: isPartialYear(year) };
}

/** All years present in the data, ascending. */
export function yearsIn(pnl: PnlMonthly[]): number[] {
  return [...new Set(pnl.map((r) => r.year))].sort((a, b) => a - b);
}

/** The month names — the app's one list of each (index 0 = January). */
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Aggregate an arbitrary set of pnl rows into one summary (every state counts). */
export function summarizeRows(rows: PnlMonthly[]): PeriodSummary {
  return summarize((lineItem) => {
    let total = 0;
    for (const r of rows) if (r.lineItem === lineItem) total += r.value;
    return total;
  });
}

/**
 * Annualize a partial-year figure by simple run-rate (value ÷ monthsElapsed × 12).
 * Only for display alongside a clear "annualized" label — never silently.
 */
export function annualize(value: number, monthsElapsed: number): number {
  return monthsElapsed > 0 ? (value / monthsElapsed) * 12 : value;
}

/** Distinct months of a year that have already happened (used for annualization).
 * Chronology-based, not state-based — a "predicted" row can exist for an
 * already-elapsed month (it's a real, deliberate estimate now, not a stale
 * forecast), so state alone can't tell you whether a month is done yet. */
export function monthsElapsed(pnl: PnlMonthly[], year: number): number {
  const months = new Set<number>();
  for (const r of pnl) {
    if (r.year === year && r.lineItem === LINE.totalRevenues && !isForecastMonth(year, r.month)) {
      months.add(r.month);
    }
  }
  return months.size;
}

// ── Year-over-year delta (for KPI cards) ─────────────────────────────────────
export interface Delta {
  abs: number;
  pct: number | null; // null when prior is 0
}
export function yoy(current: number, prior: number): Delta {
  return { abs: current - prior, pct: prior ? (current - prior) / prior : null };
}

// ── Current-year rollup ──────────────────────────────────────────────────────
// Turns the granular entry rows + tracker hours into monthly P&L line items for
// the live year, so the overview stays consistent with what was entered.
export interface RollupInput {
  year: number;
  hours: HoursCell[]; // from tracker, this year
  rates: ClientRate[];
  income: IncomeRow[]; // non-hourly
  salaries: SalaryRow[];
  freelance: FreelanceRow[];
  expenses: ExpenseRow[];
  /** Monthly exchange rates (fx.ts); without them foreign amounts use the
   * stored snapshot / fixed fallback. */
  fx?: FxTable;
}

/** month (1–12) → line item → value */
export type MonthlyRollup = Map<number, Map<string, number>>;

function add(map: MonthlyRollup, month: number, lineItem: string, value: number) {
  let m = map.get(month);
  if (!m) {
    m = new Map();
    map.set(month, m);
  }
  m.set(lineItem, (m.get(lineItem) ?? 0) + value);
}

const monthOf = (iso: string) => Number(iso.slice(5, 7));

/** Is (year, month) still ahead of today — i.e. a forecast/plan period rather
 * than something that's already happened? The current month itself counts as
 * still-forecast (>=), since it isn't over yet. This is the ONE definition of
 * that rule in the app — every cell-state decision (Plan, Salaries/Freelance,
 * the P&L rollup, and the Expenses trend charts) must import and use this
 * rather than re-deriving it, or they can silently disagree about whether the
 * current month is complete. */
export function isForecastMonth(year: number, month: number): boolean {
  const today = new Date();
  if (year !== today.getFullYear()) return year > today.getFullYear();
  return month >= today.getMonth() + 1;
}

/** The P&L line an expense row books to. */
export function expenseLineOf(r: ExpenseRow): string {
  return r.category === "rent"
    ? LINE.rentExpenses
    : r.category === "investment"
      ? LINE.investments
      : r.vendor.trim() === ACCOUNTING_VENDOR_CANON
        ? LINE.expensesAccounting
        : r.vendor.trim() === LAWYER_VENDOR_CANON
          ? LINE.expensesLawyer
          : r.vendor.trim() === GUR_VENDOR_CANON
            ? LINE.expensesGur
            : r.category === "monthly"
              ? LINE.expensesMonthly
              : r.category === "yearly"
                ? LINE.expensesYearly
                : LINE.expensesMisc;
}

/**
 * What one expense row costs in each month of `year`, net ILS — THE rule for
 * spreading an expense over months. The P&L (`rollupCurrentYear`) and the
 * Expenses page both use it (Nitsan, 2026-11-10: "Expenses follows the P&L"),
 * so the Expenses Summary and the Plan's expense lines can't disagree:
 *  · a real yearly renewal → its payment ÷ `renewMonths` (default 12) in each
 *    month it covers from its date, across year ends — a renewal paid in
 *    Sep 2025 still costs Jan–Aug 2026 its share. Its end date doesn't cut the
 *    spread: the year was paid up front;
 *  · a monthly row → its amount in every month from its date to its end date
 *    (or the year's end), each at that month's FX rate;
 *  · anything else (misc, rent, investment, a synthetic yearly share,
 *    Accounting/Lawyer/Gur) → once, in its own month of its own year.
 * The row must be read for the years it spans: a yearly row up to 3 years
 * back, a monthly row from before `year` that still runs into it.
 */
export function expenseShares(r: ExpenseRow, year: number, fx?: FxTable): { month: number; amount: number }[] {
  const rowYear = Number(r.date.slice(0, 4));
  // The app's one net-ILS rule (no VAT; foreign currency at its month's
  // rate). `netAt` takes the month whose RATE applies: each month of a
  // recurring charge is billed at that month's rate, while a yearly payment
  // and a one-off are converted once, at the month they were paid.
  const netAt = (y: number, m: number) =>
    expenseNetIls(
      {
        amount_gross: r.amountGross,
        amount_no_vat: r.amountNoVat,
        currency: r.currency ?? "ILS",
        vat_included: r.vatIncluded ?? true,
      },
      y,
      { table: fx, month: m },
    );
  const out: { month: number; amount: number }[] = [];
  if (expenseLineOf(r) === LINE.expensesYearly && r.description !== SYNTHETIC_YEARLY_MARKER) {
    // A real yearly renewal is one payment covering `renewMonths` months
    // from its date — spread it evenly across them (the sheet's method), so
    // a December renewal costs 1/12 in each of the next 12 months rather
    // than all landing in December. A payment from an earlier year still
    // contributes its share to whichever of this year's months it covers.
    const net = netAt(rowYear, monthOf(r.date));
    const span = r.renewMonths && r.renewMonths > 0 ? r.renewMonths : 12;
    const start = rowYear * 12 + (monthOf(r.date) - 1);
    for (let i = 0; i < span; i++) {
      const abs = start + i;
      if (Math.floor(abs / 12) === year) out.push({ month: (abs % 12) + 1, amount: net / span });
    }
  } else if (r.category === "monthly") {
    // A "monthly" row is a recurring charge, active from its date until
    // endDate (or still ongoing) — it counts toward EVERY month in that
    // window, not just the month it happens to be dated. Critically: a row
    // that started AFTER this year, or already ended (endDate) BEFORE this
    // year, contributes zero months here — falling through to "the whole
    // year" (fromMonth=1/toMonth=12) for those cases was the bug: an old
    // subscription end-dated in 2024 kept counting as a full-year expense
    // in every later year's rollup forever, since its endDate's year never
    // matched whatever year was being rolled up.
    const endYear = r.endDate ? Number(r.endDate.slice(0, 4)) : null;
    if (!(rowYear > year || (endYear != null && endYear < year))) {
      const fromMonth = rowYear === year ? monthOf(r.date) : 1;
      const toMonth = endYear === year ? monthOf(r.endDate!) : 12;
      for (let m = fromMonth; m <= toMonth; m++) out.push({ month: m, amount: netAt(year, m) });
    }
  } else if (rowYear === year) {
    // A single-month row (misc, rent, investment, synthetic yearly share,
    // Accounting/Lawyer/Gur) only ever counts in its own month of its own year.
    out.push({ month: monthOf(r.date), amount: netAt(rowYear, monthOf(r.date)) });
  }
  return out;
}

/**
 * Compute this year's monthly P&L from entries + hours.
 * Expenses are stored net-of-VAT where available, else derived via the VAT rule.
 * Returns a per-month map of the canonical line items in LINE.
 */
export function rollupCurrentYear(input: RollupInput): MonthlyRollup {
  const { year, hours, rates, income, salaries, freelance, expenses } = input;
  const out: MonthlyRollup = new Map();

  // Hourly revenue + hours from the tracker.
  for (const cell of hours) {
    if (cell.year !== year) continue;
    add(out, cell.month, LINE.totalHours, cell.hours);
    add(out, cell.month, LINE.hoursIncome, cell.revenue ?? revenueForCell(cell, rates));
  }
  // Non-hourly income.
  for (const r of income) {
    add(out, monthOf(r.date), LINE.projectIncome, r.amount);
  }
  // Costs.
  for (const r of salaries) {
    if (r.year === year) add(out, r.month, LINE.salaries, r.grossAmount);
  }
  for (const r of freelance) {
    if (r.year === year) add(out, r.month, LINE.freelance, r.amount);
  }
  // Expenses: every state counts, including 'predicted' — it's a deliberate,
  // considered estimate (not a stale forecast placeholder), so it belongs in
  // the real total the moment it's entered, elapsed month or not.
  for (const r of expenses) {
    const line = expenseLineOf(r);
    for (const { month, amount } of expenseShares(r, year, input.fx)) {
      add(out, month, line, amount);
      // expensesOther stays the combined "other overhead" bucket other views
      // (Overview's cost-structure chart, year summaries) already read —
      // Accounting/Lawyer/Gur get their own Plan-grid line but still count here.
      if (
        line === LINE.expensesMonthly ||
        line === LINE.expensesYearly ||
        line === LINE.expensesMisc ||
        line === LINE.expensesAccounting ||
        line === LINE.expensesLawyer ||
        line === LINE.expensesGur
      ) {
        add(out, month, LINE.expensesOther, amount);
      }
    }
  }

  // Derived totals per month.
  for (const [, m] of out) {
    const hoursIncome = m.get(LINE.hoursIncome) ?? 0;
    const rev = hoursIncome + (m.get(LINE.projectIncome) ?? 0);
    const exp =
      (m.get(LINE.salaries) ?? 0) +
      (m.get(LINE.freelance) ?? 0) +
      (m.get(LINE.rentExpenses) ?? 0) +
      (m.get(LINE.expensesOther) ?? 0) +
      (m.get(LINE.investments) ?? 0);
    const profit = rev - exp;
    const hrs = m.get(LINE.totalHours) ?? 0;
    // The ₪/hour rate is hourly revenue only — one-off project income (a
    // fixed-fee job, unrelated to hours worked) must never inflate it.
    const rate = hrs ? hoursIncome / hrs : 0;
    m.set(LINE.totalRevenues, rev);
    m.set(LINE.totalExpenses, exp);
    m.set(LINE.profit, profit);
    m.set(LINE.profitPct, rev ? profit / rev : 0);
    m.set(LINE.avgRate, rate);
    // Both expressed in hours-equivalents at the average rate, so revenue,
    // expenses and hours worked can all be read on the same scale.
    m.set(LINE.minHoursBE, rate ? exp / rate : 0);
    m.set(LINE.incomeInHours, rate ? rev / rate : 0);
  }
  return out;
}
