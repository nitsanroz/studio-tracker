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
import { billFor, type RateTerms } from "@/lib/finance/freelance-rate";
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

/** The Plan's cost figures for months not finished yet run light: Nitsan
 * expects real costs 10–20% above them, so estimates take the middle. */
export const PLAN_COST_UPLIFT = 1.15;

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
 * Estimate the current month's full-month figures. Work goes on at a daily pace
 * that blends this month's pace so far with last month's, leaning on this month
 * as more of its workdays pass; the workdays left are filled at that pace.
 */
export function projectCurrentMonth(pnl: PnlMonthly[], year: number, today = new Date()): MonthProjection | null {
  if (year !== today.getFullYear()) return null;
  const month = today.getMonth() + 1;
  const [prevYear, prevMonth] = monthsBack(year, month, 1);
  const cur = monthVals(pnl, year, month);
  const prev = monthVals(pnl, prevYear, prevMonth);
  if (!cur.has(LINE.totalExpenses)) return null;

  // Today counts as done: its hours are already logging in.
  const week = studioWeekdays(year, month, today.getDate() + 1);
  const workdays = cur.get(LINE.daysInMonth) || week.total;
  const workdaysDone = Math.min(workdays, (week.before * workdays) / week.total);
  const prevWorkdays = workdaysOf(prev, prevYear, prevMonth);

  const soFarHours = cur.get(LINE.totalHours) ?? 0;
  const soFarIncome = hourlyIncomeOf(cur);
  const projectIncome = cur.get(LINE.projectIncome) ?? 0;
  const w = workdaysDone / workdays;
  const left = workdays - workdaysDone;
  const pace = (soFar: number, last: number) =>
    (workdaysDone > 0 ? (soFar / workdaysDone) * w : 0) + (last / prevWorkdays) * (1 - w);
  const hours = soFarHours + left * pace(soFarHours, prev.get(LINE.totalHours) ?? 0);
  const hourlyIncome = soFarIncome + left * pace(soFarIncome, hourlyIncomeOf(prev));
  const revenue = hourlyIncome + projectIncome;
  const expenses = (cur.get(LINE.totalExpenses) ?? 0) * PLAN_COST_UPLIFT;
  return {
    month,
    revenue,
    hours,
    hourlyIncome,
    expenses,
    profit: revenue - expenses,
    margin: revenue ? (revenue - expenses) / revenue : 0,
    soFarRevenue: soFarIncome + projectIncome,
    soFarHours,
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
/** Designers away on each day of a month, from the tracker's weekly plan
 * ("2026-10-18" → 1). */
export type AbsentByDate = Record<string, number>;

/** A freelancer paid by the hours they log in the tracker (Dima): their pay
 * and hours in the 3 months before, hours so far, and their own days away. */
export interface GoalFreelancer {
  name: string;
  /** This month's planned amount. */
  planned: number;
  recent: { year: number; month: number; hours: number; pay: number }[];
  soFar: number;
  absent: string[];
  /** Their sliding rate, if they're on one (HOURLY_TERMS): the month is priced
   * through it instead of at their recent ₪/hour. */
  terms?: RateTerms;
}

// HOURLY_TERMS (an hourly freelancer's sliding ₪ rate, by profile id) is not
// here any more: this file is imported by client pages, and the rate must not
// ship in their JavaScript. One copy, server only — lib/finance/hourly-terms.ts.

/** A freelancer billed on a sliding rate through the tracker (AB, Milica,
 * Dima): their hours come from the tracker, their price from their terms —
 * not from past pay. */
export interface FormulaFreelancer {
  /** Their tracker profile — a finance row tied to it isn't costed twice. */
  profileId?: string;
  name: string;
  /** This month's planned amount in the finance plan, ₪. */
  planned: number;
  terms: RateTerms;
  /** ₪ per unit of his currency — the official rate, as finance books him. */
  fx: number;
  /** Hours logged so far this month (link logs not turned down, or a login's time entries). */
  soFar: number;
  /** Extra charges so far this month, in his currency (another freelancer he brought in). */
  charges: number;
  /** Hours in each of the 3 months before. */
  recent: { year: number; month: number; hours: number }[];
  absent: string[];
}

/** Tracker facts the goal reads (getGoalInputs). */
export interface GoalInputs {
  absent: AbsentByDate;
  /** Who's away and when — for naming them in the goal. */
  away: { name: string; dates: string[] }[];
  freelancers: GoalFreelancer[];
  formulaFreelancers?: FormulaFreelancer[];
  /** Of the month's billable hours so far, those dated today — the pace leaves
   * them out until the day counts. The tracker passes them as an option instead. */
  hoursToday?: number;
}

/** An hourly freelancer's month, costed at what they've logged instead of the plan. */
export interface FreelanceForecast {
  name: string;
  planned: number;
  /** Hours logged so far this month — no guess at the rest (Nitsan, 2026-11-02). */
  hours: number;
  soFar: number;
  /** ₪ an hour: their sliding rate at these hours, else their recent pay ÷ hours. */
  rate: number;
  cost: number;
}

/** One Sun–Thu day of the month and how much of a full workday it can carry. */
export interface GoalDay {
  date: string;
  /** Designers away that day (weekly plan). */
  absent: number;
  /** Share of a full-team workday: holidays spread over the month (the
   * sheet's workdays ÷ Sun–Thu days), less the designers away. */
  weight: number;
}

/** One level of the hours goal — break-even, or a profit target. Daily and
 * weekly figures are for a full-team workday; a day with designers away
 * needs proportionally less (see `days`). */
export interface GoalLevel {
  hours: number;
  perDay: number;
  perWeek: number;
  expectedByNow: number;
  neededPerDay: number | null;
}

/** The billable hours the month in progress needs to cover its costs, as a
 * daily and weekly target, and how the month is doing against it. */
export interface HoursGoal extends GoalLevel {
  month: number;
  /** The month's costs: as planned, with hourly freelancers at what they've logged. */
  costs: number;
  /** The month's costs exactly as entered in the Plan. */
  plannedCosts: number;
  /** Hourly freelancers costed at what they've logged (their planned amount swapped out). */
  freelance: FreelanceForecast[];
  /** Fixed-fee project income booked for the month — it covers part of the
   * costs, so the hours only need to cover the rest. */
  projectIncome: number;
  /** ₪/hour the goal is priced at: the last 3 months' hourly income ÷ hours.
   * The month's own rate isn't used — early in a month it rests on a few
   * days, and a month not started has none. */
  rate: number;
  /** Months the rate was averaged over, oldest first. */
  rateMonths: { year: number; month: number }[];
  /** The month's workdays (holidays out). */
  workdays: number;
  /** Designers in the team this month (the sheet's count, may be fractional). */
  team: number;
  /** Designer-days away in the month, from the weekly plan. */
  absentDays: number;
  /** Who's away on the month's workdays, and on which. */
  away: { name: string; dates: string[] }[];
  /** Workdays in full-team terms: the month's workdays less the absences. */
  effectiveWorkdays: number;
  days: GoalDay[];
  soFar: number;
  /** Workdays before today (holiday-adjusted, may be fractional). */
  workdaysDone: number;
  /** Workdays from today to the month's end, today included. */
  workdaysLeft: number;
  /** The average logged per full-team workday so far, over the days whose
   * hours are in: today joins only once it's logged (`todayCounted`). Null
   * before the first such day. */
  actualPerDay: number | null;
  /** Whether today is in `actualPerDay` — the studio logs at the end of the
   * day, so before 17:30 today would only drag the average down. */
  todayCounted: boolean;
  /** The same targets for a month that also makes `margin` profit: revenue
   * of costs ÷ (1 − margin), in hours at the same rate. */
  profit: GoalLevel & { margin: number };
}

export const STUDIO_WEEK_DAYS = 5;
/** When the studio's day counts as logged: hours go in around 17:30. */
export const DAY_LOGGED_AT = { hour: 17, minute: 30 };

const STUDIO_CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Whether today's hours are in yet: past 17:30 in Tel Aviv, whatever the
 * server's or browser's own zone. */
export function studioDayLogged(now = new Date()): boolean {
  const [h, m] = STUDIO_CLOCK.format(now).split(":").map(Number);
  return h * 60 + m >= DAY_LOGGED_AT.hour * 60 + DAY_LOGGED_AT.minute;
}
/** The profit margin the hours goal aims for above break-even. */
export const TARGET_MARGIN = 0.15;

const isoDate = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function hoursGoal(
  pnl: PnlMonthly[],
  year: number,
  today = new Date(),
  {
    margin = TARGET_MARGIN,
    inputs,
    todayLogged = false,
    hoursToday = inputs?.hoursToday ?? 0,
  }: {
    margin?: number;
    inputs?: GoalInputs;
    /** Today's hours are in (studioDayLogged): today counts toward the pace. */
    todayLogged?: boolean;
    /** Of the month's hours so far, those dated today — left out of the pace
     * until today counts. */
    hoursToday?: number;
  } = {},
): HoursGoal | null {
  if (year !== today.getFullYear()) return null;
  const month = today.getMonth() + 1;
  const cur = monthVals(pnl, year, month);
  const plannedCosts = cur.get(LINE.totalExpenses) ?? 0;
  if (plannedCosts <= 0) return null;
  const absent = inputs?.absent ?? {};

  const rateMonths = [3, 2, 1].map((b) => {
    const [y, m] = monthsBack(year, month, b);
    return { year: y, month: m };
  });
  let income = 0;
  let hrs = 0;
  for (const { year: y, month: m } of rateMonths) {
    const vals = monthVals(pnl, y, m);
    income += hourlyIncomeOf(vals);
    hrs += vals.get(LINE.totalHours) ?? 0;
  }
  const rate = hrs ? income / hrs : 0;
  if (rate <= 0) return null;

  // Each Sun–Thu day carries a share of a full-team workday: the sheet's
  // holiday-adjusted workdays spread evenly, less the designers away.
  const sunThu = studioWeekdays(year, month).total;
  const workdays = cur.get(LINE.daysInMonth) || sunThu;
  const scale = workdays / sunThu;
  const team = cur.get(LINE.numDesigners) ?? 0;
  const days: GoalDay[] = [];
  let absentDays = 0;
  for (let d = 1; d <= new Date(year, month, 0).getDate(); d++) {
    if (new Date(year, month - 1, d).getDay() > 4) continue; // Fri, Sat
    const date = isoDate(year, month, d);
    const away = team > 0 ? Math.min(team, absent[date] ?? 0) : 0;
    absentDays += away * scale;
    days.push({ date, absent: away, weight: scale * (team > 0 ? 1 - away / team : 1) });
  }
  const todayIso = isoDate(year, month, today.getDate());
  const sumWeight = (pick: (d: GoalDay) => boolean) => days.reduce((t, d) => (pick(d) ? t + d.weight : t), 0);
  const effectiveWorkdays = sumWeight(() => true);
  // Today isn't done yet: it's still in the days left to make up the hours.
  const doneWeight = sumWeight((d) => d.date < todayIso);
  const leftWeight = effectiveWorkdays - doneWeight;
  const throughToday = sumWeight((d) => d.date <= todayIso);
  const workdaysDone = days.filter((d) => d.date < todayIso).length * scale;

  // Hourly freelancers cost what they've LOGGED so far this month, nothing
  // more: they work when there's work, so a projection booked AB and Milica
  // for a month they hadn't started (Nitsan, 2026-11-02). Their planned amount
  // is swapped out, so the goal rises as they log. Priced through their sliding
  // rate if they have one, else at their recent ₪/hour.
  const freelance: FreelanceForecast[] = [];
  for (const f of inputs?.freelancers ?? []) {
    const hoursBefore = f.recent.reduce((t, r) => t + r.hours, 0);
    const payBefore = f.recent.reduce((t, r) => t + r.pay, 0);
    if (!f.terms && (hoursBefore <= 0 || payBefore <= 0)) continue;
    const hours = f.soFar;
    const cost = f.terms ? billFor(hours, f.terms) : (hours * payBefore) / hoursBefore;
    freelance.push({ name: f.name, planned: f.planned, hours, soFar: f.soFar, rate: hours ? cost / hours : 0, cost });
  }
  // Sliding-rate freelancers kept in the tracker (AB, Milica, Dima): the same —
  // what they've logged, through their terms, plus their extra charges, in ₪.
  for (const f of inputs?.formulaFreelancers ?? []) {
    const hours = f.soFar;
    const cost = (billFor(hours, f.terms) + f.charges) * f.fx;
    freelance.push({ name: f.name, planned: f.planned, hours, soFar: f.soFar, rate: hours ? cost / hours : 0, cost });
  }
  const costs = plannedCosts + freelance.reduce((t, f) => t + f.cost - f.planned, 0);

  const projectIncome = cur.get(LINE.projectIncome) ?? 0;
  const soFar = cur.get(LINE.totalHours) ?? 0;
  const level = (target: number): GoalLevel => {
    const perDay = effectiveWorkdays ? target / effectiveWorkdays : 0;
    const remaining = Math.max(0, target - soFar);
    return {
      hours: target,
      perDay,
      perWeek: perDay * STUDIO_WEEK_DAYS,
      expectedByNow: perDay * doneWeight,
      neededPerDay: remaining === 0 ? 0 : leftWeight > 0 ? remaining / leftWeight : null,
    };
  };
  const profitRevenue = costs / (1 - margin);
  return {
    ...level(Math.max(0, costs - projectIncome) / rate),
    month,
    costs,
    plannedCosts,
    freelance,
    projectIncome,
    rate,
    rateMonths,
    workdays,
    team,
    absentDays,
    away: (inputs?.away ?? [])
      .map((a) => ({ name: a.name, dates: a.dates.filter((d) => days.some((x) => x.date === d)) }))
      .filter((a) => a.dates.length > 0),
    effectiveWorkdays,
    days,
    soFar,
    workdaysDone,
    workdaysLeft: workdays - workdaysDone,
    actualPerDay: todayLogged
      ? throughToday > 0
        ? soFar / throughToday
        : null
      : doneWeight > 0
        ? Math.max(0, soFar - hoursToday) / doneWeight
        : null,
    todayCounted: todayLogged,
    profit: { ...level(Math.max(0, profitRevenue - projectIncome) / rate), margin },
  };
}

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
  const done = Math.round(p.workdaysDone * 10) / 10;
  return `${formatILSShort(p.soFarRevenue)} so far · ${done} of ${p.workdays} workdays`;
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
