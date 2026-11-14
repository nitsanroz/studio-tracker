import { LINE, NON_BILLABLE_CLIENT_CANON, rateForMonth, type ClientRate, type PnlMonthly } from "@/lib/finance/finance";
import { formatILS, formatNum, formatPct } from "@/lib/finance/format";
import { TARGET_MARGIN, studioWeekdays } from "@/lib/finance/overview";
import type { RateTerms } from "@/lib/finance/freelance-rate";

// One person = one tracker `profiles` row. Finance knows what they cost
// (salary + freelance, linked by profile_id); the tracker knows what they
// worked (time entries on client tasks). Set side by side, that's what a
// person costs against the work their hours brought in.

/** What someone does — it decides whether their logged hours are their own work. */
export type Position = "designer" | "project_manager" | "office_manager" | "owner";

export const POSITION_LABEL: Record<Position, string> = {
  designer: "Designer",
  project_manager: "Project manager",
  office_manager: "Office manager",
  owner: "Owner",
};

/** A project manager logs freelancers' hours on their own user; an office
 * manager or the owner barely logs any. Either way the hours aren't theirs. */
export const hoursAreOwnWork = (position: Position | null) =>
  position == null || position === "designer";

/** The studio's shared login — hours were logged on it for others, so it is
 * an account, not a person, and never appears among the people. */
export const SHARED_ACCOUNT_NAME = "Office";

export interface Person {
  id: string;
  name: string;
  position: Position | null;
  active: boolean;
  hasAccount: boolean;
  startDate: string | null;
  endDate: string | null;
}

/** One tracked entry, reduced to what cost-vs-work needs. */
export interface WorkEntry {
  userId: string;
  date: string; // ISO
  minutes: number;
  /** The task's client (tracker name, which is also the rates' client key). */
  client: string | null;
  /** Billable task on a billable client — the hours a client pays for. */
  billable: boolean;
  /** On a client's Keys task: billable work written down, never charged. */
  keys?: boolean;
}

export interface PayRow {
  profileId: string;
  year: number;
  month: number;
  amount: number;
}

export interface PersonMonth {
  year: number;
  month: number;
  salary: number;
  freelance: number;
  hours: number;
  billableHours: number;
  /** Hours on the studio's own work (the Studio client: the website, internal
   * projects) — worth something, just not to a client. */
  studioHours: number;
  /** Hours written down to a client's Keys task — worth nothing. */
  keysHours: number;
  /** Billable hours × the client's rate in effect then. */
  revenue: number;
  byClient: Map<string, { hours: number; revenue: number }>;
}

/** A person's months, keyed "YYYY-MM". */
export type Ledger = Map<string, PersonMonth>;

const key = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

function monthOf(ledger: Ledger, year: number, month: number): PersonMonth {
  const k = key(year, month);
  let m = ledger.get(k);
  if (!m) {
    m = { year, month, salary: 0, freelance: 0, hours: 0, billableHours: 0, studioHours: 0, keysHours: 0, revenue: 0, byClient: new Map() };
    ledger.set(k, m);
  }
  return m;
}

/** Every person's ledger: pay from finance, hours and their worth from the tracker. */
export function buildLedgers(input: {
  salaries: PayRow[];
  freelance: PayRow[];
  entries: WorkEntry[];
  rates: ClientRate[];
}): Map<string, Ledger> {
  const out = new Map<string, Ledger>();
  const ledger = (id: string) => {
    let l = out.get(id);
    if (!l) out.set(id, (l = new Map()));
    return l;
  };
  for (const r of input.salaries) monthOf(ledger(r.profileId), r.year, r.month).salary += r.amount;
  for (const r of input.freelance) monthOf(ledger(r.profileId), r.year, r.month).freelance += r.amount;

  // Rates looked up once per client-month, not per entry.
  const rateCache = new Map<string, number>();
  for (const e of input.entries) {
    const year = Number(e.date.slice(0, 4));
    const month = Number(e.date.slice(5, 7));
    const m = monthOf(ledger(e.userId), year, month);
    const hours = e.minutes / 60;
    m.hours += hours;
    const client = e.client ?? "(no client)";
    const c = m.byClient.get(client) ?? { hours: 0, revenue: 0 };
    c.hours += hours;
    if (e.client === NON_BILLABLE_CLIENT_CANON) m.studioHours += hours;
    else if (e.keys && !e.billable) m.keysHours += hours;
    if (e.billable && e.client && e.client !== NON_BILLABLE_CLIENT_CANON) {
      const rk = `${e.client}|${year}-${month}`;
      let rate = rateCache.get(rk);
      if (rate === undefined) {
        rate = rateForMonth(input.rates, e.client, year, month) ?? 0;
        rateCache.set(rk, rate);
      }
      m.billableHours += hours;
      m.revenue += hours * rate;
      c.revenue += hours * rate;
    }
    m.byClient.set(client, c);
  }
  return out;
}

/** Below this many hours per paid month, someone's work isn't really tracked. */
const MIN_TRACKED_HOURS_PER_MONTH = 20;

/** Below this share of their cost going to client work (the rest on studio
 * work), there's too little client work to set a return or pay against. */
const MIN_CLIENT_SHARE = 0.2;

export interface PersonSummary {
  salary: number;
  freelance: number;
  cost: number;
  hours: number;
  billableHours: number;
  studioHours: number;
  keysHours: number;
  revenue: number;
  /** Their cost less the share of it that paid for studio work, month by
   * month — what their client work has to earn back. Studio work (the
   * website, internal projects) is an investment the whole studio carries,
   * so it isn't held against the one who did it; Keys hours are. */
  clientCost: number;
  /** Cost ÷ hours worked; null without hours. */
  costPerHour: number | null;
  /** Revenue from their hours ÷ their client-work cost; null without cost. */
  returnRatio: number | null;
  /** Share of their hours that clients pay for. */
  billableShare: number | null;
  /** Share on the studio's own work, and written down to Keys. */
  studioShare: number | null;
  keysShare: number | null;
  /** Months they were paid. */
  paidMonths: number;
  /** Logs enough hours for per-hour figures to mean something. */
  tracked: boolean;
  clients: { client: string; hours: number; revenue: number }[];
}

