import type { FxTable } from "@/lib/finance/fx";
import {
  LINE,
  MONTH_SHORT,
  NON_BILLABLE_CLIENT_CANON,
  isPartialYear,
  expenseNetIls,
  isForecast,
  isForecastMonth,
  sumLine,
  summarizeYear,
  yearsIn,
  type ClientMonthly,
  type PnlMonthly,
  type YearSummary,
} from "@/lib/finance/finance";
import type { ExpenseRowDb } from "@/lib/finance/db";
import { formatILSShort } from "@/lib/finance/format";
import type {
  CostYear,
  RatePoint,
  UtilizationPoint,
  BreakEvenMonth,
  TrendPoint,
  PieSlice,
  MonthPoint,
} from "@/components/finance/finance-charts";


export function buildYearSummaries(pnl: PnlMonthly[]): YearSummary[] {
  return yearsIn(pnl).map((y) => summarizeYear(pnl, y));
}

/** Roll several year summaries into one all-time total (year 0, not partial). */
export function aggregateSummaries(summaries: YearSummary[]): YearSummary {
  const sum = (pick: (s: YearSummary) => number) => summaries.reduce((t, s) => t + pick(s), 0);
  const revenue = sum((s) => s.revenue);
  const profit = sum((s) => s.profit);
  const hours = sum((s) => s.hours);
  const salaries = sum((s) => s.salaries);
  return {
    year: 0,
    revenue,
    profit,
    margin: revenue ? profit / revenue : 0,
    hours,
    avgRate: hours ? revenue / hours : 0,
    salaries,
    salariesPctRev: revenue ? salaries / revenue : 0,
    freelance: sum((s) => s.freelance),
    rent: sum((s) => s.rent),
    otherExpenses: sum((s) => s.otherExpenses),
    expenses: sum((s) => s.expenses),
    partial: false,
  };
}

export function buildCostYears(summaries: YearSummary[]): CostYear[] {
  return summaries.map((s) => ({
    year: s.year,
    partial: s.partial,
    salaries: s.revenue ? s.salaries / s.revenue : 0,
    freelance: s.revenue ? s.freelance / s.revenue : 0,
    rent: s.revenue ? s.rent / s.revenue : 0,
    other: s.revenue ? s.otherExpenses / s.revenue : 0,
  }));
}

export function buildRatePoints(summaries: YearSummary[]): RatePoint[] {
  return summaries
    .filter((s) => s.hours > 0)
    .map((s) => ({ year: s.year, rate: s.avgRate, partial: s.partial }));
}

/** Capacity data only exists from 2023 — don't fabricate earlier years. */
export function buildUtilization(pnl: PnlMonthly[]): UtilizationPoint[] {
  const out: UtilizationPoint[] = [];
  for (const year of yearsIn(pnl)) {
    const maxHours = sumLine(pnl, year, LINE.maxHours);
    const hours = sumLine(pnl, year, LINE.totalHours);
    if (maxHours <= 0) continue; // no capacity data (pre-2023)
    out.push({ year, partial: isPartialYear(year), hours, maxHours });
  }
  return out;
}

// ── The months not finished yet, estimated ──────────────────────────────────
/** A month not finished yet, estimated in full: the month in progress
 * (projectCurrentMonth) or one still to come. Its costs are the stored ones —
 * already the full month's; only the hours and hourly income are estimated. */
export interface MonthProjection {
  month: number;
  revenue: number;
  hours: number;
  /** Hourly income alone (revenue less project fees) — for the rate. */
  hourlyIncome: number;
  expenses: number;
  profit: number;
  margin: number;
  soFarRevenue: number;
  soFarHours: number;
  /** Workdays done (holiday-adjusted, may be fractional) and in the month. */
  workdaysDone: number;
  workdays: number;
  /** Not started yet: all of it is estimate. */
  upcoming: boolean;
}

/** Estimates use the Plan's costs as they are (Nitsan, 2026-11-18: the 1.15
 * uplift on unfinished months was dropped). Kept as a constant so it can come back. */
export const PLAN_COST_UPLIFT = 1;

/** The current year's unfinished months by month number; empty for any other year. */
export type Projections = Map<number, MonthProjection>;

/** Sun–Thu days in a month, and how many of them fall before `beforeDay`. */
export function studioWeekdays(year: number, month: number, beforeDay = 32): { total: number; before: number } {
  const days = new Date(year, month, 0).getDate();
  let total = 0;
  let before = 0;
  for (let d = 1; d <= days; d++) {
    if (new Date(year, month - 1, d).getDay() > 4) continue; // Fri, Sat
    total++;
    if (d < beforeDay) before++;
  }
  return { total, before };
}

