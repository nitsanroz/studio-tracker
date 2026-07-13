// Finance calc module — pure functions for the owner-only Finance section.
// Money is in ₪ (ILS) as plain numbers (unlike time, which is in minutes).
// Business rules live here so every view applies them identically.
//
// Rules baked in (see FINANCE_ADMIN_PLAN.md §3):
//  - VAT 17% through 2024, 18% from 2025.
//  - Per-value state: predicted → actual → final(locked). Actuals views exclude
//    'predicted'. is_forecast == (state === 'predicted').
//  - Current-year revenue is derived from tracker hours × the client's effective
//    rate (rates are effective-dated, e.g. the 300→350 transition).
//  - 2026 is a partial (H1) year — never compare its raw total to full years.

// ── Types ────────────────────────────────────────────────────────────────────
export type FinanceState = "predicted" | "actual" | "final";

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
  date: string; // ISO
  category: ExpenseCategory;
  amountGross: number;
  amountNoVat: number | null;
  state: FinanceState;
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
}

// ── Constants ──────────────────────────────────────────────────────────────
/** Years whose data is a partial actual (only some months real). */
export const PARTIAL_YEARS = new Set<number>([2026]);

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
  investments: "investments",
  // capacity / break-even lines (capacity data exists from 2023 only)
  numDesigners: "num_designers",
  daysInMonth: "days_in_month",
  maxHours: "max_hours",
  minHoursBE: "min_hours_to_be",
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

// ── State helpers ────────────────────────────────────────────────────────────
export const isForecast = (state: FinanceState): boolean => state === "predicted";
export const isLocked = (state: FinanceState): boolean => state === "final";