/** Sum a ledger over one year, or every year when `year` is null. `upTo`
 * ("YYYY-MM", inclusive) leaves out months not finished yet. `ownWork: false`
 * (see hoursAreOwnWork) keeps their hours but never credits them with revenue. */
export function summarize(ledger: Ledger | undefined, year: number | null, upTo?: string, ownWork = true): PersonSummary {
  return summarizeWhere(ledger, (k, m) => (year == null || m.year === year) && !(upTo && k > upTo), ownWork);
}

/** Sum a ledger over the months `pick` keeps (keys are "YYYY-MM"). */
function summarizeWhere(
  ledger: Ledger | undefined,
  pick: (key: string, m: PersonMonth) => boolean,
  ownWork = true,
): PersonSummary {
  const s: PersonSummary = {
    salary: 0, freelance: 0, cost: 0, hours: 0, billableHours: 0, studioHours: 0, keysHours: 0, revenue: 0, clientCost: 0,
    costPerHour: null, returnRatio: null, billableShare: null, studioShare: null, keysShare: null, paidMonths: 0, tracked: false, clients: [],
  };
  const clients = new Map<string, { hours: number; revenue: number }>();
  for (const [k, m] of ledger ?? []) {
    if (!pick(k, m)) continue;
    s.salary += m.salary;
    s.freelance += m.freelance;
    s.hours += m.hours;
    s.billableHours += m.billableHours;
    s.revenue += m.revenue;
    s.studioHours += m.studioHours;
    s.keysHours += m.keysHours;
    const pay = m.salary + m.freelance;
    s.clientCost += m.hours > 0 ? pay * Math.max(0, 1 - m.studioHours / m.hours) : pay;
    if (pay > 0) s.paidMonths++;
    for (const [client, c] of m.byClient) {
      const t = clients.get(client) ?? { hours: 0, revenue: 0 };
      t.hours += c.hours;
      t.revenue += ownWork ? c.revenue : 0;
      clients.set(client, t);
    }
  }
  s.cost = s.salary + s.freelance;
  // Per-hour figures only for someone whose work is tracked: an owner's or
  // office manager's few logged hours would make them look absurd.
  if (!ownWork) s.revenue = 0;
  s.tracked = ownWork && s.hours >= MIN_TRACKED_HOURS_PER_MONTH * Math.max(1, s.paidMonths);
  s.costPerHour = s.tracked ? s.cost / s.hours : null;
  // Mostly studio work leaves too little client work to judge a return on.
  s.returnRatio = s.tracked && s.clientCost > s.cost * MIN_CLIENT_SHARE ? s.revenue / s.clientCost : null;
  s.billableShare = s.hours >= 1 ? s.billableHours / s.hours : null;
  s.studioShare = s.hours >= 1 ? s.studioHours / s.hours : null;
  s.keysShare = s.hours >= 1 ? s.keysHours / s.hours : null;
  s.clients = [...clients.entries()]
    .map(([client, c]) => ({ client, ...c }))
    .filter((c) => c.hours > 0)
    .sort((a, b) => b.hours - a.hours);
  return s;
}

/** The person's months in order, optionally one year only. */
export function monthsOf(ledger: Ledger | undefined, year: number | null): PersonMonth[] {
  return [...(ledger?.values() ?? [])]
    .filter((m) => year == null || m.year === year)
    .sort((a, b) => a.year - b.year || a.month - b.month);
}

/** "3y 4m" between two ISO dates (to today when `to` is null). */
export function tenure(from: string | null, to: string | null, today = new Date()): string | null {
  if (!from) return null;
  const a = new Date(from);
  const b = to ? new Date(to) : today;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months--;
  if (months < 0) return null;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y ? (m ? `${y}y ${m}m` : `${y}y`) : `${m}m`;
}

/** The last finished month, "YYYY-MM" — the month in progress isn't counted. */
export function finishedThrough(today = new Date()): string {
  const y = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
  const m = today.getMonth() === 0 ? 12 : today.getMonth();
  return key(y, m);
}

// ── Efficiency, pay and advice ───────────────────────────────────────────────
// Set against the studio's own P&L: what a month cost the studio in all, how
// much of that was people, and how many workdays it had.

export interface StudioMonth {
  year: number;
  month: number;
  /** Every cost in the P&L that month. */
  totalExpenses: number;
  /** Everything the studio earned that month, hours and projects. */
  totalRevenues: number;
  /** Salaries + freelance — the share of costs that is people. */
  peopleCost: number;
  /** Pay of the people whose hours are their own work (see hoursAreOwnWork):
   * the ones whose hours earn. Everyone else's pay is overhead they carry. */
  earnersPay: number;
  /** The part of earners' pay that went to client work (see clientCost);
   * the rest paid for studio work, which all client work carries. */
  earnersClientPay: number;
  /** Revenue from those people's own hours. The rest of the studio's revenue
   * (projects, freelancers' hours a manager logs) pays for part of the overhead. */
  earnersRevenue: number;
  /** The sheet's workdays (holidays out), else its Sun–Thu days. */
  workdays: number;
}

/** The P&L's months, keyed "YYYY-MM", up to `upTo` (finished months only).
 * Everyone's `ledgers` and `positions` give each month's earners' pay and
 * the revenue from their hours. */