function monthVals(pnl: PnlMonthly[], year: number, month: number): Map<string, number> {
  const vals = new Map<string, number>();
  for (const r of pnl) if (r.year === year && r.month === month) vals.set(r.lineItem, r.value);
  return vals;
}

const hourlyIncomeOf = (m: Map<string, number>) =>
  m.get(LINE.hoursIncome) ?? (m.get(LINE.totalRevenues) ?? 0) - (m.get(LINE.projectIncome) ?? 0);

/** The sheet's workdays for a month (holidays out), else its Sun–Thu days. */
const workdaysOf = (vals: Map<string, number>, year: number, month: number) =>
  vals.get(LINE.daysInMonth) || studioWeekdays(year, month).total;

/** The (year, month) `back` months before (year, month). */
export function monthsBack(year: number, month: number, back: number): [number, number] {
  const i = year * 12 + (month - 1) - back;
  return [Math.floor(i / 12), (i % 12) + 1];
}

/**
 * The month in progress, as the Plan has it. Since 2026-11-10 the P&L's hours
 * and income come from the PLAN, which holds the whole month (what's been
 * approved or typed), not a "so far" figure — so extrapolating on top of it
 * counted the rest of the month twice (Nitsan, 2026-11-18: chart said ₪101K
 * profit for November, the Plan ₪17.8K). The month is read as it stands.
 */
export function projectCurrentMonth(pnl: PnlMonthly[], year: number, today = new Date()): MonthProjection | null {
  if (year !== today.getFullYear()) return null;
  const month = today.getMonth() + 1;
  const cur = monthVals(pnl, year, month);
  if (!cur.has(LINE.totalExpenses)) return null;

  const week = studioWeekdays(year, month, today.getDate() + 1);
  const workdays = cur.get(LINE.daysInMonth) || week.total;
  const workdaysDone = Math.min(workdays, (week.before * workdays) / week.total);
  const hourlyIncome = hourlyIncomeOf(cur);
  const revenue = cur.get(LINE.totalRevenues) ?? hourlyIncome + (cur.get(LINE.projectIncome) ?? 0);
  const expenses = (cur.get(LINE.totalExpenses) ?? 0) * PLAN_COST_UPLIFT;
  const hours = cur.get(LINE.totalHours) ?? 0;
  return {
    month,
    revenue,
    hours,
    hourlyIncome,
    expenses,
    profit: revenue - expenses,
    margin: revenue ? (revenue - expenses) / revenue : 0,
    soFarRevenue: revenue,
    soFarHours: hours,
    workdaysDone,
    workdays,
    upcoming: false,
  };
}

/**
 * Every unfinished month of the current year, estimated in full: the month in
 * progress (projectCurrentMonth), and the months still to come at the last
 * three booked months' pace per workday, against their planned costs.
 */
export function projectMonths(pnl: PnlMonthly[], year: number, today = new Date()): Projections {
  const out: Projections = new Map();
  const current = projectCurrentMonth(pnl, year, today);
  if (!current) return out;
  out.set(current.month, current);

  const recent = [1, 2, 3].map((b) => {
    const [y, m] = monthsBack(year, current.month, b);
    const vals = monthVals(pnl, y, m);
    return { vals, days: workdaysOf(vals, y, m) };
  });
  const days = recent.reduce((t, r) => t + r.days, 0);
  const perDay = (pick: (v: Map<string, number>) => number) =>
    days ? recent.reduce((t, r) => t + pick(r.vals), 0) / days : 0;
  const incomePace = perDay(hourlyIncomeOf);
  const hoursPace = perDay((v) => v.get(LINE.totalHours) ?? 0);

  for (let m = current.month + 1; m <= 12; m++) {
    const vals = monthVals(pnl, year, m);
    const workdays = workdaysOf(vals, year, m);
    const revenue = incomePace * workdays;
    const expenses = (vals.get(LINE.totalExpenses) ?? 0) * PLAN_COST_UPLIFT;
    out.set(m, {
      month: m,
      revenue,
      hours: hoursPace * workdays,
      hourlyIncome: revenue,
      expenses,
      profit: revenue - expenses,
      margin: revenue ? (revenue - expenses) / revenue : 0,
      soFarRevenue: 0,
      soFarHours: 0,
      workdaysDone: 0,
      workdays,
      upcoming: true,
    });
  }
  return out;
}