/** Keep only rows that count as actuals (exclude 'predicted'). */
export function actualsOnly<T extends { state: FinanceState }>(rows: T[]): T[] {
  return rows.filter((r) => !isForecast(r.state));
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

const MONTH_MID = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}-15`;

/** Gross revenue for one hours cell = hours × the rate effective mid-month. */
export function revenueForCell(cell: HoursCell, rates: ClientRate[]): number {
  const rate = rateForClientOn(rates, cell.clientCanon, MONTH_MID(cell.year, cell.month));
  return rate == null ? 0 : cell.hours * rate;
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
  partial: boolean; // true for 2026 (H1)
}

/** Sum one line item for a year from actual (non-predicted) pnl rows. */
export function sumLine(pnl: PnlMonthly[], year: number, lineItem: string): number {
  let total = 0;
  for (const r of pnl) {
    if (r.year === year && r.lineItem === lineItem && !isForecast(r.state)) total += r.value;
  }
  return total;
}

/** Build a per-year summary from pnl rows (actuals only). */
export function summarizeYear(pnl: PnlMonthly[], year: number): YearSummary {
  const revenue = sumLine(pnl, year, LINE.totalRevenues);
  const profit = sumLine(pnl, year, LINE.profit);
  const hours = sumLine(pnl, year, LINE.totalHours);
  const salaries = sumLine(pnl, year, LINE.salaries);
  const freelance = sumLine(pnl, year, LINE.freelance);
  const rent = sumLine(pnl, year, LINE.rentExpenses);
  const other = sumLine(pnl, year, LINE.expensesOther);
  return {
    year,
    revenue,
    profit,
    margin: revenue ? profit / revenue : 0,
    hours,
    avgRate: hours ? revenue / hours : 0,
    salaries,
    salariesPctRev: revenue ? salaries / revenue : 0,
    freelance,
    rent,
    otherExpenses: other,
    partial: PARTIAL_YEARS.has(year),
  };
}

/** All years present in the data, ascending. */
export function yearsIn(pnl: PnlMonthly[]): number[] {
  return [...new Set(pnl.map((r) => r.year))].sort((a, b) => a - b);
}

// ── Period filtering (Overview time filters) ─────────────────────────────────
/** A user-selected time scope for the Finance overview. */
export type PeriodSel =
  | { kind: "all" }
  | { kind: "year"; year: number }
  | { kind: "quarter"; year: number; q: 1 | 2 | 3 | 4 }
  | { kind: "month"; year: number; month: number };

/** Does (year, month) fall inside the selection? */
export function inPeriod(sel: PeriodSel, year: number, month: number): boolean {
  switch (sel.kind) {
    case "all":
      return true;
    case "year":
      return year === sel.year;
    case "quarter":
      return year === sel.year && Math.floor((month - 1) / 3) + 1 === sel.q;
    case "month":
      return year === sel.year && month === sel.month;
  }
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short human label for a selection, e.g. "Q2 2025". */
export function periodLabel(sel: PeriodSel): string {
  switch (sel.kind) {
    case "all":
      return "all time";
    case "year":
      return String(sel.year);
    case "quarter":
      return `Q${sel.q} ${sel.year}`;
    case "month":
      return `${MONTH_SHORT[sel.month - 1]} ${sel.year}`;
  }
}

/** Like YearSummary but for an arbitrary set of pnl rows (a filtered period). */
export type PeriodSummary = Omit<YearSummary, "year" | "partial">;

/** Aggregate arbitrary pnl rows (actuals only) into one summary. */
export function summarizeRows(rows: PnlMonthly[]): PeriodSummary {
  const sum = (lineItem: string) => {
    let total = 0;
    for (const r of rows) if (r.lineItem === lineItem && !isForecast(r.state)) total += r.value;
    return total;
  };
  const revenue = sum(LINE.totalRevenues);
  const profit = sum(LINE.profit);
  const hours = sum(LINE.totalHours);
  const salaries = sum(LINE.salaries);
  return {
    revenue,
    profit,
    margin: revenue ? profit / revenue : 0,
    hours,
    avgRate: hours ? revenue / hours : 0,
    salaries,
    salariesPctRev: revenue ? salaries / revenue : 0,
    freelance: sum(LINE.freelance),
    rent: sum(LINE.rentExpenses),
    otherExpenses: sum(LINE.expensesOther),
  };
}

/**
 * Annualize a partial-year figure by simple run-rate (value ÷ monthsElapsed × 12).
 * Only for display alongside a clear "annualized" label — never silently.
 */
export function annualize(value: number, monthsElapsed: number): number {
  return monthsElapsed > 0 ? (value / monthsElapsed) * 12 : value;
}

/** Distinct actual months present for a year (used for annualization). */
export function monthsElapsed(pnl: PnlMonthly[], year: number): number {
  const months = new Set<number>();
  for (const r of pnl) {
    if (r.year === year && r.lineItem === LINE.totalRevenues && !isForecast(r.state)) {
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
    add(out, cell.month, LINE.hoursIncome, revenueForCell(cell, rates));
  }
  // Non-hourly income.
  for (const r of actualsOnly(income)) {
    add(out, monthOf(r.date), LINE.projectIncome, r.amount);
  }
  // Costs.
  for (const r of actualsOnly(salaries)) {
    if (r.year === year) add(out, r.month, LINE.salaries, r.grossAmount);
  }
  for (const r of actualsOnly(freelance)) {
    if (r.year === year) add(out, r.month, LINE.freelance, r.amount);
  }
  for (const r of actualsOnly(expenses)) {
    const month = monthOf(r.date);
    const net = r.amountNoVat ?? netOfVat(r.amountGross, year);
    const line =
      r.category === "rent"
        ? LINE.rentExpenses
        : r.category === "investment"
          ? LINE.investments
          : LINE.expensesOther;
    add(out, month, line, net);
  }

  // Derived totals per month.
  for (const [, m] of out) {
    const rev = (m.get(LINE.hoursIncome) ?? 0) + (m.get(LINE.projectIncome) ?? 0);
    const exp =
      (m.get(LINE.salaries) ?? 0) +
      (m.get(LINE.freelance) ?? 0) +
      (m.get(LINE.rentExpenses) ?? 0) +
      (m.get(LINE.expensesOther) ?? 0) +
      (m.get(LINE.investments) ?? 0);
    const profit = rev - exp;
    const hrs = m.get(LINE.totalHours) ?? 0;
    m.set(LINE.totalRevenues, rev);
    m.set(LINE.totalExpenses, exp);
    m.set(LINE.profit, profit);
    m.set(LINE.profitPct, rev ? profit / rev : 0);
    m.set(LINE.avgRate, hrs ? rev / hrs : 0);
  }
  return out;
}