export function studioMonths(
  pnl: PnlMonthly[],
  upTo: string,
  ledgers: Map<string, Ledger> = new Map(),
  positions: Map<string, Position | null> = new Map(),
): Map<string, StudioMonth> {
  const out = new Map<string, StudioMonth>();
  for (const r of pnl) {
    const k = key(r.year, r.month);
    if (k > upTo) continue;
    let m = out.get(k);
    if (!m)
      out.set(k, (m = { year: r.year, month: r.month, totalExpenses: 0, totalRevenues: 0, peopleCost: 0, earnersPay: 0, earnersClientPay: 0, earnersRevenue: 0, workdays: 0 }));
    if (r.lineItem === LINE.totalExpenses) m.totalExpenses = r.value;
    else if (r.lineItem === LINE.totalRevenues) m.totalRevenues = r.value;
    else if (r.lineItem === LINE.salaries || r.lineItem === LINE.freelance) m.peopleCost += r.value;
    else if (r.lineItem === LINE.daysInMonth) m.workdays = r.value;
  }
  for (const m of out.values()) if (!m.workdays) m.workdays = studioWeekdays(m.year, m.month).total;
  for (const [id, ledger] of ledgers) {
    if (!positions.has(id) || !hoursAreOwnWork(positions.get(id)!)) continue;
    for (const [k, pm] of ledger) {
      const m = out.get(k);
      const pay = pm.salary + pm.freelance;
      // Hours without linked pay (a freelancer booked under another name)
      // count as other revenue, against the cost they bring.
      if (!m || pay <= 0) continue;
      m.earnersPay += pay;
      m.earnersClientPay += pm.hours > 0 ? pay * Math.max(0, 1 - pm.studioHours / pm.hours) : pay;
      m.earnersRevenue += pm.revenue;
    }
  }
  return out;
}

/** The month `n` months after `ym` ("YYYY-MM"; n < 0 goes back). */
const addMonths = (ym: string, n: number) => {
  const t = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + n;
  return key(Math.floor(t / 12), (t % 12) + 1);
};

/** The `count` months ending at `upTo` ("YYYY-MM"), oldest first. */
export function monthsEnding(upTo: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(upTo, i - (count - 1)));
}

export interface Efficiency {
  months: number;
  /** Hours logged a studio workday, over the months they were paid or logged. */
  hoursPerWorkday: number | null;
  billableShare: number | null;
  studioShare: number | null;
  keysShare: number | null;
  /** Revenue from their hours ÷ every hour they logged — rate and billable share in one. */
  earnedPerHour: number | null;
  returnRatio: number | null;
  summary: PersonSummary;
}

/** How a person worked over a set of months. Months they weren't paid and
 * logged nothing (before they started, unpaid leave) don't count. */
export function efficiency(
  ledger: Ledger | undefined,
  keys: string[],
  studio: Map<string, StudioMonth>,
  ownWork = true,
): Efficiency {
  const want = new Set(keys);
  const counted = keys.filter((k) => {
    const m = ledger?.get(k);
    return m && (m.salary + m.freelance > 0 || m.hours >= 1);
  });
  const summary = summarizeWhere(ledger, (k) => want.has(k), ownWork);
  const workdays = counted.reduce((t, k) => t + (studio.get(k)?.workdays ?? studioWeekdays(+k.slice(0, 4), +k.slice(5, 7)).total), 0);
  return {
    months: counted.length,
    hoursPerWorkday: workdays && summary.hours >= 1 ? summary.hours / workdays : null,
    billableShare: summary.billableShare,
    studioShare: summary.studioShare,
    keysShare: summary.keysShare,
    earnedPerHour: summary.tracked && summary.hours ? summary.revenue / summary.hours : null,
    returnRatio: summary.returnRatio,
    summary,
  };
}

/**
 * The return a person's pay has to make to carry its share of the studio and
 * the target margin: revenue ÷ pay ≥ this (the "×" on the person page). One
 * rule for the page header, the Overview tab and the Performance tab.
 */
export function neededReturn(pay: Pick<PayAdvice, "overhead"> | null | undefined): number | null {
  return pay ? pay.overhead / (1 - TARGET_MARGIN) : null;
}

export interface PayAdvice {
  /** Their pay a month (salary + freelance), averaged over the months used. */
  actual: number;
  /** Revenue from their hours a month, same months. */
  revenue: number;
  /** What each ₪1 of an earner's client-work pay has to carry, itself
   * included: the studio's costs, less the revenue that isn't from earners'
   * hours, ÷ the earners' client-work pay. The owner's and office's pay,
   * studio work, rent, software and the rest are in it; project income takes
   * some of it off. */
  overhead: number;
  /** Share of their pay that went to studio work, not held against them. */
  studioShare: number;
  /** Pay their work supports: revenue × (1 − margin) ÷ overhead. */
  recommended: number;
  /** recommended − actual: above 0 they're paid less than their work supports. */
  gap: number;
  /** Hours they logged a month, same months — to put pay per hour. */
  hours: number;
  /** Billable hours a month, same months — what the revenue came from. */
  billableHours: number;
  /** The studio's workdays a month, same months. */
  workdays: number;
  months: number;
  /** The months it's worked out over ("YYYY-MM"). */
  keys: string[];
}

/**
 * The monthly pay a person's own work supports. Their client work has to
 * cover the pay for it, its share of what the studio spends beyond that (less
 * what other revenue already covers), and leave the target margin:
 * client pay = revenue × (1 − margin) ÷ ((costs − other revenue) ÷ earners'
 * client pay). Their studio work is paid at the same rate on top — the whole
 * studio carries it, so the one doing it isn't marked down. Keys hours earn
 * nothing and are held against them. Paid this way, every earner's client pay
 * together leaves the studio the margin on its earners' revenue — so across
 * the studio, recommendations balance out.
 * Null for someone whose hours aren't their own work, or who isn't tracked.
 */