// ── This month's hours goal ─────────────────────────────────────────────────
// ONE copy for the whole app: lib/hours-goal.ts. This file used to carry a
// line-for-line mirror of it ("change in both"); re-exported here so finance's
// own imports keep working.
export {
  DAY_LOGGED_AT,
  STUDIO_WEEK_DAYS,
  TARGET_MARGIN,
  hoursGoal,
  studioDayLogged,
  type AbsentByDate,
  type FormulaFreelancer,
  type FreelanceForecast,
  type GoalDay,
  type GoalFreelancer,
  type GoalInputs,
  type GoalLevel,
  type HoursGoal,
} from "@/lib/hours-goal";

// ── Monthly series (when a single year is selected) ──────────────────────────
interface MonthCells {
  vals: Map<string, number>;
  revenueIsPredicted: boolean;
  hasAnyRow: boolean;
}

/** Bucket a year's pnl rows by month. One row per (month, line_item). */
function monthCells(pnl: PnlMonthly[], year: number): MonthCells[] {
  const cells: MonthCells[] = Array.from({ length: 12 }, () => ({
    vals: new Map(),
    revenueIsPredicted: false,
    hasAnyRow: false,
  }));
  for (const r of pnl) {
    if (r.year !== year) continue;
    const c = cells[r.month - 1];
    c.vals.set(r.lineItem, r.value);
    c.hasAnyRow = true;
    if (r.lineItem === LINE.totalRevenues && isForecast(r.state)) c.revenueIsPredicted = true;
  }
  return cells;
}

/** The current year estimated to its end: its booked months as they are,
 * plus every unfinished month's estimate (projectMonths). */
export interface YearProjection {
  revenue: number;
  profit: number;
  margin: number;
  /** What the booked months brought in. */
  booked: number;
  note: string;
}

export function projectYear(pnl: PnlMonthly[], year: number, today = new Date()): YearProjection | null {
  const projections = projectMonths(pnl, year, today);
  if (projections.size === 0) return null;
  const cells = monthCells(pnl, year);
  let booked = 0;
  let revenue = 0;
  let expenses = 0;
  for (let m = 1; m <= 12; m++) {
    const p = projections.get(m);
    if (p) {
      revenue += p.revenue;
      expenses += p.expenses;
    } else {
      booked += cells[m - 1].vals.get(LINE.totalRevenues) ?? 0;
      expenses += cells[m - 1].vals.get(LINE.totalExpenses) ?? 0;
    }
  }
  revenue += booked;
  const profit = revenue - expenses;
  const firstOpen = Math.min(...projections.keys());
  return {
    revenue,
    profit,
    margin: revenue ? profit / revenue : 0,
    booked,
    note: firstOpen > 1
      ? `${formatILSShort(booked)} booked Jan–${MONTH_SHORT[firstOpen - 2]} · ${MONTH_SHORT[firstOpen - 1]}–Dec estimated`
      : "Jan–Dec estimated",
  };
}

/** What an estimate stands on: "₪7.9K so far · 1 of 18 workdays", or for a
 * month not started, the pace it's at. */
export function projectionNote(p: MonthProjection): string {
  if (p.upcoming) return `Estimated at the last 3 months' pace · ${p.workdays} workdays`;
  return `${formatILSShort(p.revenue)} as in the Plan · ${p.workdays} workdays`;
}

/** 12-month revenue + margin points for the trend chart. Unfinished months
 * show their estimated full month. */
export function buildMonthlyTrend(pnl: PnlMonthly[], year: number, proj?: Projections): TrendPoint[] {
  return monthCells(pnl, year).map((c, i) => {
    const p = proj?.get(i + 1);
    if (p)
      return {
        year: i + 1,
        label: MONTH_SHORT[i],
        revenue: p.revenue,
        margin: p.margin,
        partial: true,
        estimate: { soFar: p.soFarRevenue, note: projectionNote(p) },
      };
    const revenue = c.vals.get(LINE.totalRevenues) ?? 0;
    const profit = c.vals.get(LINE.profit) ?? 0;
    return {
      year: i + 1,
      label: MONTH_SHORT[i],
      revenue,
      margin: revenue ? profit / revenue : 0,
      partial: c.revenueIsPredicted,
    };
  });
}

/** 12-month total-expenses points, for the "Expenses" trend chart —
 * unfinished months at their estimated costs. A month is "still a plan" by
 * `isForecastMonth` alone, as for the Expenses tile (sumLine): the chart's
 * "so far" headline sums the other months, and it used to drop a finished
 * month whose revenue row was still `predicted`, so the two disagreed. */
