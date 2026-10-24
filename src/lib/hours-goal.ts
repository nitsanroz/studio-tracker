// ⚠️ A MIRROR of finance-admin's hours goal (~/Documents/Claude/finance-admin,
// `hoursGoal` and its helpers in src/lib/overview.ts). Copied, not shared: the
// tracker must not depend on the finance app at runtime. Keep the two in step —
// a change to how the goal is worked out goes in BOTH, with the same tests
// (hours-goal.test.ts here mirrors the hoursGoal block of overview.test.ts there).
// The finance P&L rows it reads are fetched server-side by /api/hours-goal,
// which returns hours only — never ₪ — because tracker admins without finance
// access (Michal) see the result.

import { billFor, type RateTerms } from "./freelance-rate";

/** One finance_pnl_monthly row, as the goal reads it. */
export interface PnlMonthly {
  year: number;
  month: number;
  lineItem: string;
  value: number;
}

/** The finance P&L line items the goal reads (finance-admin's LINE). */
export const LINE = {
  totalRevenues: "total_revenues",
  totalExpenses: "total_expenses",
  totalHours: "total_hours",
  hoursIncome: "total_hours_income",
  projectIncome: "total_project_income",
  numDesigners: "num_designers",
  daysInMonth: "days_in_month",
} as const;

/** Sun–Thu days in a month, and how many of them fall before `beforeDay`. */
function studioWeekdays(year: number, month: number, beforeDay = 32): { total: number; before: number } {
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
function monthsBack(year: number, month: number, back: number): [number, number] {
  const i = year * 12 + (month - 1) - back;
  return [Math.floor(i / 12), (i % 12) + 1];
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

/** Hourly freelancers on a sliding ₪ rate, by tracker profile id. Dima:
 * ₪140/h up to 50h a month, down in a straight line to ₪100/h at 150h
 * (his sheet: =IF(h<=50, 140, IF(h>=150, 100, 140 - (h - 50) * 0.4))). */
export const HOURLY_TERMS: Record<string, RateTerms> = {
  "945eacad-3d33-4a69-b4a4-40b6f5c9ce8b": { currency: "ILS", rateHigh: 140, rateLow: 100, hoursLow: 50, hoursHigh: 150 },
};

/** Tracker facts the goal reads (getGoalInputs). */
/** A freelancer billed on a sliding rate through the tracker (AB): his hours
 * come from his tracker logs, his price from his terms — not from past pay. */
export interface FormulaFreelancer {
  name: string;
  /** This month's planned amount in the finance plan, ₪. */
  planned: number;
  terms: RateTerms;
  /** ₪ per unit of his currency — the official rate, as finance books him. */
  fx: number;
  /** Hours logged so far this month (not turned down). */
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
}

/** An hourly freelancer's month, costed at their pace instead of the plan. */
export interface FreelanceForecast {
  name: string;
  planned: number;
  /** Hours so far + their usual hours a workday over the workdays left they're in. */
  hours: number;
  soFar: number;
  /** Their recent pay ÷ hours. */
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
  /** The month's costs: as planned, with hourly freelancers at their pace. */
  costs: number;
  /** The month's costs exactly as entered in the Plan. */
  plannedCosts: number;
  /** Hourly freelancers costed at their pace (their planned amount swapped out). */
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
  /** The average logged per full-team workday so far — today counted, since
   * its hours are already logging in. Null before the first workday. */
  actualPerDay: number | null;
  /** The same targets for a month that also makes `margin` profit: revenue
   * of costs ÷ (1 − margin), in hours at the same rate. */
  profit: GoalLevel & { margin: number };
}

export const STUDIO_WEEK_DAYS = 5;
/** The profit margin the hours goal aims for above break-even. */
export const TARGET_MARGIN = 0.15;

const isoDate = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function hoursGoal(
  pnl: PnlMonthly[],
  year: number,
  today = new Date(),
  { margin = TARGET_MARGIN, inputs }: { margin?: number; inputs?: GoalInputs } = {},
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

  // Hourly freelancers: what they've logged, plus their usual hours a workday
  // over the workdays left that they're in — through their sliding rate if
  // they have one, else at their recent ₪/hour.
  const freelance: FreelanceForecast[] = [];
  for (const f of inputs?.freelancers ?? []) {
    const hoursBefore = f.recent.reduce((t, r) => t + r.hours, 0);
    const payBefore = f.recent.reduce((t, r) => t + r.pay, 0);
    if (hoursBefore <= 0 || (payBefore <= 0 && !f.terms)) continue;
    const daysBefore = f.recent.reduce((t, r) => t + workdaysOf(monthVals(pnl, r.year, r.month), r.year, r.month), 0);
    const away = new Set(f.absent);
    const daysLeft = days.filter((d) => d.date >= todayIso && !away.has(d.date)).length * scale;
    const hours = f.soFar + (hoursBefore / daysBefore) * daysLeft;
    const cost = f.terms ? billFor(hours, f.terms) : (hours * payBefore) / hoursBefore;
    freelance.push({ name: f.name, planned: f.planned, hours, soFar: f.soFar, rate: hours ? cost / hours : 0, cost });
  }
  // Sliding-rate freelancers (AB): the same pace — what he's logged plus his
  // usual hours a workday over the days left — priced through his terms (the
  // more hours, the lower the rate), plus his extra charges, in ₪.
  for (const f of inputs?.formulaFreelancers ?? []) {
    const hoursBefore = f.recent.reduce((t, r) => t + r.hours, 0);
    const daysBefore = f.recent.reduce((t, r) => t + workdaysOf(monthVals(pnl, r.year, r.month), r.year, r.month), 0);
    const away = new Set(f.absent);
    const daysLeft = days.filter((d) => d.date >= todayIso && !away.has(d.date)).length * scale;
    const hours = f.soFar + (daysBefore ? hoursBefore / daysBefore : 0) * daysLeft;
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
    actualPerDay: throughToday > 0 ? soFar / throughToday : null,
    profit: { ...level(Math.max(0, profitRevenue - projectIncome) / rate), margin },
  };
}

/**
 * The share of a month's goal that's "due" by each day: the goal spread evenly
 * over the month's Sun–Thu days, a day counting once it has started. Home's pace
 * chart draws this line and &advice reads its value for today — one copy, so the
 * pane's "93%" and Home's "7% behind goal pace" can't drift apart.
 */
export function evenSpread(days: string[]): number[] {
  const isWork = days.map((d) => {
    const [y, m, dd] = d.split("-").map(Number);
    return new Date(y, m - 1, dd).getDay() <= 4;
  });
  const total = isWork.filter(Boolean).length || 1;
  let n = 0;
  return isWork.map((w) => (n += w ? 1 : 0) / total);
}