export function payAdvice(
  ledger: Ledger | undefined,
  keys: string[],
  studio: Map<string, StudioMonth>,
  ownWork = true,
  margin = TARGET_MARGIN,
): PayAdvice | null {
  if (!ownWork) return null;
  const paid = keys.filter((k) => {
    const m = ledger?.get(k);
    return m && m.salary + m.freelance > 0 && studio.get(k)?.earnersClientPay;
  });
  if (!paid.length) return null;
  const s = summarizeWhere(ledger, (k) => paid.includes(k));
  if (!s.tracked || s.clientCost <= s.cost * MIN_CLIENT_SHARE) return null;
  const sum = (f: (m: StudioMonth) => number) => paid.reduce((t, k) => t + f(studio.get(k)!), 0);
  const people = sum((m) => m.earnersClientPay);
  const otherRevenue = sum((m) => Math.max(0, m.totalRevenues - m.earnersRevenue));
  const carried = sum((m) => m.totalExpenses) - otherRevenue;
  if (carried <= 0 || people <= 0) return null;
  const overhead = carried / people;
  const actual = s.cost / paid.length;
  const revenue = s.revenue / paid.length;
  // Client pay their work supports, grossed up by their studio work at the same rate.
  const studioShare = 1 - s.clientCost / s.cost;
  const recommended = (revenue * (1 - margin)) / overhead / (1 - studioShare);
  return {
    actual,
    revenue,
    overhead,
    studioShare,
    recommended,
    gap: recommended - actual,
    hours: s.hours / paid.length,
    billableHours: s.billableHours / paid.length,
    workdays: sum((m) => m.workdays) / paid.length,
    months: paid.length,
    keys: paid,
  };
}

/** One month's payslip figures (finance_payslips). */
export interface PayslipMonth {
  year: number;
  month: number;
  /** Full-time monthly salary, or ₪ an hour for hourly pay. */
  salaryRate: number | null;
  /** Job share (0.8) for a monthly salary, hours for an hourly one; null = full time. */
  salaryQuantity: number | null;
  salaryPaid: number | null;
  grossTotal: number | null;
  vacationBalance: number | null;
  sickBalance: number | null;
  /** Sick days taken that month (from reference/0009 on; null before). */
  sickUsed?: number | null;
}

/** Above this, a payslip's salary quantity is hours, not a job share. */
const HOURLY_QUANTITY = 1.5;

/** The payslip pays by the hour (its salary quantity is hours, not a job share). */
export const isHourlySlip = (p: Pick<PayslipMonth, "salaryQuantity"> | undefined) => (p?.salaryQuantity ?? 0) > HOURLY_QUANTITY;

export interface GrossPay {
  /** A monthly salary (full-time figure) or an hourly rate. */
  unit: "month" | "hour";
  /** Their gross salary on the latest payslip: full-time monthly, or ₪/hour. */
  current: number;
  at: { year: number; month: number };
  /** Their job share on it (0.8 = 80%), for a monthly salary below full time. */
  share: number | null;
  /** The pay advice in the same terms; null without advice or payslips. */
  recommended: number | null;
}

/** Their average job share on the payslips of `keys` months: a monthly
 * salary's quantity (full time when the slip leaves it out). Null without
 * payslips, or for hourly pay. */
export function jobShareOf(slips: PayslipMonth[], keys: string[]): number | null {
  const want = new Set(keys);
  const shares = slips
    .filter((p) => want.has(key(p.year, p.month)) && !isHourlySlip(p))
    .map((p) => p.salaryQuantity ?? 1);
  return shares.length ? shares.reduce((t, v) => t + v, 0) / shares.length : null;
}

/**
 * Their salary as the payslip states it — gross, full time (or an hourly
 * rate) — and a pay recommendation turned into the same terms. The finance
 * figures are what someone costs the studio (gross plus the employer's
 * contributions), so the recommendation is scaled by their own payslip rate ÷
 * their booked cost over the same months. Over partial months (a job share,
 * unpaid days) that also scales it up to the full-time figure.
 */
export function grossPay(slips: PayslipMonth[], ledger: Ledger | undefined, advice: PayAdvice | null): GrossPay | null {
  const sorted = [...slips].filter((p) => p.salaryRate != null).sort((a, b) => a.year - b.year || a.month - b.month);
  const latest = sorted.at(-1);
  if (!latest) return null;
  const hourly = isHourlySlip(latest);
  const unit = hourly ? "hour" : "month";
  let recommended: number | null = null;
  if (advice) {
    const bySlip = new Map(sorted.map((p) => [key(p.year, p.month), p]));
    let rate = 0;
    let paid = 0;
    let quantity = 0;
    let cost = 0;
    let n = 0;
    for (const k of advice.keys) {
      const p = bySlip.get(k);
      const m = ledger?.get(k);
      // Only months paid the same way as now: an hourly ₪60 summed with a
      // monthly ₪9,000 means nothing.
      if (!p || !m || m.salary + m.freelance <= 0 || p.salaryRate == null || isHourlySlip(p) !== hourly) continue;
      rate += p.salaryRate;
      paid += p.salaryPaid ?? 0;
      quantity += p.salaryQuantity ?? 0;
      cost += m.salary + m.freelance;
      n++;
    }
    if (n && cost > 0)
      recommended =
        unit === "month"
          ? (advice.recommended * rate) / cost
          : quantity > 0
            ? (advice.recommended * paid) / cost / (quantity / n)
            : null;
  }
  return {
    unit,
    current: latest.salaryRate!,
    at: { year: latest.year, month: latest.month },
    share: unit === "month" && latest.salaryQuantity != null && latest.salaryQuantity < 1 ? latest.salaryQuantity : null,
    recommended,
  };
}