export function buildMonthlyExpenses(pnl: PnlMonthly[], year: number, proj?: Projections): MonthPoint[] {
  return monthCells(pnl, year).map((c, i) => ({
    label: MONTH_SHORT[i],
    value: proj?.get(i + 1)?.expenses ?? c.vals.get(LINE.totalExpenses) ?? 0,
    future: isForecastMonth(year, i + 1),
  }));
}

/** 12-month cost structure (share of revenue) — unfinished months against
 * their estimated revenue. */
export function buildMonthlyCost(pnl: PnlMonthly[], year: number, proj?: Projections): CostYear[] {
  return monthCells(pnl, year).map((c, i) => {
    const p = proj?.get(i + 1);
    const revenue = p ? p.revenue : (c.vals.get(LINE.totalRevenues) ?? 0);
    const uplift = p ? PLAN_COST_UPLIFT : 1;
    const f = (line: string) => (revenue ? ((c.vals.get(line) ?? 0) * uplift) / revenue : 0);
    return {
      year: MONTH_SHORT[i],
      partial: c.revenueIsPredicted,
      estimate: !!p,
      salaries: f(LINE.salaries),
      freelance: f(LINE.freelance),
      rent: f(LINE.rentExpenses),
      other: f(LINE.expensesOther),
    };
  });
}

/** 12-month average rate (revenue ÷ hours); unfinished months at their estimate. */
export function buildMonthlyRate(pnl: PnlMonthly[], year: number, proj?: Projections): RatePoint[] {
  return monthCells(pnl, year)
    .map((c, i) => {
      const p = proj?.get(i + 1);
      if (p) return { year: MONTH_SHORT[i], rate: p.hours ? p.hourlyIncome / p.hours : 0, partial: true, estimate: true };
      const revenue = c.vals.get(LINE.totalRevenues) ?? 0;
      const hours = c.vals.get(LINE.totalHours) ?? 0;
      // Hours income only, like the yearly rate — a project fee isn't an hourly rate.
      const hoursIncome = c.vals.get(LINE.hoursIncome) || revenue - (c.vals.get(LINE.projectIncome) ?? 0);
      return { year: MONTH_SHORT[i], rate: hours ? hoursIncome / hours : 0, partial: c.revenueIsPredicted };
    })
    .filter((p) => p.rate > 0);
}

/** 12-month utilization (hours vs capacity). Only months with capacity data. */
export function buildMonthlyUtilization(pnl: PnlMonthly[], year: number, proj?: Projections): UtilizationPoint[] {
  return monthCells(pnl, year)
    .map((c, i) => {
      const p = proj?.get(i + 1);
      return {
        year: MONTH_SHORT[i],
        partial: c.revenueIsPredicted,
        estimate: !!p,
        hours: p ? p.hours : (c.vals.get(LINE.totalHours) ?? 0),
        maxHours: c.vals.get(LINE.maxHours) ?? 0,
      };
    })
    .filter((p) => p.maxHours > 0);
}

export function buildBreakEven(pnl: PnlMonthly[], year: number, proj?: Projections): BreakEvenMonth[] {
  const byMonth = new Map<number, { hours: number; min: number | null; future: boolean }>();
  for (const r of pnl) {
    if (r.year !== year) continue;
    const m = byMonth.get(r.month) ?? { hours: 0, min: null, future: false };
    if (r.lineItem === LINE.totalHours) {
      m.hours = r.value;
      m.future = isForecast(r.state);
    }
    // A break-even of 0 means none was worked out for that month, not zero hours.
    if (r.lineItem === LINE.minHoursBE && r.value > 0) m.min = r.value;
    byMonth.set(r.month, m);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([month, v]) => {
      const p = proj?.get(month);
      if (!p) return { month, hours: v.hours, minHours: v.min, future: v.future };
      // Its break-even moves with the estimated costs.
      const minHours = v.min != null ? v.min * PLAN_COST_UPLIFT : null;
      return { month, hours: p.hours, minHours, soFar: p.upcoming ? undefined : p.soFarHours, future: true };
    });
}

export interface ClientYearTotal {
  clientCanon: string;
  discipline: string | null;
  hours: number;
  revenue: number;
}