/**
 * What their work supported, month by month — each month's pay advice over
 * the `window` months ending there. With payslips it's put in gross salary
 * (comparable with the salary paid on each payslip: an hourly month's hours ×
 * rate, a job share's part) at the salary ÷ cost of the window's payslips, or
 * of all their payslips for months before the first; without any, it stays
 * in what they cost. Months without advice are left out.
 */
export function supportedPayByMonth(
  slips: PayslipMonth[],
  ledger: Ledger | undefined,
  studio: Map<string, StudioMonth>,
  months: string[],
  ownWork = true,
  window = 3,
): { basis: "salary" | "cost"; byMonth: Map<string, number> } {
  const bySlip = new Map(slips.map((p) => [key(p.year, p.month), p]));
  const ratioOver = (keys: Iterable<string>) => {
    let salary = 0;
    let cost = 0;
    for (const k of keys) {
      const p = bySlip.get(k);
      const m = ledger?.get(k);
      if (p?.salaryPaid == null || !m || m.salary + m.freelance <= 0) continue;
      salary += p.salaryPaid;
      cost += m.salary + m.freelance;
    }
    return salary > 0 && cost > 0 ? salary / cost : null;
  };
  const overall = ratioOver(bySlip.keys());
  const byMonth = new Map<string, number>();
  for (const k of months) {
    const advice = payAdvice(ledger, monthsEnding(k, window), studio, ownWork);
    if (!advice) continue;
    const ratio = overall == null ? 1 : (ratioOver(advice.keys) ?? overall);
    byMonth.set(k, advice.recommended * ratio);
  }
  return { basis: overall == null ? "cost" : "salary", byMonth };
}

/** The month ("YYYY-MM") their payslip salary last went up — a raise, or a
 * move from hourly to monthly pay. Null with fewer than two payslips. */
export function lastPayRise(slips: PayslipMonth[]): string | null {
  const sorted = slips.filter((p) => p.salaryRate != null).sort((a, b) => a.year - b.year || a.month - b.month);
  let out: string | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const [prev, p] = [sorted[i - 1], sorted[i]];
    const moved = isHourlySlip(prev) !== isHourlySlip(p);
    if (moved ? !isHourlySlip(p) : p.salaryRate! > prev.salaryRate!) out = key(p.year, p.month);
  }
  return out;
}

/**
 * The month ("YYYY-MM") their pay was last set: the latest of a raise or a
 * start on the HR timeline, a rise on their payslips (lastPayRise) and their
 * start date. The one definition of "last raise" — the Overview tab's "No
 * salary update in…" (hrAdvice) and the Pay tab's raise box (raiseAdvice) both
 * read it; the advice used to look at HR notes alone, so a raise seen only on
 * the payslips left the two disagreeing.
 */
export function lastRaiseOf(notes: { kind: HrNoteKind; date: string | null }[], slips: PayslipMonth[], startDate: string | null): string | null {
  const noted = notes.filter((n) => n.date && (n.kind === "raise" || n.kind === "start")).map((n) => n.date!.slice(0, 7));
  return [...noted, lastPayRise(slips), startDate?.slice(0, 7)].filter((x): x is string => !!x).sort().at(-1) ?? null;
}

/** Paid only as a freelancer over these months (no salary) — paid by the
 * hour or the job, so not an employee to give raises and review talks. */
export function isFreelancer(ledger: Ledger | undefined, keys: string[]): boolean {
  let salary = 0;
  let freelance = 0;
  for (const k of keys) {
    salary += ledger?.get(k)?.salary ?? 0;
    freelance += ledger?.get(k)?.freelance ?? 0;
  }
  return salary === 0 && freelance > 0;
}

/**
 * A sliding-rate freelancer's terms, re-priced to what their work supports.
 * The same shape (same hour thresholds), both rates times one factor — and
 * since every hour of a month is paid at that month's rate, scaling both rates
 * scales the month's bill by exactly that factor, at any number of hours. So
 * terms × (supported ÷ paid) would have paid them what their work supported.
 * Rounded to `step` ₪.
 */
export function recommendedTerms(terms: RateTerms, pay: PayAdvice, step = 5): { terms: RateTerms; factor: number } | null {
  if (pay.actual <= 0 || pay.recommended <= 0) return null;
  const factor = pay.recommended / pay.actual;
  const round = (v: number) => Math.max(step, Math.round((v * factor) / step) * step);
  return { factor, terms: { ...terms, rateHigh: round(terms.rateHigh), rateLow: round(terms.rateLow) } };
}

const termsText = (t: RateTerms) => `₪${t.rateHigh}/h up to ${t.hoursLow}h a month, down to ₪${t.rateLow}/h at ${t.hoursHigh}h`;

export type HrNoteKind = "start" | "end" | "raise" | "scope" | "review_3m" | "review_half" | "review_year" | "note" | "comment";

export interface Advice {
  tone: "good" | "watch" | "act";
  title: string;
  detail: string;
}

/** Pay this far from what their work supports is worth raising (either way). */
const PAY_GAP_TOLERANCE = 0.15;

const monthsSince = (iso: string, today: Date) =>
  (today.getFullYear() - +iso.slice(0, 4)) * 12 + (today.getMonth() + 1 - +iso.slice(5, 7));

// Only ever given amounts and shares ≥ 0, where these read exactly as the
// `toLocaleString` / `Math.round(n * 100)` versions they replaced.
const ils = (n: number) => formatILS(Math.round(n));
const pct = (n: number) => formatPct(n, 0);