export function topClientsForYear(
  clientMonthly: ClientMonthly[],
  year: number | null,
  discipline?: string | null,
): { clients: ClientYearTotal[]; totalRevenue: number; top1Share: number; top3Share: number } {
  const acc = new Map<string, ClientYearTotal>();
  for (const r of clientMonthly) {
    if (year !== null && r.year !== year) continue;
    if (discipline && r.discipline !== discipline) continue;
    if (r.clientCanon === NON_BILLABLE_CLIENT_CANON) continue;
    const cur = acc.get(r.clientCanon) ?? {
      clientCanon: r.clientCanon,
      discipline: r.discipline,
      hours: 0,
      revenue: 0,
    };
    cur.hours += r.hours;
    cur.revenue += r.revenueGross;
    acc.set(r.clientCanon, cur);
  }
  const clients = [...acc.values()].sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = clients.reduce((s, c) => s + c.revenue, 0);
  const top1 = clients[0]?.revenue ?? 0;
  const top3 = clients.slice(0, 3).reduce((s, c) => s + c.revenue, 0);
  return {
    clients,
    totalRevenue,
    top1Share: totalRevenue ? top1 / totalRevenue : 0,
    top3Share: totalRevenue ? top3 / totalRevenue : 0,
  };
}

/** Top-N clients by revenue as pie slices; the rest folded into "Others". */
export function clientPieSlices(clients: ClientYearTotal[], topN = 8): PieSlice[] {
  const slices: PieSlice[] = clients
    .slice(0, topN)
    .map((c) => ({ label: c.clientCanon, value: c.revenue }));
  const rest = clients.slice(topN).reduce((s, c) => s + c.revenue, 0);
  if (rest > 0) slices.push({ label: `Others (${clients.length - topN})`, value: rest });
  return slices;
}

export interface VendorYearTotal {
  vendor: string;
  amount: number;
}

/**
 * What a row paid, month by month, net ILS. A monthly row is one subscription
 * running from its date to its end date (or still running), so it pays every
 * month of that — as the P&L counts it (finance.ts rollupCurrentYear), each
 * month at that month's FX rate — up to the last finished month
 * (`isForecastMonth`). Every other row pays once, at its date. (Before
 * 2026-11-09 the vendor views counted a monthly row once, at its first month.)
 */
export function paidByMonth(r: ExpenseRowDb, fx?: FxTable): { year: number; month: number; amount: number }[] {
  const y = Number(r.date.slice(0, 4));
  const m = Number(r.date.slice(5, 7));
  if (r.category !== "monthly") return [{ year: y, month: m, amount: expenseNetIls(r, y, { table: fx, month: m }) }];
  const end = r.end_date ? Number(r.end_date.slice(0, 4)) * 12 + Number(r.end_date.slice(5, 7)) - 1 : Infinity;
  const out: { year: number; month: number; amount: number }[] = [];
  for (let abs = y * 12 + m - 1; abs <= end; abs++) {
    const year = Math.floor(abs / 12);
    const month = (abs % 12) + 1;
    if (isForecastMonth(year, month)) break;
    out.push({ year, month, amount: expenseNetIls(r, year, { table: fx, month }) });
  }
  return out;
}

/** Top vendors by net-ILS spend for a year (or all years when `year` is
 * null) across every expense category — the "who do we pay the most"
 * counterpart to topClientsForYear. */
export function topVendorsForYear(
  expenses: ExpenseRowDb[],
  year: number | null,
  fx?: FxTable,
): { vendors: VendorYearTotal[]; totalAmount: number; top1Share: number; top3Share: number } {
  const acc = new Map<string, number>();
  for (const r of expenses) {
    const vendor = r.vendor.trim() || "(no vendor)";
    for (const p of paidByMonth(r, fx)) {
      if (year !== null && p.year !== year) continue;
      acc.set(vendor, (acc.get(vendor) ?? 0) + p.amount);
    }
  }
  const vendors = [...acc.entries()]
    .map(([vendor, amount]) => ({ vendor, amount }))
    .filter((v) => v.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const totalAmount = vendors.reduce((s, v) => s + v.amount, 0);
  const top1 = vendors[0]?.amount ?? 0;
  const top3 = vendors.slice(0, 3).reduce((s, v) => s + v.amount, 0);
  return {
    vendors,
    totalAmount,
    top1Share: totalAmount ? top1 / totalAmount : 0,
    top3Share: totalAmount ? top3 / totalAmount : 0,
  };
}

/** Top-N vendors by spend as pie slices; the rest folded into "Others". */
export function vendorPieSlices(vendors: VendorYearTotal[], topN = 8): PieSlice[] {
  const slices: PieSlice[] = vendors
    .slice(0, topN)
    .map((v) => ({ label: v.vendor, value: v.amount }));
  const rest = vendors.slice(topN).reduce((s, v) => s + v.amount, 0);
  if (rest > 0) slices.push({ label: `Others (${vendors.length - topN})`, value: rest });
  return slices;
}