/**
 * What an employer might do about someone, from the numbers alone: pay
 * against what their work supports, how long since a raise or a review talk,
 * and which way their billable share and hours are going. A freelancer gets
 * only the pay and billable-share points; the owner gets none.
 */
export function hrAdvice(input: {
  active: boolean;
  ownWork: boolean;
  position: Position | null;
  freelancer: boolean;
  startDate: string | null;
  notes: { kind: HrNoteKind; date: string | null }[];
  /** Their payslips — a rise there counts as their last raise (lastRaiseOf). */
  slips?: PayslipMonth[];
  /** Last 3 finished months. */
  pay: PayAdvice | null;
  /** The same in gross-salary terms, from their payslips — the advice then
   * talks in the salary they and you actually agree on. */
  gross?: GrossPay | null;
  /** A sliding-rate freelancer's terms — a recommendation then names new rates. */
  terms?: RateTerms;
  /** Their average job share on the last 3 months' payslips (0.36 = paid
   * for about a third of the month) — hours a workday are judged against it. */
  jobShare?: number | null;
  recent: Efficiency;
  /** The 9 months before those. */
  earlier: Efficiency;
  today?: Date;
}): Advice[] {
  const { active, ownWork, position, freelancer, startDate, notes, slips = [], pay, gross, jobShare, terms, recent, earlier, today = new Date() } = input;
  if (!active || position === "owner") return [];
  const employee = !freelancer;
  const out: Advice[] = [];
  const latest = (kinds: HrNoteKind[]) =>
    notes
      .filter((n) => n.date && kinds.includes(n.kind))
      .map((n) => n.date!)
      .sort()
      .at(-1) ?? null;
  const tenureMonths = startDate ? monthsSince(startDate, today) : null;
  const lastRaise = lastRaiseOf(notes, slips, startDate);
  const sinceRaise = lastRaise ? monthsSince(lastRaise, today) : null;

  // In gross salary when their payslips allow it, else in what they cost.
  const g = gross?.recommended != null ? gross : null;
  const per = g?.unit === "hour" ? "/h" : "";
  const now = g ? `${ils(g.current)}${per} gross${g.unit === "month" && g.share != null ? ` full time (they're on ${pct(g.share)})` : ""}` : pay && `${ils(pay.actual)} a month in cost`;
  const supports = g ? `${ils(g.recommended!)}${per} gross${g.unit === "month" && g.share != null ? " full time" : ""}` : pay && `${ils(pay.recommended)} a month in cost`;
  const ratio = g ? g.current / g.recommended! : pay ? pay.actual / pay.recommended : null;
  const newTerms = terms && pay ? recommendedTerms(terms, pay) : null;
  const rateLine = newTerms ? ` A sliding rate of ${termsText(newTerms.terms)} (now ${termsText(terms!)}) would pay that at their usual hours.` : "";
  if (pay && ratio != null) {
    if (ratio < 1 - PAY_GAP_TOLERANCE)
      out.push({
        tone: "act",
        title: "Paid below what their work supports",
        detail: freelancer
          ? `Over the last ${pay.months} months their hours brought in ${ils(pay.revenue)} a month — enough for about ${supports} at the studio's target margin; they're paid ${now}. Room to give them more work, or a better rate if they ask.${rateLine}`
          : `Over the last ${pay.months} months their hours brought in ${ils(pay.revenue)} a month — enough for a salary of about ${supports} at the studio's target margin; now ${now}. A raise is affordable, and someone this productive is a retention risk if they're underpaid.`,
      });
    else if (ratio > 1 + PAY_GAP_TOLERANCE)
      out.push({
        tone: "watch",
        title: "Costs more than their hours carry",
        detail: `Their billable work supports about ${supports}; they're paid ${now}. ${freelancer ? "Check their rate and which hours you send them" : "Before any raise, look at why"}: ${recent.billableShare != null ? `${pct(recent.billableShare)} of their hours are billable` : "few billable hours"}${recent.hoursPerWorkday != null ? `, about ${formatNum(recent.hoursPerWorkday, 1)}h logged a workday` : ""}. More client work, or work on better-paying clients, closes the gap faster than a pay cut.${freelancer ? rateLine : ""}`,
      });
    else
      out.push({
        tone: "good",
        title: "Pay is in line with their work",
        detail: `They're paid ${now}; their hours support about ${supports}.`,
      });
  }

  const underpaid = ratio != null && ratio < 1 - PAY_GAP_TOLERANCE;
  if (employee && sinceRaise != null && sinceRaise >= 18)
    out.push({
      tone: underpaid ? "act" : "watch",
      title: `No salary update in ${Math.floor(sinceRaise / 12)}y ${sinceRaise % 12}m`,
      detail: underpaid
          ? "Their work supports more than they're paid — a long gap since the last update makes this the conversation to have next."
          : "Even without room for a raise, say so in a talk: silence on pay for this long reads as being overlooked.",
    });

  const lastTalk = latest(["review_3m", "review_half", "review_year"]);
  // A freelancer has no salary updates or review talks to keep up with.
  if (employee && tenureMonths != null && tenureMonths >= 2 && tenureMonths < 6 && !lastTalk)
    out.push({
      tone: "act",
      title: "3-month talk due",
      detail: `They started ${tenureMonths} months ago and no first-period talk is on record.`,
    });
  else if (employee && tenureMonths != null && tenureMonths >= 12 && (!lastTalk || monthsSince(lastTalk, today) >= 12))
    out.push({
      tone: "act",
      title: "Yearly talk overdue",
      detail: lastTalk
        ? `The last review talk on record was ${monthsSince(lastTalk, today)} months ago.`
        : "No review talk on record in their HR timeline.",
    });

  if (ownWork && recent.billableShare != null && earlier.billableShare != null && earlier.months >= 3) {
    const delta = recent.billableShare - earlier.billableShare;
    if (delta <= -0.1)
      out.push({
        tone: "watch",
        title: "Billable share is falling",
        detail: `${pct(recent.billableShare)} of their hours were billable in the last 3 months, down from ${pct(earlier.billableShare)} before. Check whether they're short of client work or stuck on internal tasks.`,
      });
    else if (delta >= 0.1)
      out.push({
        tone: "good",
        title: "Billable share is rising",
        detail: `${pct(recent.billableShare)} of their hours were billable in the last 3 months, up from ${pct(earlier.billableShare)}.`,
      });
  }

  if (ownWork && recent.keysShare != null && recent.keysShare >= 0.1)
    out.push({
      tone: "watch",
      title: "Many hours written down",
      detail: `${pct(recent.keysShare)} of their hours in the last 3 months went to Keys — client work the studio didn't charge for. Look at which tasks: estimates too low, scope creep, or work that took them longer than it should.`,
    });

  const share = jobShare != null && jobShare > 0 && jobShare < 1 ? jobShare : null;
  const perPaidDay = recent.hoursPerWorkday != null ? recent.hoursPerWorkday / (share ?? 1) : null;
  if (employee && ownWork && perPaidDay != null && perPaidDay < 6)
    out.push({
      tone: "watch",
      title: "Few hours logged",
      detail: `About ${formatNum(perPaidDay, 1)}h logged a workday${share ? ` they were paid for (they were paid for ${pct(share)} of the time)` : ""} over the last 3 months. Either they're short of work or not logging all of it — each needs a different answer.`,
    });

  const rank = { act: 0, watch: 1, good: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/** The most a raise is recommended at once — more waits for the next review. */
export const MAX_RAISE = 0.15;
/** How far what their work supports must clear their pay before a raise. */
const RAISE_HEADROOM = 0.05;

export interface RaisePlan {
  /** raise: give it (at `when`) · raise_if: give it at `when` if the next
   * months hold · hold: not yet — `need` says what earns the next step ·
   * no_raise: their work doesn't carry what they're paid · review: no
   * work-based figure (their hours aren't their own work, or too few). */
  verdict: "raise" | "raise_if" | "hold" | "no_raise" | "review";
  unit: "month" | "hour";
  /** Gross salary (full-time, from payslips), or without payslips what they cost. */
  basis: "gross" | "cost";
  current: number;
  /** What they support over the last 3 and 12 months, same terms — their
   * work's figure with the premium for what they bring beyond it. */
  supported3: number | null;
  supported12: number | null;
  /** Their work's figure alone (no premium). */
  work3: number | null;
  work12: number | null;
  premium: number;
  /** The salary to raise to; for hold, the next step worth aiming for. */
  target: number | null;
  /** What their work supports beyond the largest single raise — a later step. */
  ceiling: number | null;
  /** "now", or the month ("YYYY-MM") to do it in. */
  when: string;
  /** The month of the last raise, move to monthly pay, or start. */
  lastRise: string | null;
  /** Billable hours a month over the last 3 and 12 months — as full time
   * for a job share, like the salaries. */
  billable3: number | null;
  billable12: number | null;
  /** The studio's workdays a month, to put hours a day. */
  workdays: number | null;
  /** Billable hours a month (full time) that support `pay`, at their recent ₪ an hour. */
  need: { pay: number; hours: number } | null;
}

/**
 * Whether to raise someone's salary, by how much, when, and on what
 * condition. A raise needs what their work supports to clear their pay over
 * both the last 3 and the last 12 months (only the last 3: wait 3 months to
 * see it hold), is at most MAX_RAISE at once, and comes a year after the last
 * one. Freelancers (a rate, not a salary) and the owner get none.
 */
export function raiseAdvice(input: {
  active: boolean;
  ownWork: boolean;
  position: Position | null;
  freelancer: boolean;
  startDate: string | null;
  notes: { kind: HrNoteKind; date: string | null }[];
  slips: PayslipMonth[];
  /** Each window, with their average job share on its payslips (0.5 = half
   * time; null = full time or unknown). */
  last3: { pay: PayAdvice | null; gross: GrossPay | null; jobShare?: number | null };
  last12: { pay: PayAdvice | null; gross: GrossPay | null; jobShare?: number | null };
  /** What they bring beyond their hours (valuePremium): 0.12 = their work is
   * worth 12% more than its revenue alone. */
  premium?: number;
  today?: Date;
}): RaisePlan | null {
  const { active, ownWork, position, freelancer, startDate, notes, slips, last3, last12, premium = 0, today = new Date() } = input;
  if (!active || freelancer || position === "owner") return null;
  const g = last3.gross ?? last12.gross;
  const current = g?.current ?? last3.pay?.actual;
  if (current == null) return null;
  const unit = g?.unit ?? "month";
  const basis = g ? "gross" : "cost";
  const supportedOf = (w: { pay: PayAdvice | null; gross: GrossPay | null }) =>
    basis === "gross" ? (w.gross?.unit === unit ? w.gross.recommended : null) : (w.pay?.recommended ?? null);
  const work3 = ownWork ? supportedOf(last3) : null;
  const work12 = ownWork ? supportedOf(last12) : null;
  const supported3 = work3 != null ? work3 * (1 + premium) : null;
  const supported12 = work12 != null ? work12 * (1 + premium) : null;

  const thisMonth = key(today.getFullYear(), today.getMonth() + 1);
  const lastRise = lastRaiseOf(notes, slips, startDate);
  const due = lastRise ? addMonths(lastRise, 12) : thisMonth;
  const yearly = due <= thisMonth ? "now" : due;

  // Hours as full time, like the salary figures they're set against.
  const fullTime = (w: typeof last3) =>
    w.pay ? w.pay.billableHours / (basis === "gross" && w.jobShare && w.jobShare > 0 && w.jobShare < 1 ? w.jobShare : 1) : null;
  const billable3 = fullTime(last3);
  const plan: RaisePlan = {
    verdict: "review",
    unit,
    basis,
    current,
    supported3,
    supported12,
    work3,
    work12,
    premium,
    target: null,
    ceiling: null,
    when: yearly,
    lastRise,
    billable3,
    billable12: fullTime(last12),
    workdays: last3.pay?.workdays ?? null,
    need: null,
  };
  if (supported3 == null) return plan;

  const step = unit === "month" ? 500 : 1;
  const down = (v: number) => Math.floor(v / step) * step;
  const near = (v: number) => Math.round(v / step) * step;
  const cap = current * (1 + MAX_RAISE);
  const needFor = (pay: number) => (billable3 ? { pay, hours: (billable3 * pay) / supported3 } : null);
  const raiseTo = (supports: number) =>
    supports >= current * (1 + RAISE_HEADROOM) && down(Math.min(supports, cap)) >= current + step ? down(Math.min(supports, cap)) : null;

  const sustained = supported12 != null ? Math.min(supported3, supported12) : supported3;
  const now = raiseTo(sustained);
  if (now != null)
    return { ...plan, verdict: "raise", target: now, ceiling: sustained > cap ? down(sustained) : null, need: needFor(now) };
  const recent = raiseTo(supported3);
  if (recent != null) {
    const inThree = addMonths(thisMonth, 3);
    return { ...plan, verdict: "raise_if", target: recent, when: yearly === "now" || due < inThree ? inThree : due, need: needFor(recent) };
  }
  if (supported3 >= current * (1 - PAY_GAP_TOLERANCE)) {
    const next = Math.max(near(current * 1.1), current + step);
    return { ...plan, verdict: "hold", target: next, need: needFor(next) };
  }
  return { ...plan, verdict: "no_raise", need: needFor(current) };
}

/** What someone brings beyond their billable hours, as the owner rates it —
 * each factor at a grade 0–10 adds that many tenths of its `max` share on top
 * of what their work supports; Concerns takes it off. `label` is the short
 * name on the slider, `title` and `detail` the hover explanation. */
export const FACTORS = [
  {
    id: "guidance",
    label: "Guidance",
    title: "Guidance & art direction",
    max: 0.1,
    detail:
      "Sets the visual direction on projects and reviews others' work before it reaches a client — and explains why, so juniors learn. Their value shows in other people's work: fewer rounds, juniors who grow faster, a studio standard that holds without you checking everything. Others look to them for inspiration. 10: the studio's design standard runs through them.",
  },
  {
    id: "clients",
    label: "Clients",
    title: "Client relationships",
    max: 0.08,
    detail:
      "Talks to clients directly — presents, explains, pushes back well — and clients trust them. Saves you and the PM time, prevents misunderstandings that cost rounds, and keeps clients coming back or asking for them by name. 10: clients would follow them; they bring or keep accounts.",
  },
  {
    id: "ownership",
    label: "Ownership",
    title: "Ownership & reliability",
    max: 0.06,
    detail:
      "Takes a project end to end without being chased: plans, keeps deadlines, flags problems early, finishes the boring parts too. Needs little managing — the hours you don't spend on them are worth money. 10: you hand over a project and stop thinking about it.",
  },
  {
    id: "culture",
    label: "Culture",
    title: "Culture & studio life",
    max: 0.05,
    detail:
      "Makes the studio a place people want to be: the mural, events, rituals, energy, helping a new person settle in. Good culture keeps people longer and makes hiring easier — neither shows in anyone's hours. 10: the studio would feel different without them.",
  },
  {
    id: "skills",
    label: "Rare skills",
    title: "Rare skills",
    max: 0.06,
    detail:
      "Skills the studio couldn't easily replace or would have to buy from freelancers: motion, 3D, code, illustration, a rare software or craft. Also what the market would pay for them. 10: losing them means turning work away.",
  },
  {
    id: "growth",
    label: "Growth",
    title: "Growth",
    max: 0.05,
    detail:
      "Learning fast and taking on more than their role — worth investing in before their numbers show it. A raise now buys loyalty for the years they become more valuable. 10: clearly on the way to a senior or lead role.",
  },
  {
    id: "concerns",
    label: "Concerns",
    title: "Concerns",
    max: -0.1,
    detail:
      "Takes off: rework and quality problems that cost the studio hours or clients, missed deadlines, attitude that affects others, or needing close supervision. Use it for what the hours don't already show (written-down Keys hours already count against them). 10: a serious problem you'd act on.",
  },
] as const;

export type FactorId = (typeof FACTORS)[number]["id"];
export type FactorLevels = Partial<Record<FactorId, number>>;
/** The top of each factor's scale. */
export const FACTOR_TOP = 10;

/** The premium the grades add: 0.12 = 12% on top of what their work supports. */
export function valuePremium(levels: FactorLevels): number {
  return FACTORS.reduce((t, f) => t + (Math.max(0, Math.min(FACTOR_TOP, levels[f.id] ?? 0)) / FACTOR_TOP) * f.max, 0);
}

/** Sick days on their payslips over these months ("YYYY-MM"); null when none
 * of those payslips has the figure. */
export function sickDays(slips: PayslipMonth[], keys: string[]): number | null {
  const want = new Set(keys);
  const known = slips.filter((p) => want.has(key(p.year, p.month)) && p.sickUsed != null);
  return known.length ? known.reduce((t, p) => t + p.sickUsed!, 0) : null;
}
