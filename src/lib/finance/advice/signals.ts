// &advice's rule checks for finance (v1.6.0) — the money version of
// studio-tracker's src/lib/advice/signals.ts. Each takes plain data and returns
// the findings it sees; the engine (`run.ts`) loads the data and keeps one
// `finance_advice_items` row per finding.
//
// ⚠️ PURE ON PURPOSE — no clock, no database. `data.today` is the studio's date
// (Asia/Jerusalem), which is what makes month ends and "the 8th" testable.
//
// ⚠️ AMOUNTS GO IN THREE PLACES ONLY: `figure` (the card's chip), facts whose
// key ends in `Ils`/`Eur`, and the rule's own `body`. TITLES CARRY NO AMOUNT, so
// what Claude is sent (word.ts) is amount-free by construction, and word.ts
// strips the bodies and those facts again before anything leaves the server
// (Nitsan, 2026-10-24: Claude words the advice, it never sees ₪).
//
// The four groups Nitsan picked (2026-10-24): Profit & pace, Clients' money,
// Costs, Month-end close.

import {
  CURRENCY_SYMBOL,
  LINE,
  MONTH_SHORT,
  isPartialYear,
  rateForClientOn,
  type ClientRate,
  type PnlMonthly,
} from "@/lib/finance/finance";
import { formatHours, formatILS, formatILSShort, formatPct, formatShortDay } from "@/lib/finance/format";
import { billFor, rateFor, type RateTerms } from "@/lib/freelance-rate";
import { PLAN_COST_UPLIFT, TARGET_MARGIN, hoursGoal, monthsBack, projectCurrentMonth, projectYear, type GoalInputs } from "@/lib/finance/overview";
import { isFiled } from "@/lib/finance/filing";
import { FX_MARKUP } from "@/lib/finance/fx";
import { RECEIVABLE_TERMS_DAYS } from "@/lib/finance/receivables";
import { paymentDue, termsAdjective } from "@/lib/payment-terms";
import { booksGap, dividendWindow, taxReserve } from "./tax";
import { periodPaidInFinance } from "@/lib/finance-paid";
import type { AccountantYear } from "@/lib/finance/accountant";
import type { CompanyFacts } from "@/lib/finance/scenarios/types";
import { canon, chainsOf, daysBetween as daysApart, liveTools, renews, shiftIso, type Chain, type Subscription, type ToolKind } from "./tools";

export type AdviceKind = "now" | "heads" | "idea";
export type FactValue = string | number | null;

export interface Finding {
  /** signal + subject; the same finding on the next check is the same row */
  key: string;
  signal: string;
  kind: AdviceKind;
  area: string;
  clientId: string | null;
  /** bigger is worse; a snooze breaks when it rises */
  severity: number;
  /** money keys end in Ils/Eur; `figure` is added from below */
  facts: Record<string, FactValue>;
  /** the card's figure chip — the exact amount, from the rule ("−₪12K", "3 to file") */
  figure: string | null;
  /** ⚠️ never an amount: it is what Claude is sent */
  title: string;
  /** may name amounts; stripped before it goes to Claude */
  body: string;
  /** a reminder can be ticked done; advice can only be snoozed */
  reminder: boolean;
  /** where the action goes (an app path, or the tracker's full URL), and its label */
  href: string;
  action: string;
  /**
   * What to point at on that page: space-separated `data-advice` tokens the
   * page puts on its cells ("row:<id>", "month:2026-09", "add-rate"). The
   * action link highlights them and keeps the card floating beside them.
   */
  focus?: string;
  /** a change the card can make itself, on one click (v1.13.0) — see `Fix` */
  fix?: Fix;
}

/**
 * What a card can do for the owner in one click (v1.13.0, Nitsan 2026-11-05:
 * "offer me to update it instead of just sending me to the Expenses page").
 * Only ever Expenses rows of the card's own vendor, never a `final` row:
 * renewals not yet paid can be removed, and an end date set. The fix route
 * (api/advice/[id]/fix) checks all of it again against the database.
 */
export interface Fix {
  /** the button: "Remove the 18 Dec renewal" */
  label: string;
  /** the notice after it: "Everhour's renewal is removed" */
  done: string;
  /** expense rows to delete — renewals dated after today */
  remove?: string[];
  /** end dates to set */
  end?: { id: string; date: string }[];
  /**
   * A new row at the new price (v1.20.1, Nitsan 2026-11-08: Plnty's bigger
   * plan): a copy of row `like`, from `date`, at `amount` in its currency —
   * the server works out the ₪ net. `like` is ended the month before.
   */
  add?: { like: string; date: string; amount: number; description: string };
}

export interface AdviceData {
  /** The accountant’s yearly figures and the company facts, for the tax rules
   * (tax.ts). Supplied by run.ts on the server; without them those rules are silent. */
  figures?: { accountantYears: AccountantYear[]; facts: CompanyFacts };
  /** the studio's today, yyyy-mm-dd */
  today: string;
  /** P&L rows, this year and the two before */
  pnl: PnlMonthly[];
  /** the hours goal's tracker inputs (actions.ts getGoalInputs), or null if they failed */
  goalInputs: GoalInputs | null;
  /** the tracker's clients */
  /** `paymentTermsDays` / `paymentTermsNet`: the client's terms (the tracker's 0065/0066); missing = 14 days */
  clients: { id: string; name: string; billable: boolean; archived: boolean; paymentTermsDays?: number; paymentTermsNet?: boolean }[];
  rates: ClientRate[];
  /** billable hours (billable task of a billable client), per client and month, from four months back */
  hours: { clientId: string; month: string; hours: number }[];
  /** billable hours per client and day over the last 120 days — the tracker &advice's set (Keys tasks out) */
  billableDays: { clientId: string; date: string; hours: number }[];
  /** open leads, counted the digest's way — null when they couldn't be loaded */
  leadsOpen: number | null;
  /**
   * Billing periods ended in the last 60 days, with the hours a client report
   * counts in each, and those logged for the client since it ended.
   */
  periods: { clientId: string; label: string; dateFrom: string; dateTo: string; paid: boolean; hours: number; hoursSince: number }[];
  /** last month's salary, freelance and income rows with their state — the close check */
  /** `paid`: marked paid (reference/0011) — undefined where it isn't tracked or not run yet */
  lastMonthRows: { table: "salaries" | "freelance" | "income"; state: string; amount: number; id?: string; name?: string; paid?: boolean }[];
  /**
   * Salary and freelance rows final and not marked paid from the twelve months
   * before last month ("yyyy-mm") — `monthUnpaid`'s older ones. Optional: absent = not loaded.
   */
  olderUnpaid?: { table: "salaries" | "freelance"; month: string; amount: number; id: string; name: string }[];
  /**
   * Client months marked paid on the Plan (finance_client_monthly.paid_at) —
   * a month is here only when EVERY one of the client's rows for it is paid
   * (run.ts, the tracker's monthsPaidFromPlan) — by tracker client id and by name — the Plan's word on
   * "the client paid", which `periodUnpaid` defers to.
   */
  planPaid?: { clientId: string | null; client: string; month: string }[];
  /** payslips imported per month, "yyyy-mm" → count */
  payslips: Record<string, number>;
  /** months with both official rates stored, "yyyy-mm" */
  fxMonths: string[];
  /** this year's "monthly" expenses — the Expenses page's Monthly tab, where they're filed */
  monthlyExpenses: { date: string; endDate: string | null; filedAt: string | null }[];
  /** sliding-rate currencies by freelancer name (tracker `freelancers.currency`) */
  freelancerCurrency?: Record<string, string>;
  /**
   * Monthly and yearly expense rows from two years back, net ILS (tools.ts) —
   * the Tools checks. Optional: absent = not loaded, and they stay quiet.
   */
  subscriptions?: Subscription[];
  /**
   * Billing mail from Expenses vendors, last 400 days (finance_tool_mail,
   * reference/0015 — lib/mail/scan.ts). Optional: absent = not set up.
   */
  toolMail?: ToolMail[];
  /** receipts in the billing mail no expense row covers (v1.14.0, lib/mail/receipts.ts) */
  receiptsToAdd?: { count: number; newVendors: number };
}

export interface ToolMail {
  id: string;
  account: string;
  vendor: string;
  kind: "receipt" | "renewal" | "price" | "plan" | "cancel" | "failed" | "trial";
  /** yyyy-mm-dd, the studio's day */
  date: string;
  subject: string;
  amount: number | null;
  currency: string | null;
}

/* ── dates and months ───────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");
export const monthKey = (y: number, m: number) => `${y}-${pad(m)}`;
const ymd = (iso: string) => iso.split("-").map(Number) as [number, number, number];

/** The (year, month) `back` months before (year, month). */
export { monthsBack };

/** The studio's today as a Date at local noon — what overview.ts's projections read. */
const noonOf = (iso: string) => {
  const [y, m, d] = ymd(iso);
  return new Date(y, m - 1, d, 12);
};

const monthName = (m: number) => new Date(2000, m - 1, 1).toLocaleDateString("en-GB", { month: "long" });
const span = (months: [number, number][]) =>
  months.length ? `${MONTH_SHORT[months[0][1] - 1]}–${MONTH_SHORT[months[months.length - 1][1] - 1]}` : "";

/** The last `n` complete months before today's month, oldest first. */
function completeMonths(today: string, n: number): [number, number][] {
  const [y, m] = ymd(today);
  return Array.from({ length: n }, (_, i) => monthsBack(y, m, n - i));
}

/* ── P&L lookups ────────────────────────────────────────────────────────── */

type MonthLines = Map<string, number>;
const linesCache = new WeakMap<PnlMonthly[], Map<string, MonthLines>>();
function lines(pnl: PnlMonthly[], y: number, m: number): MonthLines {
  let byMonth = linesCache.get(pnl);
  if (!byMonth) {
    byMonth = new Map();
    for (const r of pnl) {
      const k = monthKey(r.year, r.month);
      const v = byMonth.get(k) ?? new Map<string, number>();
      v.set(r.lineItem, r.value);
      byMonth.set(k, v);
    }
    linesCache.set(pnl, byMonth);
  }
  return byMonth.get(monthKey(y, m)) ?? new Map();
}
const revenueOf = (v: MonthLines) => v.get(LINE.totalRevenues) ?? 0;
const expensesOf = (v: MonthLines) => v.get(LINE.totalExpenses) ?? 0;
const profitOf = (v: MonthLines) => v.get(LINE.profit) ?? revenueOf(v) - expensesOf(v);
const booked = (v: MonthLines) => v.has(LINE.totalRevenues) && revenueOf(v) > 0;

/* ── formatting ─────────────────────────────────────────────────────────── */

const MINUS = "−";
/**
 * "+₪12K" / "−₪3,412": signed, short from ₪10K up. Smaller amounts stay whole,
 * so a list of them adds up on screen (−₪2K and −₪1K beside a −₪4K total read
 * as a mistake — measured 2026-10-24).
 */
function signedShort(n: number): string {
  const a = Math.abs(n);
  const s = a >= 10_000 ? formatILSShort(a) : formatILS(Math.round(a));
  return n < 0 ? `${MINUS}${s}` : `+${s}`;
}
const money = (n: number) => (Math.abs(n) >= 10_000 ? formatILSShort(n) : formatILS(Math.round(n))).replace("-", MINUS);
/** "7%", "−0.3%": whole points, one decimal under a point so a small loss never reads "-0%". */
const pct = (f: number) => formatPct(f, Math.abs(f) < 0.01 && f !== 0 ? 1 : 0).replace("-", MINUS);
const h = (n: number) => formatHours(Math.round(n * 10) / 10);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** `n` to `digits` decimals as a fact. ⚠️ Not round2: toFixed rounds .xx5 its own way, and facts are stored. */
const fixed = (n: number, digits: number) => Number(n.toFixed(digits));
/** "15%": what the Plan's costs are raised by (overview.ts PLAN_COST_UPLIFT). */
const UPLIFT = `${Math.round((PLAN_COST_UPLIFT - 1) * 100)}%`;
const SYMBOL: Record<string, string> = CURRENCY_SYMBOL;

/* ── Profit & pace ──────────────────────────────────────────────────────── */

/**
 * The month's hours against the Overview's goal (overview.ts `hoursGoal`, the
 * same call the Overview's card makes): under break-even pace is "do now"; over
 * break-even but under the 15% target is a heads-up. Quiet for the first three
 * workdays — a day or two of hours says nothing about a month.
 */
export function paceBehind(data: AdviceData): Finding[] {
  const [y, m] = ymd(data.today);
  const goal = hoursGoal(data.pnl, y, noonOf(data.today), { inputs: data.goalInputs ?? undefined });
  if (!goal || goal.workdaysDone < 3 || goal.actualPerDay == null) return [];
  const actual = goal.actualPerDay;
  if (actual >= goal.profit.perDay) return [];
  const below = actual < goal.perDay;
  const projected = actual * goal.effectiveWorkdays;
  const target = below ? goal.hours : goal.profit.hours;
  const shortIls = Math.max(0, target - projected) * goal.rate;
  const name = monthName(m);
  return [
    {
      key: `pace:${monthKey(y, m)}`,
      signal: "pace",
      kind: below ? "now" : "heads",
      area: "Profit",
      clientId: null,
      severity: below ? 3 : 2,
      facts: {
        month: name,
        hoursPerDay: fixed(actual, 1),
        breakEvenPerDay: fixed(goal.perDay, 1),
        targetPerDay: fixed(goal.profit.perDay, 1),
        targetMargin: pct(TARGET_MARGIN),
        shortIls: Math.round(shortIls),
      },
      figure: `${MINUS}${formatILSShort(shortIls)}`,
      title: below ? `${name} is under break-even pace` : `${name} covers its costs, not the ${pct(TARGET_MARGIN)} target`,
      body:
        `${h(actual)}h a workday so far; break-even needs ${h(goal.perDay)}h, the target ${h(goal.profit.perDay)}h. ` +
        `At this pace the month ends about ${money(shortIls)} short of ${below ? "break-even" : "the target"}.`,
      reminder: false,
      href: "/finance",
      action: "Open the hours goal",
    },
  ];
}

/**
 * Months below zero among the last three complete ones. "Do now" only when the
 * three together lost money; losing months inside a profitable quarter are a
 * heads-up (measured 2026-10-24: −₪2K and −₪1K beside +₪44K read as an alarm).
 * The figure is what the losing months lost.
 */
export function lossMonths(data: AdviceData): Finding[] {
  const months = completeMonths(data.today, 3).filter(([y, m]) => booked(lines(data.pnl, y, m)));
  if (months.length < 3) return [];
  const profits = months.map(([y, m]) => profitOf(lines(data.pnl, y, m)));
  const lost = months.filter((_, i) => profits[i] < 0);
  if (lost.length < 2 && profits[2] >= 0) return [];
  const [ly, lm] = months[2];
  const total = profits.reduce((t, p) => t + p, 0);
  const losses = profits.filter((p) => p < 0).reduce((t, p) => t + p, 0);
  const net = total < 0;
  const names = lost.map(([, m]) => monthName(m));
  const list = months.map(([, m], i) => `${MONTH_SHORT[m - 1]} ${signedShort(profits[i])}`).join(", ");
  return [
    {
      key: `loss:${monthKey(ly, lm)}`,
      signal: "loss",
      kind: net ? "now" : "heads",
      area: "Profit",
      clientId: null,
      severity: net ? 3 : lost.length >= 2 ? 2 : 1,
      facts: { months: span(months), lossMonths: lost.length, lossIls: Math.round(losses), totalIls: Math.round(total) },
      figure: signedShort(losses),
      title: net
        ? `${span(months)} lost money: ${lost.length} of 3 months in the red`
        : `${names.join(" and ")} ${names.length === 1 ? "was" : "were"} in the red`,
      body: `${list}; ${net ? "together" : "still"} ${signedShort(total)} over the three.`,
      reminder: false,
      href: "/finance",
      action: "Open the Overview",
    },
  ];
}

/** The year's estimate (overview.ts `projectYear`) 5+ points of margin under last year's. */
export function yearOutlook(data: AdviceData): Finding[] {
  const [y] = ymd(data.today);
  const proj = projectYear(data.pnl, y, noonOf(data.today));
  if (!proj || isPartialYear(y - 1)) return [];
  let revenue = 0;
  let profit = 0;
  for (let m = 1; m <= 12; m++) {
    const v = lines(data.pnl, y - 1, m);
    revenue += revenueOf(v);
    profit += profitOf(v);
  }
  if (revenue <= 0) return [];
  const lastMargin = profit / revenue;
  const drop = lastMargin - proj.margin;
  if (drop < 0.05) return [];
  const loss = proj.profit < 0;
  return [
    {
      key: `year:${y}`,
      signal: "year",
      kind: loss ? "now" : "heads",
      area: "Profit",
      clientId: null,
      severity: loss ? 3 : drop >= 0.1 ? 2 : 1,
      facts: { year: y, marginEstimate: pct(proj.margin), marginLastYear: pct(lastMargin), profitIls: Math.round(proj.profit) },
      figure: signedShort(proj.profit),
      title: `${y} is heading for a ${pct(proj.margin)} margin, against ${pct(lastMargin)} in ${y - 1}`,
      body: `The estimate for the year is ${money(proj.profit)} profit on ${money(proj.revenue)} income (${proj.note}).`,
      reminder: false,
      href: "/finance",
      action: "Open the Overview",
    },
  ];
}

/* ── Clients' money ─────────────────────────────────────────────────────── */

const liveClients = (data: AdviceData) => data.clients.filter((c) => c.billable && !c.archived);
const nameOf = (data: AdviceData, id: string) => data.clients.find((c) => c.id === id)?.name ?? "";

/** The studio's usual payment terms — the tracker's `DEFAULT_PAYMENT_TERMS_DAYS`. */
export const PAYMENT_TERMS_DAYS = RECEIVABLE_TERMS_DAYS;

/**
 * Each client's LAST ended billing period, past its payment date and not marked
 * paid — the tracker's own rule (its `periodUnpaid` + `paymentDueFor`, v1.101.0):
 * invoiced the day after the period ends, due on the CLIENT's terms (14 days;
 * Maccabi net+30 — lib/payment-terms.ts), quiet again after 45 days late;
 * "do now" from 7 days late. Hours logged for the client since (5h+) are work on credit and
 * raise it. Here with the money: report hours × the rate on the period's last day.
 */
export function periodUnpaid(data: AdviceData): Finding[] {
  const out: Finding[] = [];
  for (const c of liveClients(data)) {
    const p = data.periods
      .filter((x) => x.clientId === c.id && x.dateTo < data.today)
      .sort((a, b) => b.dateTo.localeCompare(a.dateTo))[0];
    if (!p || p.paid || p.hours <= 0 || paidOnPlan(data, c, p.dateFrom, p.dateTo)) continue;
    const terms = { days: c.paymentTermsDays ?? PAYMENT_TERMS_DAYS, net: c.paymentTermsNet === true };
    const due = paymentDue(shiftIso(p.dateTo, 1), terms);
    const late = daysApart(due, data.today);
    if (late < 1 || late > 45) continue;
    const onCredit = p.hoursSince >= 5;
    const rate = rateForClientOn(data.rates, c.name, p.dateTo);
    const amount = rate == null ? null : p.hours * rate;
    const credit = rate == null ? null : p.hoursSince * (rateForClientOn(data.rates, c.name, data.today) ?? rate);
    out.push({
      key: `unpaid:${c.id}:${p.dateFrom}`,
      signal: "unpaid",
      kind: late >= 7 ? "now" : "heads",
      area: "Clients",
      clientId: c.id,
      severity: (late >= 21 ? 3 : late >= 7 ? 2 : 1) + (onCredit && late >= 7 ? 1 : 0),
      facts: {
        client: c.name,
        period: p.label,
        dueDate: due,
        daysLate: late,
        hours: fixed(p.hours, 2),
        hoursSince: fixed(p.hoursSince, 2),
        rateIls: rate,
        amountIls: amount == null ? null : Math.round(amount),
        creditIls: credit == null || !onCredit ? null : Math.round(credit),
      },
      figure: amount == null ? "no rate" : formatILSShort(amount),
      title: `${c.name}: ${p.label} is ${late} ${late === 1 ? "day" : "days"} past its payment date`,
      body:
        (amount == null
          ? `${formatHours(p.hours)}h in the period and no rate on its last day`
          : `${formatHours(p.hours)}h × ${formatILS(rate!)} = ${formatILS(Math.round(amount))} before VAT`) +
        `, due ${formatShortDay(due)} (${termsAdjective(terms)} terms).` +
        (onCredit
          ? ` ${formatHours(p.hoursSince)}h more logged for them since${credit == null ? "" : ` (≈${money(credit)})`} — a polite nudge now, before more work goes out on credit.`
          : " If it's paid, tick it in the tracker; if not, a short reminder."),
      reminder: true,
      href: `/client-reports?client=${c.id}`,
      action: "Open in the tracker",
    });
  }
  return out;
}

/**
 * Every month a period touches is marked paid on the Plan for this client
 * (Nitsan, 2026-10-31: one place says "the client paid" — the Plan's Paid
 * step wins over a period the tracker hasn't ticked, so the card doesn't
 * chase money that's in).
 */
function paidOnPlan(data: AdviceData, c: { id: string; name: string }, from: string, to: string): boolean {
  if (!data.planPaid?.length) return false;
  const paid = new Set(data.planPaid.filter((r) => r.clientId === c.id || r.client === c.name).map((r) => r.month));
  return periodPaidInFinance({ dateFrom: from, dateTo: to }, paid);
}

/** A billable client with hours this month or last and no rate: the P&L counts those hours as ₪0. */
export function noRate(data: AdviceData): Finding[] {
  const [y, m] = ymd(data.today);
  const months = [monthsBack(y, m, 1), [y, m] as [number, number]];
  const out: Finding[] = [];
  for (const c of liveClients(data)) {
    for (const [my, mm] of months) {
      const k = monthKey(my, mm);
      const hrs = data.hours.filter((x) => x.clientId === c.id && x.month === k).reduce((t, x) => t + x.hours, 0);
      if (hrs <= 0 || rateForClientOn(data.rates, c.name, `${k}-15`) != null) continue;
      out.push({
        key: `no-rate:${c.id}:${k}`,
        signal: "no-rate",
        kind: "now",
        area: "Clients",
        clientId: c.id,
        severity: 3,
        facts: { client: c.name, month: monthName(mm), hours: fixed(hrs, 2) },
        figure: `${formatHours(hrs)}h at ₪0`,
        title: `${c.name} has hours in ${monthName(mm)} but no rate`,
        body: `${formatHours(hrs)} billable hours count as ₪0 income in the P&L until a rate covers ${MONTH_SHORT[mm - 1]} ${my}.`,
        reminder: false,
        href: `/finance/rates?client=${encodeURIComponent(c.name)}&from=${k}-01`,
        action: "Add their rate",
        focus: "add-rate",
      });
      break; // one card per client: the earlier month says it
    }
  }
  return out;
}

/** Billable hours and their income (× the rate that day) per client, `from`–`to` inclusive. */
function billableBy(data: AdviceData, from: string, to = data.today): Map<string, { hours: number; income: number }> {
  const out = new Map<string, { hours: number; income: number }>();
  for (const x of data.billableDays) {
    if (x.date < from || x.date > to) continue;
    const rate = rateForClientOn(data.rates, nameOf(data, x.clientId), x.date) ?? 0;
    const cur = out.get(x.clientId) ?? { hours: 0, income: 0 };
    cur.hours += x.hours;
    cur.income += x.hours * rate;
    out.set(x.clientId, cur);
  }
  return out;
}

/**
 * One client holding 40%+ of the last 90 days' billable hours (100h+ in all) —
 * the tracker's `concentration` (its v1.81.0), so the two panes agree, here
 * with the income those hours brought and how many leads are open.
 */
export function concentration(data: AdviceData): Finding[] {
  const by = billableBy(data, shiftIso(data.today, -90));
  const total = [...by.values()].reduce((t, v) => t + v.hours, 0);
  if (total < 100 || by.size === 0) return [];
  const [id, top] = [...by].sort((a, b) => b[1].hours - a[1].hours)[0];
  const share = top.hours / total;
  if (share < 0.4) return [];
  const name = nameOf(data, id);
  const income = [...by.values()].reduce((t, v) => t + v.income, 0);
  const leads = data.leadsOpen;
  const [y, m] = ymd(data.today);
  return [
    {
      key: `concentration:${id}:${monthKey(y, m)}`,
      signal: "concentration",
      kind: "idea",
      area: "Clients",
      clientId: id,
      severity: share >= 0.55 ? 2 : 1,
      facts: { client: name, share: pct(share), hours: fixed(top.hours, 2), ...(leads == null ? {} : { leadsOpen: leads }), incomeIls: Math.round(top.income) },
      figure: formatILSShort(top.income),
      title: `${name} is ${pct(share)} of the studio's billable work`,
      body:
        `${formatHours(top.hours)}h of the last 90 days' billable hours, ${money(top.income)} of ${money(income)} in hourly income. If they paused, that much would stop with them.` +
        (leads == null ? "" : leads ? ` ${plural(leads, "lead is", "leads are")} open — which could become the second anchor?` : " No leads are open — a good month to start conversations."),
      reminder: false,
      href: "/leads",
      action: "Open Leads in the tracker",
    },
  ];
}

/**
 * A client gone quiet — the tracker's `client-quiet` (its v1.81.0): 15h+ a
 * month over the three months before, under 40% of that in the last 30 days.
 * Here with the hourly income a month that went quiet.
 */
export function clientQuiet(data: AdviceData): Finding[] {
  const before = billableBy(data, shiftIso(data.today, -120), shiftIso(data.today, -31));
  const recent = billableBy(data, shiftIso(data.today, -30));
  const [y, m] = ymd(data.today);
  const out: Finding[] = [];
  for (const [id, b] of before) {
    const monthly = b.hours / 3;
    const last = recent.get(id) ?? { hours: 0, income: 0 };
    if (monthly < 15 || last.hours >= monthly * 0.4) continue;
    const name = nameOf(data, id);
    const lost = b.income / 3 - last.income;
    out.push({
      key: `client-quiet:${id}:${monthKey(y, m)}`,
      signal: "client-quiet",
      kind: "idea",
      area: "Clients",
      clientId: id,
      severity: last.hours === 0 ? 2 : 1,
      facts: { client: name, monthlyHours: fixed(monthly, 2), lastHours: fixed(last.hours, 2), monthlyIls: Math.round(b.income / 3), lastIls: Math.round(last.income) },
      figure: signedShort(-lost),
      title: `${name} has gone quiet`,
      body: `About ${Math.round(monthly)}h (${money(b.income / 3)}) a month over the three months before; ${last.hours ? `${formatHours(last.hours)}h (${money(last.income)})` : "nothing"} in the last 30 days. A natural moment to check in — is there a next phase to propose?`,
      reminder: false,
      href: "/finance/plan",
      action: "Open the Plan",
    });
  }
  return out;
}

/* ── Costs ──────────────────────────────────────────────────────────────── */

const shareOver = (data: AdviceData, months: [number, number][], line: string) => {
  let cost = 0;
  let income = 0;
  for (const [y, m] of months) {
    const v = lines(data.pnl, y, m);
    if (!booked(v)) continue;
    cost += v.get(line) ?? 0;
    income += revenueOf(v);
  }
  return income > 0 ? { share: cost / income, cost, income } : null;
};

/** Salaries' share of income over the last three complete months, 5+ points over the twelve before. */
export function salariesShare(data: AdviceData): Finding[] {
  const recent = completeMonths(data.today, 3);
  const [y, m] = ymd(data.today);
  const before = Array.from({ length: 12 }, (_, i) => monthsBack(y, m, 15 - i));
  const now = shareOver(data, recent, LINE.salaries);
  const then = shareOver(data, before, LINE.salaries);
  if (!now || !then) return [];
  const rise = now.share - then.share;
  if (rise < 0.05) return [];
  const last = recent[2];
  return [
    {
      key: `salaries:${monthKey(...last)}`,
      signal: "salaries",
      kind: "heads",
      area: "Costs",
      clientId: null,
      severity: rise >= 0.1 ? 2 : 1,
      facts: { months: span(recent), share: pct(now.share), shareBefore: pct(then.share), salariesIls: Math.round(now.cost) },
      figure: formatILSShort(now.cost),
      title: `Salaries took ${pct(now.share)} of income over ${span(recent)}`,
      body: `Up from ${pct(then.share)} in the twelve months before: ${money(now.cost)} of ${money(now.income)}.`,
      reminder: false,
      href: "/finance/salaries",
      action: "Open Salaries",
    },
  ];
}

/**
 * A freelancer paid by tracker hours already over this month's plan (10% and
 * ₪1,000+), costed at what they've logged exactly as the hours goal costs them — with
 * where they sit on their sliding rate, when they have one.
 */
export function freelanceOver(data: AdviceData): Finding[] {
  const [y, m] = ymd(data.today);
  const goal = hoursGoal(data.pnl, y, noonOf(data.today), { inputs: data.goalInputs ?? undefined });
  if (!goal) return [];
  const terms = new Map<string, { terms: RateTerms; currency: string }>();
  for (const f of data.goalInputs?.freelancers ?? []) if (f.terms) terms.set(f.name, { terms: f.terms, currency: "ILS" });
  for (const f of data.goalInputs?.formulaFreelancers ?? [])
    terms.set(f.name, { terms: f.terms, currency: data.freelancerCurrency?.[f.name] ?? "EUR" });
  const out: Finding[] = [];
  for (const f of goal.freelance) {
    const over = f.cost - f.planned;
    if (over < Math.max(1000, f.planned * 0.1)) continue;
    const t = terms.get(f.name);
    // No symbol for the currency → its code, so the rate still reads as money
    // (and stripAmounts can find it before the body goes to Claude).
    const sym = t ? SYMBOL[t.currency] ?? `${t.currency} ` : "";
    const slide = t
      ? ` At ${h(f.hours)}h the rate is ${sym}${rateFor(f.hours, t.terms)}/h; it bottoms at ${sym}${t.terms.rateLow}/h from ${t.terms.hoursHigh}h.`
      : "";
    out.push({
      key: `freelance:${f.name}:${monthKey(y, m)}`,
      signal: "freelance",
      kind: "heads",
      area: "Costs",
      clientId: null,
      severity: f.planned > 0 && over / f.planned >= 0.3 ? 2 : 1,
      facts: {
        person: f.name,
        month: monthName(m),
        hoursForecast: fixed(f.hours, 1),
        overPlan: f.planned > 0 ? pct(over / f.planned) : null,
        costIls: Math.round(f.cost),
        plannedIls: Math.round(f.planned),
        ...(t ? { billEur: t.currency === "EUR" ? billFor(f.hours, t.terms) : null } : {}),
      },
      figure: `+${formatILSShort(over)}`,
      title: `${f.name} is over this month's plan`,
      body: `With ${h(f.hours)}h logged so far, ${monthName(m)} costs ≈${money(f.cost)} against ${money(f.planned)} planned.${slide}`,
      reminder: false,
      href: "/finance/freelance",
      action: "Open Freelance",
    });
  }
  return out;
}

const EXPENSE_LINE_LABELS: [string, string][] = [
  [LINE.rentExpenses, "Rent"],
  [LINE.expensesMonthly, "Monthly expenses"],
  [LINE.expensesYearly, "Yearly expenses"],
  [LINE.expensesMisc, "Misc expenses"],
  [LINE.expensesOther, "Expenses"],
  [LINE.expensesAccounting, "Accounting"],
  [LINE.expensesLawyer, "Lawyer"],
  [LINE.expensesGur, "Gur"],
];

/** An expense line in the last complete month 30%+ and ₪2,000+ over its six months before. */
export function expenseJump(data: AdviceData): Finding[] {
  const [last, ...before] = completeMonths(data.today, 7).reverse();
  const out: Finding[] = [];
  for (const [line, label] of EXPENSE_LINE_LABELS) {
    const now = lines(data.pnl, ...last).get(line);
    const prior = before.map((ym) => lines(data.pnl, ...ym).get(line)).filter((v): v is number => v != null);
    if (now == null || prior.length < 3) continue;
    const avg = prior.reduce((t, v) => t + v, 0) / prior.length;
    const up = now - avg;
    if (up < 2000 || up < avg * 0.3) continue;
    out.push({
      key: `expense:${line}:${monthKey(...last)}`,
      signal: "expense",
      kind: "heads",
      area: "Costs",
      clientId: null,
      severity: avg > 0 && up / avg >= 1 ? 2 : 1,
      facts: { line: label, month: monthName(last[1]), rise: avg > 0 ? pct(up / avg) : null, monthIls: Math.round(now), averageIls: Math.round(avg) },
      figure: `+${formatILSShort(up)}`,
      title: `${label} jumped in ${monthName(last[1])}`,
      body: `${money(now)}, against ${money(avg)} a month over the ${prior.length} months before.`,
      reminder: false,
      href: "/finance/expenses",
      action: "Open Expenses",
    });
  }
  return out;
}

/**
 * Monthly invoices not filed (the Expenses page's marks, lib/filing.ts). Filing
 * is the first week of the month: a heads-up through the 7th, "do now" from the
 * 8th (which breaks a week-one snooze), nothing from the 25th, when the marks
 * start over.
 */
export function unfiled(data: AdviceData): Finding[] {
  const [y, m, d] = ymd(data.today);
  if (d >= 25) return [];
  const now = noonOf(data.today);
  // The page's own count: every row not ended (its isEnded), whatever its start date.
  const live = data.monthlyExpenses.filter((r) => !r.endDate || r.endDate >= data.today);
  const open = live.filter((r) => !isFiled(r.filedAt, now)).length;
  if (open === 0) return [];
  const late = d >= 8;
  return [
    {
      key: `unfiled:${monthKey(y, m)}`,
      signal: "unfiled",
      kind: late ? "now" : "heads",
      area: "Close",
      clientId: null,
      severity: late ? 2 : 1,
      facts: { open, of: live.length, month: monthName(m) },
      figure: `${open} to file`,
      title: late ? `${plural(open, "monthly invoice isn't", "monthly invoices aren't")} filed yet` : `Filing week: ${plural(open, "invoice", "invoices")} to file`,
      body: `${open} of ${live.length} live monthly expenses have no filing mark since the 25th.`,
      reminder: true,
      href: "/finance/expenses",
      action: "Open Expenses",
    },
  ];
}

/* ── Tools: the studio's subscriptions (v1.11.0) ────────────────────────── */
// Nitsan, 2026-11-05: "suggest losing an account, or switching to a better or
// cheaper one". The rules find the moments and the overlaps; the "Review the
// tools" step (review.ts) asks Claude what to do about them.

/** A yearly renewal this close is worth a decision — the last moment to cancel or switch. */
const RENEWAL_DAYS = 45;
/** Under this a year (net ₪) a renewal isn't worth a card — a domain, a font. */
const RENEWAL_MIN_ILS = 200;

const NUMBER_WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const renewSpan = (months: number) => (months === 12 ? "a year" : months % 12 === 0 ? `${months / 12} years` : `${months} months`);
/** The tab a chain's rows are on, and the year to open. */
export const toolHref = (c: Chain, row = c.upcoming ?? c.current ?? c.rows[c.rows.length - 1]) => `/finance/expenses?tab=${c.category}&year=${row.date.slice(0, 4)}`;
const tools = (data: AdviceData) => liveTools(data.subscriptions ?? [], data.today);

/** Other live tools that do one of `c`'s jobs, by vendor. */
function sameJob(c: Chain & { kinds: ToolKind[] }, all: (Chain & { kinds: ToolKind[] })[]): string[] {
  const names = new Set<string>();
  for (const o of all)
    if (o.vendor.toLowerCase() !== c.vendor.toLowerCase() && o.kinds.some((k) => c.kinds.includes(k))) names.add(o.vendor);
  return [...names];
}

/**
 * A yearly subscription renewing in the next 45 days (₪200+): the moment to
 * cancel, downgrade or switch, with what else does the same job and how the
 * price moved. "Do now" in the last ten days, which also breaks a snooze.
 */
export function renewalSoon(data: AdviceData): Finding[] {
  const all = tools(data);
  // Already cancelled by mail: its own card offers to stop the renewal (cancelledStill).
  const stopped = new Set(cancelledStill(data, all).map((f) => String(f.facts.vendor).toLowerCase()));
  const out: Finding[] = [];
  for (const c of all) {
    if (c.category !== "yearly" || !c.nextRenewal || stopped.has(c.vendor.toLowerCase())) continue;
    const days = daysApart(data.today, c.nextRenewal);
    if (days < 0 || days > RENEWAL_DAYS) continue;
    const row = c.upcoming ?? c.current!;
    if (row.netIls < RENEWAL_MIN_ILS) continue;
    const soon = days <= 10;
    const plan = (row.description || c.current?.description || "").trim();
    const moved = c.priceChange != null && Math.abs(c.priceChange) >= 0.1 ? `, ${c.priceChange > 0 ? "up" : "down"} ${pct(Math.abs(c.priceChange))} on last time` : "";
    const inHouse = c.kinds.find((k) => k.inHouse)?.inHouse;
    const others = sameJob(c, all.filter(renews));
    out.push({
      key: `renewal:${c.id}:${c.nextRenewal}`,
      signal: "renewal",
      kind: soon ? "now" : "heads",
      area: "Costs",
      clientId: null,
      severity: soon ? 2 : 1,
      facts: {
        vendor: c.vendor,
        plan: plan || null,
        renews: c.nextRenewal,
        days,
        covers: renewSpan(row.renewMonths),
        priceChange: c.priceChange == null ? null : pct(c.priceChange),
        sameJob: others.length ? others.join(", ") : null,
        priceIls: Math.round(row.netIls),
      },
      figure: money(row.netIls),
      title: `${c.vendor} renews on ${formatShortDay(c.nextRenewal)}`,
      body:
        `${money(row.netIls)} for ${renewSpan(row.renewMonths)}${plan ? ` (${plan})` : ""}${moved}. Until then you can still cancel, downgrade or switch.` +
        (inHouse ? ` ${inHouse} — is ${c.vendor} still used?` : others.length ? ` ${listOf(others)} ${others.length === 1 ? "does" : "do"} the same job.` : ""),
      reminder: false,
      href: toolHref(c, row),
      action: "Show it on Expenses",
      focus: `row:${row.id}`,
      fix: wontRenew(c, data.today),
    });
  }
  return out;
}

/**
 * "Won't renew" in one click (v1.15.1, Nitsan 2026-11-06: the Wix renewal
 * "can't be turned off"): the running period ends the day before the renewal,
 * and a renewal already entered for later is removed. Not for a locked row.
 */
function wontRenew(c: Chain, today: string): Fix | undefined {
  const cur = c.current;
  if (!cur || !c.nextRenewal || cur.state === "final") return undefined;
  const later = c.rows.filter((r) => r.date > today);
  if (later.some((r) => r.state === "final")) return undefined;
  const last = shiftIso(c.nextRenewal, -1);
  return {
    label: "Won't renew",
    done: `${c.vendor} won't renew — it ends ${formatShortDay(last)}`,
    end: [{ id: cur.id, date: last }],
    ...(later.length ? { remove: later.map((r) => r.id) } : {}),
  };
}

/**
 * Two or more live tools doing the same job (tools.ts TOOL_KINDS) — or one
 * paid tool for a job the studio now does in-house (time tracking: the
 * tracker). One card per job, with their cost a year together.
 */
export function toolOverlap(data: AdviceData): Finding[] {
  // A tool already cancelled is on its way out — not one to drop (Nitsan, 2026-11-09: ls.graphics).
  const all = tools(data).filter(renews);
  const kinds = [...new Set(all.flatMap((c) => c.kinds))];
  const groups = kinds
    .map((k) => {
      const members = all.filter((c) => c.kinds.includes(k)).sort((a, b) => b.yearIls - a.yearIls);
      return { k, members, vendors: [...new Set(members.map((c) => c.vendor))] };
    })
    .filter((g) => (g.k.inHouse ? g.vendors.length >= 1 : g.vendors.length >= 2));
  // One card per set of tools: Google + Microsoft as office suites is already
  // said by the files card that names them both (and two more).
  const covered = (g: (typeof groups)[number]) =>
    !g.k.inHouse && groups.some((o) => o !== g && !o.k.inHouse && o.vendors.length > g.vendors.length && g.vendors.every((v) => o.vendors.includes(v)));
  const out: Finding[] = [];
  for (const g of groups) {
    const { k, members, vendors } = g;
    if (covered(g)) continue;
    // Renewing within the renewal window, an in-house job is already on its renewal card.
    if (k.inHouse && members.every((c) => c.nextRenewal && daysApart(data.today, c.nextRenewal) <= RENEWAL_DAYS)) continue;
    const total = members.reduce((t, c) => t + c.yearIls, 0);
    // What keeping only the biggest would save — the whole lot for a job done in-house.
    const byVendor = vendors.map((v) => members.filter((c) => c.vendor === v).reduce((t, c) => t + c.yearIls, 0));
    const saving = k.inHouse ? total : total - Math.max(...byVendor);
    if (saving < RENEWAL_MIN_ILS) continue;
    const named = vendors.map((v) => {
      const mine = members.filter((c) => c.vendor === v);
      const next = mine.map((c) => c.nextRenewal).filter((d): d is string => !!d && daysApart(data.today, d) <= 90).sort()[0];
      const extra = [mine.length > 1 ? `${mine.length} subscriptions` : "", next ? `renews ${formatShortDay(next)}` : ""].filter(Boolean).join(", ");
      return extra ? `${v} (${extra})` : v;
    });
    // A job one of them already covers as part of a bigger plan (Google Workspace's Drive and Meet).
    const bundled = [...new Set(k.kind === "Office and email" ? [] : members.filter((c) => c.kinds.some((o) => o.kind === "Office and email")).map((c) => c.vendor))];
    const top = members[0];
    out.push({
      key: `overlap:${k.kind}`,
      signal: "overlap",
      kind: "idea",
      area: "Costs",
      clientId: null,
      severity: members.some((c) => c.nextRenewal && daysApart(data.today, c.nextRenewal) <= RENEWAL_DAYS) ? 2 : 1,
      facts: { job: k.kind, tools: vendors.join(", "), subscriptions: members.length, inHouse: k.inHouse ?? null, yearIls: Math.round(total), savingIls: Math.round(saving) },
      figure: k.inHouse ? `${money(saving)}/yr` : `up to ${money(saving)}/yr`,
      title: k.inHouse
        ? `${listOf(vendors)} — ${k.kind.toLowerCase()} is done in-house now`
        : `${NUMBER_WORDS[vendors.length] ?? vendors.length} ${k.plural} at once`,
      body: k.inHouse
        ? `${k.inHouse}, yet ${listOf(named)} ${vendors.length === 1 ? "is" : "are"} still paid for: ${money(total)} a year. If nothing needs ${vendors.length === 1 ? "it" : "them"} any more, cancel before the next renewal.`
        : `${listOf(named)}: ${money(total)} a year together; keeping only ${vendors[byVendor.indexOf(Math.max(...byVendor))]} would save ${money(saving)}.` +
          (bundled.length ? ` ${listOf(bundled.map((v) => `${v}'s`))} ${bundled.length === 1 ? "plan already includes" : "plans already include"} this.` : "") +
          ` Keep any that earns its place (a client works in it, or it does something the others can't).`,
      reminder: false,
      href: toolHref(top),
      action: "Show them on Expenses",
      focus: members.flatMap((c) => (c.current ? [`row:${(c.upcoming ?? c.current).id}`] : [])).join(" "),
    });
  }
  return out;
}

/** A yearly renewal paid in the last 60 days for 25%+ (and ₪300+ a year) more than the time before. */
export function priceUp(data: AdviceData): Finding[] {
  const out: Finding[] = [];
  for (const c of tools(data)) {
    if (c.category !== "yearly" || c.upcoming || !c.current || c.priceChange == null || c.priceChange < 0.25) continue;
    const row = c.current;
    const i = c.rows.indexOf(row);
    const prev = c.rows[i - 1];
    const ago = daysApart(row.date, data.today);
    if (!prev || ago > 60) continue;
    const up = (row.netIls - prev.netIls) * (12 / row.renewMonths);
    if (up < 300) continue;
    out.push({
      key: `price-up:${row.id}`,
      signal: "price-up",
      kind: "heads",
      area: "Costs",
      clientId: null,
      severity: c.priceChange >= 0.5 ? 2 : 1,
      facts: { vendor: c.vendor, rise: pct(c.priceChange), renewed: row.date, priceIls: Math.round(row.netIls), beforeIls: Math.round(prev.netIls) },
      figure: `+${money(up)}/yr`,
      title: `${c.vendor}'s price went up at renewal`,
      body: `${pct(c.priceChange)} more than the time before: ${money(row.netIls)} against ${money(prev.netIls)}. Worth a look at a cheaper tier, fewer seats or a competitor before the next one.`,
      reminder: false,
      href: toolHref(c, row),
      action: "Show it on Expenses",
      focus: `row:${row.id}`,
    });
  }
  return out;
}

/**
 * What paying in dollars and euros costs a year: the 5% the app adds to the
 * Bank of Israel rate for the bank's or card's charge (fx.ts FX_MARKUP),
 * over every live foreign subscription. ₪300+ a year.
 */
export function fxFee(data: AdviceData): Finding[] {
  const foreign = tools(data).filter((c) => (c.upcoming ?? c.current)!.currency !== "ILS");
  const fee = (c: Chain) => (c.yearIls * FX_MARKUP) / (1 + FX_MARKUP);
  const total = foreign.reduce((t, c) => t + fee(c), 0);
  if (total < 300) return [];
  const top = [...foreign].sort((a, b) => fee(b) - fee(a)).slice(0, 3).map((c) => c.vendor);
  return [
    {
      key: `fx-fee:${data.today.slice(0, 4)}`,
      signal: "fx-fee",
      kind: "idea",
      area: "Costs",
      clientId: null,
      severity: 1,
      facts: { subscriptions: foreign.length, markup: pct(FX_MARKUP), biggest: top.join(", "), feeIls: Math.round(total) },
      figure: `${money(total)}/yr`,
      title: `${foreign.length} subscriptions are billed in dollars or euros`,
      body: `The bank or card adds about ${pct(FX_MARKUP)} to each foreign charge: ≈${money(total)} a year, most of it on ${listOf(top)}. A card with low foreign-exchange fees, or paying in shekels where the vendor offers it, saves most of that.`,
      reminder: false,
      href: "/finance/expenses?tab=monthly",
      action: "Open Expenses",
    },
  ];
}

/* ── Billing mail (v1.12.0) ─────────────────────────────────────────────── */
// Nitsan, 2026-11-05: read nitsan@, office@ and studio@ for renewals,
// cancellations and price changes. lib/mail/scan.ts stores what each billing
// email from an Expenses vendor is; these turn the telling ones into cards.

const quoted = (s: string) => `"${s.length > 90 ? `${s.slice(0, 88)}…` : s}"`;
const sameVendor = (a: string, b: string) => canon(a) === canon(b);
const firstWordOf = (s: string) => s.trim().toLowerCase().split(/\s+/)[0] ?? "";
/**
 * One vendor's plans: "Claude pro", "Claude max" and "Claude" (receipts.ts
 * `covered` counts them the same way). Anthropic's receipts can't tell the
 * plans apart, so one filed under an ended plan may be the one still running.
 */
const sameFamily = (a: string, b: string) => sameVendor(a, b) || (firstWordOf(a).length >= 4 && firstWordOf(a) === firstWordOf(b));

/**
 * Mail that changes something, last 30 days: billing trouble (a declined
 * card, a suspension, a quota), a cancellation, a price or plan change, a
 * trial ending, a renewal notice.
 */
export function mailNotice(data: AdviceData): Finding[] {
  const mail = data.toolMail ?? [];
  if (!mail.length) return [];
  const all = tools(data);
  const renewing = new Set(renewalSoon(data).map((f) => String(f.facts.vendor).toLowerCase()));
  // The latest of each vendor and kind.
  const latest = new Map<string, ToolMail>();
  for (const m of mail) {
    if (m.kind === "receipt" || daysApart(m.date, data.today) > 30 || daysApart(m.date, data.today) < 0) continue;
    const k = `${m.vendor.toLowerCase()}|${m.kind}`;
    const was = latest.get(k);
    if (!was || m.date > was.date) latest.set(k, m);
  }
  // A cancellation Expenses still renews gets its own card with a fix, however old the mail.
  const stopped = cancelledStill(data, all);
  const stops = new Set(stopped.map((f) => String(f.facts.vendor).toLowerCase()));
  const out: Finding[] = [...stopped];
  for (const m of latest.values()) {
    const mine = all.filter((c) => sameVendor(c.vendor, m.vendor));
    const live = mine.length > 0;
    const yearly = mine.find((c) => c.category === "yearly");
    const chain = yearly ?? mine[0];
    let card: { kind: AdviceKind; severity: number; title: string; body: string } | null = null;
    const said = `${quoted(m.subject)} — ${m.account}, ${formatShortDay(m.date)}.`;
    // Billing trouble that a later receipt shows was sorted out is no news.
    const paidSince = mail.some((r) => r.kind === "receipt" && sameVendor(r.vendor, m.vendor) && r.date >= m.date);
    if (m.kind === "failed" && paidSince) continue;
    if (m.kind === "failed")
      card = { kind: "now", severity: 3, title: `${m.vendor}: billing needs attention`, body: `${said} Check ${m.vendor}'s billing page — a declined card or a hold stops the service.` };
    else if (m.kind === "cancel" && live && !stops.has(m.vendor.toLowerCase()))
      card = { kind: "heads", severity: 2, title: `${m.vendor} says the subscription ended`, body: `${said} Expenses still has it running — if it's really over, give it an end date so the plan stops counting it.` };
    else if (m.kind === "price")
      card = {
        kind: "heads",
        severity: 2,
        title: `${m.vendor} is changing its price`,
        body: `${said} Check the new price${chain?.nextRenewal ? ` before the renewal on ${formatShortDay(chain.nextRenewal)}` : " before the next charge"}, and update its row on Expenses.`,
      };
    else if (m.kind === "plan" && live)
      card = { kind: "heads", severity: 1, title: `${m.vendor}'s plan changed`, body: `${said} If seats or the plan changed, update its row on Expenses so the costs stay true.` };
    else if (m.kind === "trial")
      card = { kind: "heads", severity: 1, title: `${m.vendor}'s trial is ending`, body: `${said} Decide before it turns into a paid plan.` };
    else if (m.kind === "renewal" && !live)
      card = { kind: "heads", severity: 2, title: `${m.vendor} sent a renewal notice`, body: `${said} Its row on Expenses has ended — if it renews, it's being paid for without being counted.` };
    else if (m.kind === "renewal" && yearly && !renewing.has(m.vendor.toLowerCase()))
      card = { kind: "heads", severity: 1, title: `${m.vendor} sent a renewal notice`, body: `${said} Until it renews you can still cancel, downgrade or switch.` };
    if (!card) continue;
    const row = chain ? (chain.upcoming ?? chain.current) : null;
    // Billing trouble is sorted out on the vendor's own billing page, not on Expenses.
    const billing = m.kind === "failed" || m.kind === "trial" ? billingUrl(m.vendor) : null;
    out.push({
      key: `mail:${m.kind}:${m.vendor.toLowerCase()}:${m.date.slice(0, 7)}`,
      signal: "mail",
      area: "Costs",
      clientId: null,
      ...card,
      facts: { vendor: m.vendor, mail: m.kind, sent: m.date, mailbox: m.account, subject: m.subject },
      figure: null,
      reminder: m.kind === "failed",
      ...(billing
        ? { href: billing, action: `Open ${m.vendor}'s billing` }
        : {
            href: chain && row ? toolHref(chain, row) : "/finance/expenses?tab=yearly",
            action: chain ? "Show it on Expenses" : "Open Expenses",
            ...(row ? { focus: `row:${row.id}` } : {}),
          }),
    });
  }
  return out;
}

/**
 * Receipts the billing scan found that Expenses has no row for (v1.14.0,
 * Nitsan 2026-11-05): one card pointing at the "From your mail" list, where
 * each is added, dismissed or silenced.
 */
export function receiptsWaiting(data: AdviceData): Finding[] {
  const r = data.receiptsToAdd;
  if (!r?.count) return [];
  const newOnes = r.newVendors ? ` — ${r.newVendors} from ${r.newVendors === 1 ? "a vendor" : "vendors"} not on Expenses yet` : "";
  return [
    {
      key: "mail-receipts",
      signal: "mail",
      kind: "heads",
      area: "Costs",
      clientId: null,
      severity: r.count >= 10 ? 2 : 1,
      facts: { receipts: r.count, newVendors: r.newVendors },
      figure: `${r.count} to add`,
      title: `${r.count === 1 ? "A receipt" : `${r.count} receipts`} from the mail ${r.count === 1 ? "isn't" : "aren't"} on Expenses`,
      body: `Found in the billing mail with no row on Expenses${newOnes}. Each is ready to add with its amount and category — check it, then add or dismiss.`,
      reminder: false,
      href: "/finance/expenses",
      action: "Review them on Expenses",
      focus: "mail-receipts",
    },
  ];
}

/** Where each vendor's billing is fixed — a declined card, a hold, a trial. Only pages known to exist. */
const BILLING_URLS: [RegExp, string][] = [
  [/^zoom/i, "https://zoom.us/billing"],
  [/^google/i, "https://admin.google.com/ac/billing/subscriptions"],
  [/^adobe/i, "https://account.adobe.com/plans"],
  [/^wix/i, "https://manage.wix.com/account/billing"],
  [/^supabase/i, "https://supabase.com/dashboard/org/_/billing"],
  [/^(claude|anthropic)/i, "https://claude.ai/settings/billing"],
  [/^spotify/i, "https://www.spotify.com/account/subscription/"],
  [/^dropbox/i, "https://www.dropbox.com/account/plan"],
];
export const billingUrl = (vendor: string) => BILLING_URLS.find(([re]) => re.test(vendor.trim()))?.[1] ?? null;

/**
 * A cancellation mail (up to 400 days old) for a tool Expenses still pays for
 * after it: a yearly renewal entered for later, or a monthly row still open.
 * The card offers to stop it — remove the renewal, or end the row on the day
 * the mail came (Nitsan, 2026-11-05: Everhour cancelled in August, Maxon in
 * October, both still renewing in December). Not when anything shows it was
 * taken up again: a period that started after the mail, or a later receipt.
 * A vendor with several live subscriptions isn't guessed at.
 */
function cancelledStill(data: AdviceData, all = tools(data)): Finding[] {
  const mail = data.toolMail ?? [];
  const latest = new Map<string, ToolMail>();
  for (const m of mail) {
    const age = daysApart(m.date, data.today);
    if (m.kind !== "cancel" || age > 400 || age < 0) continue;
    const was = latest.get(m.vendor.toLowerCase());
    if (!was || m.date > was.date) latest.set(m.vendor.toLowerCase(), m);
  }
  const out: Finding[] = [];
  for (const m of latest.values()) {
    const mine = all.filter((c) => sameVendor(c.vendor, m.vendor));
    if (mine.length !== 1) continue;
    const c = mine[0];
    if (mail.some((r) => r.kind === "receipt" && sameVendor(r.vendor, m.vendor) && daysApart(m.date, r.date) > 3)) continue;
    // Renewed after the mail after all.
    if (c.rows.some((r) => r.date > m.date && r.date <= data.today)) continue;
    const open = c.rows.filter((r) => r.date <= m.date && (c.category === "yearly" ? r === c.current : !r.endDate || r.endDate > m.date));
    if (!open.length || open.some((r) => r.state === "final")) continue;
    const later = c.rows.filter((r) => r.date > data.today && r.state !== "final");
    // Yearly: what's left is the renewal entered for later (or the countdown to one).
    if (c.category === "yearly" && !later.length && !c.nextRenewal) continue;
    const end = open.filter((r) => r.endDate !== m.date).map((r) => ({ id: r.id, date: m.date }));
    const saved = c.category === "yearly" ? later.reduce((a, r) => a + r.netIls, 0) : open.reduce((a, r) => a + r.netIls, 0);
    const next = later[0]?.date ?? c.nextRenewal;
    const said = `${quoted(m.subject)} — ${m.account}, ${formatShortDay(m.date)}.`;
    const refund = /refund/i.test(m.subject) ? " The mail mentions a refund too — check it came back." : "";
    const fix: Fix =
      c.category === "yearly"
        ? {
            label: later.length ? `Remove the ${formatShortDay(later[0].date)} renewal` : "Mark it ended",
            done: later.length ? `${c.vendor}'s renewal is removed` : `${c.vendor} is marked ended`,
            ...(later.length ? { remove: later.map((r) => r.id) } : {}),
            end,
          }
        : { label: `End it on ${formatShortDay(m.date)}`, done: `${c.vendor} ends ${formatShortDay(m.date)}`, end, ...(later.length ? { remove: later.map((r) => r.id) } : {}) };
    const row = later[0] ?? open[open.length - 1];
    out.push({
      key: `mail-stop:${m.vendor.toLowerCase()}:${m.id}`,
      signal: "mail",
      kind: "heads",
      area: "Costs",
      clientId: null,
      severity: 2,
      facts: { vendor: c.vendor, mail: "cancel", sent: m.date, mailbox: m.account, subject: m.subject, savedIls: Math.round(saved) },
      figure: c.category === "yearly" ? (saved > 0 ? money(saved) : null) : `${money(saved)}/mo`,
      title: `${c.vendor} was cancelled — Expenses still counts it`,
      body:
        c.category === "yearly"
          ? `${said} Expenses still ${next ? `renews it on ${formatShortDay(next)}` : "has it running"}. Stop it there so the plan stops counting it.${refund}`
          : `${said} Expenses still counts it every month. End it on the day it was cancelled.${refund}`,
      reminder: false,
      href: toolHref(c, row),
      action: "Show it on Expenses",
      focus: `row:${row.id}`,
      fix,
    });
  }
  return out;
}

/**
 * Receipts that don't fit the Expenses page, last 60 days: a charge after a
 * vendor's rows all ended (still paying for something cancelled), or one 10%+
 * over the row's price in the same currency (the price moved, or seats were
 * added). A vendor with several subscriptions is only checked for the first.
 */
export function receiptMismatch(data: AdviceData): Finding[] {
  const receipts = (data.toolMail ?? []).filter((m) => m.kind === "receipt" && daysApart(m.date, data.today) <= 60 && daysApart(m.date, data.today) >= 0);
  if (!receipts.length) return [];
  const chains = chainsOf(data.subscriptions ?? [], data.today);
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const m of [...receipts].sort((a, b) => b.date.localeCompare(a.date))) {
    const v = m.vendor.toLowerCase();
    const mine = chains.filter((c) => sameVendor(c.vendor, m.vendor));
    if (!mine.length) continue;
    // Any of the vendor's plans running that day (Nitsan, 2026-11-08: a "Claude max"
    // receipt after Max ended was the three Pro seats paid every month).
    const running = chains.filter((c) => sameFamily(c.vendor, m.vendor) && c.rows.some((r) => r.date <= m.date && (!r.endDate || daysApart(r.endDate, m.date) <= 3)));
    const money2 = m.amount != null && m.currency ? `${SYMBOL[m.currency] ?? ""}${m.amount.toLocaleString("en-US")}` : null;
    if (!running.length && !seen.has(`end:${v}`)) {
      seen.add(`end:${v}`);
      const lastEnd = mine.flatMap((c) => c.rows.map((r) => r.endDate ?? "")).sort().pop() ?? "";
      const last = mine[mine.length - 1];
      const row = last.rows[last.rows.length - 1];
      out.push({
        key: `mail-ended:${v}:${m.id}`,
        signal: "mail",
        kind: "now",
        area: "Costs",
        clientId: null,
        severity: 3,
        facts: { vendor: m.vendor, sent: m.date, mailbox: m.account, subject: m.subject, endedOn: lastEnd || null, ...(m.amount != null ? { chargedAmount: money2 } : {}) },
        figure: money2,
        title: `${m.vendor} charged after its subscription ended`,
        body: `A receipt on ${formatShortDay(m.date)} (${quoted(m.subject)}, ${m.account})${money2 ? ` for ${money2}` : ""}, but its last row on Expenses ended${lastEnd ? ` ${formatShortDay(lastEnd)}` : ""}. Either it's still running (add the row) or it's charging by mistake (cancel it in ${m.vendor}'s billing).`,
        reminder: true,
        href: toolHref(last, row),
        action: "Show it on Expenses",
        focus: `row:${row.id}`,
      });
      continue;
    }
    // Only the vendor's latest receipt with an amount is set against the row.
    if (m.amount == null || !m.currency || seen.has(`over:${v}`)) continue;
    seen.add(`over:${v}`);
    if (running.length !== 1) continue;
    const c = running[0];
    const row = [...c.rows].reverse().find((r) => r.date <= m.date) ?? c.current;
    if (!row || row.currency !== m.currency || row.gross <= 0) continue;
    const over = m.amount / row.gross - 1;
    // A yearly charge against a monthly row (or the reverse) isn't a price change.
    if (over < 0.1 || over > 2) continue;
    const overIls = (row.netIls * over * 12) / row.renewMonths;
    if (overIls < 50) continue;
    out.push(priceChange(data.toolMail ?? [], m, c, row, over, overIls));
  }
  return out;
}

/**
 * "Your subscription has changed to Plnty Pro (Monthly) 20,500 credits" and
 * "Your Plnty Pro (Monthly) 20,500 credits subscription has been renewed" →
 * the plan's name, or null.
 */
export function planNameOf(subject: string): string | null {
  const s = subject.replace(/\s+/g, " ").trim();
  const m =
    s.match(/\b(?:changed|upgraded|downgraded|switched|moved)\s+to\s+(?:the\s+)?["“]?(.+?)["”]?(?:\s+plan)?[.!]?$/i) ??
    s.match(/^your\s+["“]?(.+?)["”]?\s+(?:subscription|plan|membership)\s+(?:has\s+been|was|is)\s+(?:renewed|changed|upgraded|confirmed|active)/i);
  const name = m?.[1].trim() ?? "";
  return name.length >= 3 && name.length <= 80 && !/^(subscription|plan)$/i.test(name) ? name : null;
}

/** The last day of the month before `iso`'s month. */
const endOfMonthBefore = (iso: string) => {
  const [y, mo] = ymd(iso);
  return new Date(Date.UTC(y, mo - 1, 0)).toISOString().slice(0, 10);
};

/**
 * A receipt over its row's price, explained from the mail (Nitsan,
 * 2026-11-08: "reading the invoices and mails it's clear there was a change
 * in plan — explain that, not only that the price is higher"): the plan-change
 * mail and the plan it names, the first charge at the new price and how many
 * since — and, for a monthly row, a fix that ends the row the month before and
 * adds the new price from that charge.
 */
function priceChange(mail: ToolMail[], m: ToolMail, c: Chain, row: Subscription, over: number, overIls: number): Finding {
  const amount = m.amount!;
  const sym = SYMBOL[m.currency!] ?? "";
  const price = (n: number) => `${sym}${n.toLocaleString("en-US")}`;
  const near = (a: number) => Math.abs(a - amount) <= Math.max(1, amount * 0.03);
  const theirs = mail.filter((x) => sameFamily(x.vendor, m.vendor) || sameFamily(x.vendor, c.vendor));
  // Every charge at the new price since the row began — the first is when it started.
  const charges = theirs
    .filter((x) => x.kind === "receipt" && x.currency === m.currency && x.amount != null && near(x.amount) && x.date > row.date && x.date <= m.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const since = charges[0]?.date ?? m.date;
  // The mail that said the plan or price changed: after the row began, up to that first charge.
  const change =
    theirs
      .filter((x) => (x.kind === "plan" || x.kind === "price") && x.date >= row.date && x.date <= since)
      .sort((a, b) => a.date.localeCompare(b.date))
      .pop() ?? null;
  const plan = (change && planNameOf(change.subject)) || planNameOf(m.subject);
  const renamed = !!plan && !!row.description.trim() && plan.toLowerCase() !== row.description.trim().toLowerCase();
  const planChange = !!change || renamed;
  const every = row.renewMonths === 1 ? "a month" : row.renewMonths === 12 ? "a year" : `every ${row.renewMonths} months`;
  const count = Math.max(1, charges.length);
  // Monthly rows only, and only when the new price starts in a later month than the row did.
  const fix: Fix | undefined =
    row.category === "monthly" && since.slice(0, 7) > row.date.slice(0, 7) && (!row.endDate || row.endDate >= since)
      ? {
          label: `Change it to ${price(amount)} from ${formatShortDay(since)}`,
          done: `${c.vendor} is ${price(amount)} ${every} from ${formatShortDay(since)}`,
          end: [{ id: row.id, date: endOfMonthBefore(since) }],
          add: { like: row.id, date: since, amount, description: plan ?? row.description },
        }
      : undefined;
  const what = change
    ? `On ${formatShortDay(change.date)} ${c.vendor} wrote that the ${change.kind === "price" ? "price" : "plan"} changed${plan ? ` — to ${quoted(plan)}` : ""} (${quoted(change.subject)}, ${change.account}).`
    : renamed
      ? `The receipts name the plan ${quoted(plan!)}, but its row on Expenses is ${quoted(row.description.trim())}.`
      : "";
  const body = planChange
    ? `${what} Since ${formatShortDay(since)} it charges ${price(amount)} ${every} instead of the ${price(row.gross)} on its row (${count === 1 ? "one charge so far" : `${count} charges so far`}), so this is the price from now on — about ${money(overIls)} a year more. ${fix ? `${fix.label.replace("Change it", "Change the row")}: it keeps ${price(row.gross)} up to ${formatShortDay(endOfMonthBefore(since))}.` : "Update the row to the new plan."}`
    : `${price(amount)} on ${formatShortDay(m.date)} (${quoted(m.subject)}), against ${price(row.gross)} on its row — about ${money(overIls)} a year more. A price rise, extra seats or a bigger plan: update the row, and check it's wanted.`;
  return {
    key: `mail-over:${m.vendor.toLowerCase()}:${m.id}`,
    signal: "mail",
    kind: "heads",
    area: "Costs",
    clientId: null,
    severity: over >= 0.3 ? 2 : 1,
    facts: {
      vendor: c.vendor,
      sent: m.date,
      mailbox: m.account,
      subject: m.subject,
      over: pct(over),
      overIls: Math.round(overIls),
      since,
      charges: count,
      ...(planChange ? { planChanged: "yes" } : {}),
      ...(change ? { changeMail: change.subject, changedOn: change.date } : {}),
      ...(plan ? { plan } : {}),
    },
    figure: `+${pct(over)}`,
    title: planChange ? `${c.vendor} moved to a ${over > 0 ? "bigger" : "different"} plan — Expenses has the old price` : `${c.vendor} charged more than Expenses expects`,
    body,
    reminder: false,
    href: toolHref(c, row),
    action: "Show it on Expenses",
    focus: `row:${row.id}`,
    ...(fix ? { fix } : {}),
  };
}

/* ── Month-end close ────────────────────────────────────────────────────── */

const CLOSE_PAGE = {
  freelance: { path: "/finance/freelance", page: "Freelance", one: "freelance amount", many: "freelance amounts", paidOne: "freelance payment", paidMany: "freelance payments" },
  salaries: { path: "/finance/salaries", page: "Salaries", one: "salary", many: "salaries", paidOne: "salary", paidMany: "salaries" },
  income: { path: "/finance/plan", page: "the Plan", one: "income row", many: "income rows", paidOne: "", paidMany: "" },
} as const;

type CloseTable = keyof typeof CLOSE_PAGE;
type LastRow = AdviceData["lastMonthRows"][number];

/** One close card: a page's rows of last month, highlighted on it. Salaries go unnamed — the body is worded by Claude (amounts stripped, names not). */
function closeCard(data: AdviceData, table: CloseTable, rows: LastRow[], signal: string, title: string, body: string): Finding {
  const [y, m, d] = ymd(data.today);
  const [ly, lm] = monthsBack(y, m, 1);
  const p = CLOSE_PAGE[table];
  const late = d >= 15;
  const amount = rows.reduce((t, r) => t + r.amount, 0);
  const who = table === "freelance" ? rows.filter((r) => r.name).map((r) => `${r.name} (${money(r.amount)})`) : [];
  return {
    key: `${signal}:${monthKey(ly, lm)}:${table}`,
    signal,
    kind: late ? "now" : "heads",
    area: "Close",
    clientId: null,
    severity: late ? 2 : 1,
    facts: { month: monthName(lm), page: p.page, rows: rows.length, estimatedIls: Math.round(amount) },
    figure: formatILSShort(amount),
    title,
    body: body + (who.length ? `: ${who.join(", ")}.` : ` (${money(amount)} in all).`),
    reminder: true,
    href: `${p.path}?year=${ly}`,
    action: `Show ${rows.length === 1 ? "it" : "them"} on ${p.page}`,
    focus: [...rows.flatMap((r) => (r.id ? [`row:${r.id}`] : [])), `month:${monthKey(ly, lm)}`].join(" "),
  };
}

/**
 * Last month not booked yet, from the 5th: salary, freelance or income rows
 * that aren't `final` (finance.ts: `actual` is an unreviewed draft, `predicted`
 * an estimate, `final` checked and locked — green on the page). One card per
 * page, so its link highlights the very cells. Final is NOT paid — that's
 * `monthUnpaid` (Nitsan, 2026-10-25). Expenses are left out on purpose —
 * measured 2026-10-24, even January's are mostly `actual`, so they'd never
 * close. "Do now" from the 15th.
 */
export function monthNotClosed(data: AdviceData): Finding[] {
  const [y, m, d] = ymd(data.today);
  if (d < 5) return [];
  const lm = monthsBack(y, m, 1)[1];
  const out: Finding[] = [];
  for (const table of ["freelance", "salaries", "income"] as const) {
    // A ₪0 row is an empty cell, nothing to book.
    const open = data.lastMonthRows.filter((r) => r.table === table && r.state !== "final" && r.amount !== 0);
    if (open.length === 0) continue;
    const p = CLOSE_PAGE[table];
    const n = open.length;
    out.push(
      closeCard(
        data,
        table,
        open,
        "close",
        `${plural(n, `${monthName(lm)} ${p.one} isn't`, `${monthName(lm)} ${p.many} aren't`)} final`,
        `Final (green) means the amount is checked and locked. Once ${n === 1 ? "it is" : "they are"}, click ${n === 1 ? "the cell" : "each cell"} and choose Final beside it. Not final yet`,
      ),
    );
  }
  return out;
}

/**
 * Last month's freelance and salary amounts that are final but not paid, from
 * the 5th. Paid is the step after final — Draft → Predicted → Final → Paid
 * (Nitsan, 2026-10-25) — so a cell not final yet is `monthNotClosed`'s, never
 * both cards. Only when the column is there (`paid` undefined = reference/0011
 * not run). "Do now" from the 15th.
 */
export function monthUnpaid(data: AdviceData): Finding[] {
  const [y, m, d] = ymd(data.today);
  if (d < 5) return [];
  const lm = monthsBack(y, m, 1)[1];
  const out: Finding[] = [];
  for (const table of ["freelance", "salaries"] as const) {
    const open = data.lastMonthRows.filter((r) => r.table === table && r.state === "final" && r.paid === false && r.amount !== 0);
    if (open.length === 0) continue;
    const p = CLOSE_PAGE[table];
    const n = open.length;
    out.push(
      closeCard(
        data,
        table,
        open,
        "paid",
        `${plural(n, `${monthName(lm)} ${p.paidOne} isn't`, `${monthName(lm)} ${p.paidMany} aren't`)} marked paid`,
        `Final, so the amount is settled. Once ${n === 1 ? "it's" : "they're"} paid, click ${n === 1 ? "the cell" : "each cell"} and choose Paid beside it — the amount turns dark green. Not paid yet`,
      ),
    );
  }
  return out;
}

/**
 * Older salary and freelance amounts still final and unpaid — before last
 * month, up to a year back (Nitsan, 2026-10-31: the reminder used to vanish
 * once its month passed, so a payment that slipped was forgotten). One card
 * per page, its months named, its link highlighting the cells. "Do now":
 * these are a month or more overdue.
 */
export function olderUnpaid(data: AdviceData): Finding[] {
  const out: Finding[] = [];
  for (const table of ["freelance", "salaries"] as const) {
    const open = (data.olderUnpaid ?? []).filter((r) => r.table === table && r.amount !== 0);
    if (open.length === 0) continue;
    const p = CLOSE_PAGE[table];
    const months = [...new Set(open.map((r) => r.month))].sort();
    const names = months.map((k) => monthName(Number(k.slice(5))));
    const latest = months[months.length - 1];
    const amount = open.reduce((t, r) => t + r.amount, 0);
    const n = open.length;
    const who = table === "freelance" ? open.filter((r) => r.name).map((r) => `${r.name} (${money(r.amount)})`) : [];
    out.push({
      key: `paid-older:${table}`,
      signal: "paid",
      kind: "now",
      area: "Close",
      clientId: null,
      severity: months.length > 1 ? 3 : 2,
      facts: { months: names.join(", "), page: p.page, rows: n, estimatedIls: Math.round(amount) },
      figure: formatILSShort(amount),
      title: `${plural(n, `older ${p.paidOne} isn't`, `older ${p.paidMany} aren't`)} marked paid`,
      body:
        `Final but not paid, from ${names.join(", ")}. If ${n === 1 ? "it went out" : "they went out"}, click ${n === 1 ? "the cell" : "each cell"} and choose Paid; if not, ${n === 1 ? "it's" : "they're"} owed` +
        (who.length ? `: ${who.join(", ")}.` : ` (${money(amount)} in all).`),
      reminder: true,
      href: `${p.path}?year=${latest.slice(0, 4)}`,
      action: `Show ${n === 1 ? "it" : "them"} on ${p.page}`,
      focus: [...open.map((r) => `row:${r.id}`), ...months.filter((k) => k.startsWith(latest.slice(0, 4))).map((k) => `month:${k}`)].join(" "),
    });
  }
  return out;
}

/** From the 12th: fewer payslips imported for last month than salary rows (npm run salary-docs). */
export function payslipsMissing(data: AdviceData): Finding[] {
  const [y, m, d] = ymd(data.today);
  if (d < 12) return [];
  const [ly, lm] = monthsBack(y, m, 1);
  const rows = data.lastMonthRows.filter((r) => r.table === "salaries").length;
  const slips = data.payslips[monthKey(ly, lm)] ?? 0;
  if (rows === 0 || slips >= rows) return [];
  return [
    {
      key: `payslips:${monthKey(ly, lm)}`,
      signal: "payslips",
      kind: "heads",
      area: "Close",
      clientId: null,
      severity: slips === 0 ? 2 : 1,
      facts: { month: monthName(lm), payslips: slips, salaryRows: rows },
      figure: `${slips} of ${rows}`,
      title: `${monthName(lm)}'s payslips aren't all in`,
      body: `${slips} imported for ${rows} salary rows. Run npm run salary-docs on the Mac once Michpal's files are in the Salaries folder.`,
      reminder: true,
      href: "/finance/salaries",
      action: "Open Salaries",
    },
  ];
}

/** Last month without both official exchange rates: foreign costs fall back to an older rate. */
export function fxMissing(data: AdviceData): Finding[] {
  const [y, m] = ymd(data.today);
  const [ly, lm] = monthsBack(y, m, 1);
  if (data.fxMonths.includes(monthKey(ly, lm))) return [];
  return [
    {
      key: `fx:${monthKey(ly, lm)}`,
      signal: "fx",
      kind: "heads",
      area: "Close",
      clientId: null,
      severity: 1,
      facts: { month: monthName(lm) },
      figure: null,
      title: `No Bank of Israel rate stored for ${monthName(lm)}`,
      body: `Foreign expenses that month are converted at an older rate. Opening the Plan fetches the rates.`,
      reminder: false,
      href: "/finance/plan",
      action: "Open the Plan",
    },
  ];
}

export const SIGNALS = [
  paceBehind,
  lossMonths,
  yearOutlook,
  taxReserve,
  dividendWindow,
  booksGap,
  periodUnpaid,
  noRate,
  concentration,
  clientQuiet,
  salariesShare,
  freelanceOver,
  expenseJump,
  renewalSoon,
  toolOverlap,
  priceUp,
  fxFee,
  mailNotice,
  receiptMismatch,
  receiptsWaiting,
  unfiled,
  monthNotClosed,
  monthUnpaid,
  olderUnpaid,
  payslipsMissing,
  fxMissing,
];

export function findAll(data: AdviceData): Finding[] {
  return SIGNALS.flatMap((s) => s(data));
}

/* ── The pane's figures ─────────────────────────────────────────────────── */

/**
 * Which page a figure belongs to (context.ts `tilesFor`). The tracker's rule
 * (its v1.81.0, Nitsan 2026-10-25): "not another dashboard" — each page gets
 * its own figures, never one the page already shows (the Overview's hours card
 * means no pace tile there).
 */
export type TileScope = "money" | "pace" | "clients" | "salaries" | "freelance" | "filing" | "renewals" | "booked";

export interface PulseTile {
  label: string;
  /** what the tile shows, formatted ("₪42K", "93%") — null when there is nothing */
  display: string | null;
  /** oldest first, any unit — the sparkline */
  series: number[];
  good: boolean;
  note: string;
  /** what the figure is and how it's counted — the tile's hover box */
  help: string;
  scope: TileScope;
}

/** `findings` = this check's, so the unpaid tile adds up the cards instead of re-running the rule. */
export function pulse(data: AdviceData, findings: Finding[] = findAll(data)): PulseTile[] {
  const [y, m] = ymd(data.today);
  const now = noonOf(data.today);
  const month = projectCurrentMonth(data.pnl, y, now);
  const goal = hoursGoal(data.pnl, y, now, { inputs: data.goalInputs ?? undefined });
  const year = projectYear(data.pnl, y, now);
  const recent = completeMonths(data.today, 6).filter(([yy, mm]) => booked(lines(data.pnl, yy, mm)));
  const profits = recent.map(([yy, mm]) => profitOf(lines(data.pnl, yy, mm)));
  const last3 = recent.slice(-3);
  const income3 = last3.reduce((t, [yy, mm]) => t + revenueOf(lines(data.pnl, yy, mm)), 0);
  const profit3 = profits.slice(-3).reduce((t, p) => t + p, 0);
  const margin3 = income3 ? profit3 / income3 : null;
  const pace = goal?.actualPerDay != null && goal.profit.perDay > 0 && goal.workdaysDone >= 1 ? goal.actualPerDay / goal.profit.perDay : null;

  // Clients: the biggest share of 90 days' billable hours, and what's past its payment date.
  const by = [...billableBy(data, shiftIso(data.today, -90))].sort((a, b) => b[1].hours - a[1].hours);
  const totalHours = by.reduce((t, [, v]) => t + v.hours, 0);
  const top = by[0];
  const unpaid = findings.filter((f) => f.signal === "unpaid");
  const unpaidIls = unpaid.reduce((t, f) => t + (typeof f.facts.amountIls === "number" ? f.facts.amountIls : 0), 0);

  // Costs: salaries' share, and hourly freelancers this month.
  const salaries = shareOver(data, completeMonths(data.today, 3), LINE.salaries);
  const salariesBefore = shareOver(data, Array.from({ length: 12 }, (_, i) => monthsBack(y, m, 15 - i)), LINE.salaries);
  const fl = goal?.freelance ?? [];
  const flCost = fl.reduce((t, f) => t + f.cost, 0);
  const flPlan = fl.reduce((t, f) => t + f.planned, 0);

  // Close: monthly invoices filed, last month's rows booked.
  const live = data.monthlyExpenses.filter((r) => !r.endDate || r.endDate >= data.today);
  const filed = live.filter((r) => isFiled(r.filedAt, now)).length;
  const [, lm] = monthsBack(y, m, 1);
  const finalRows = data.lastMonthRows.filter((r) => r.state === "final").length;

  // Tools: yearly renewals in the next 45 days — the cards' own set.
  const renewals = findings.filter((f) => f.signal === "renewal").sort((a, b) => String(a.facts.renews).localeCompare(String(b.facts.renews)));
  const renewIls = renewals.reduce((t, f) => t + (typeof f.facts.priceIls === "number" ? f.facts.priceIls : 0), 0);

  return [
    {
      scope: "money",
      label: `${MONTH_SHORT[m - 1]} profit (est.)`,
      display: month ? signedShort(month.profit) : null,
      series: month ? [...profits, month.profit] : profits,
      good: !month || month.profit >= 0,
      note: month ? `${pct(month.margin)} margin · costs +${UPLIFT}` : "no plan for this month",
      help: `This month's profit as the Overview estimates it: income at a pace blending this month's days so far with last month's, against the Plan's costs plus ${UPLIFT} (real costs run above the plan). The line is the last six booked months, then this estimate.`,
    },
    {
      scope: "money",
      label: `${span(last3)} profit`,
      display: last3.length ? signedShort(profit3) : null,
      series: profits,
      good: profit3 >= 0,
      note: margin3 == null ? "no booked months" : `${pct(margin3)} margin on ${formatILSShort(income3)}`,
      help: "The last three complete months as the P&L has them: income less every cost line. The line is each of the last six months' profit.",
    },
    {
      scope: "money",
      label: `${y} (est.)`,
      display: year ? signedShort(year.profit) : null,
      series: [],
      good: !year || year.margin >= TARGET_MARGIN,
      note: year ? `${pct(year.margin)} margin on ${formatILSShort(year.revenue)}` : "no estimate",
      help: `The whole year: booked months as they are, the rest estimated at the last three months' pace (the Overview's year projection). Coral below the ${pct(TARGET_MARGIN)} target margin.`,
    },
    {
      scope: "pace",
      label: "Hours pace",
      display: pace == null ? null : pct(pace),
      series: [],
      good: pace == null || pace >= 1,
      note: goal?.actualPerDay != null ? `${h(goal.actualPerDay)}h a day vs ${h(goal.profit.perDay)}h for ${pct(TARGET_MARGIN)}` : "of the goal's daily hours",
      help: `Billable hours a workday so far this month, as a share of what the month needs for a ${pct(TARGET_MARGIN)} profit — the Overview's hours goal, with days away and freelancers' pace counted.`,
    },
    {
      scope: "clients",
      label: "Biggest client · 90 days",
      display: top && totalHours > 0 ? pct(top[1].hours / totalHours) : null,
      series: [],
      good: !top || totalHours === 0 || top[1].hours / totalHours < 0.4,
      note: top ? `${nameOf(data, top[0])} · ${formatILSShort(top[1].income)}` : "no billable hours",
      help: "The client with the most billable hours over the last 90 days, as a share of all of them (Keys tasks out, as the tracker counts it), and the hourly income those hours brought. Coral from 40%.",
    },
    {
      scope: "clients",
      label: "Unpaid past terms",
      display: unpaid.length ? formatILSShort(unpaidIls) : formatILS(0),
      series: [],
      good: unpaid.length === 0,
      note: unpaid.length ? `${plural(unpaid.length, "period", "periods")}, ${PAYMENT_TERMS_DAYS}-day terms` : "nothing late",
      help: `Each client's last billing period that is past its payment date (period end + ${PAYMENT_TERMS_DAYS} days) and not ticked paid in the tracker: the hours a client report counts × the client's rate, before VAT.`,
    },
    {
      scope: "salaries",
      label: `Salaries · ${span(completeMonths(data.today, 3))}`,
      display: salaries ? pct(salaries.share) : null,
      series: [],
      good: !salaries || !salariesBefore || salaries.share - salariesBefore.share < 0.05,
      note: salaries && salariesBefore ? `of income, vs ${pct(salariesBefore.share)} the year before` : "of income",
      help: "Salaries (employer cost) as a share of income over the last three complete months, against the twelve months before them. Coral when it rose five points or more.",
    },
    {
      scope: "freelance",
      label: `Freelance · ${MONTH_SHORT[m - 1]} (est.)`,
      display: fl.length ? formatILSShort(flCost) : null,
      series: [],
      good: flCost <= flPlan * 1.1,
      note: fl.length ? `vs ${formatILSShort(flPlan)} planned` : "no hourly freelancers",
      help: "Freelancers paid by their tracker hours, costed by the hours they have logged so far this month — through their sliding rate where they have one — against their amounts in the Plan. The same costing the hours goal uses.",
    },
    {
      scope: "filing",
      label: "Invoices filed",
      display: live.length ? `${filed} of ${live.length}` : null,
      series: [],
      good: filed === live.length,
      note: "monthly, since the 25th",
      help: "Live monthly expenses with a filing mark since the most recent 25th, when the marks start over — the Expenses page's Monthly tab count.",
    },
    {
      scope: "renewals",
      label: `Renewals · ${RENEWAL_DAYS} days`,
      display: data.subscriptions ? (renewals.length ? formatILSShort(renewIls) : formatILS(0)) : null,
      series: [],
      good: true,
      note: renewals.length ? `${plural(renewals.length, "renewal", "renewals")} · next ${renewals[0].facts.vendor}, ${formatShortDay(String(renewals[0].facts.renews))}` : "nothing renewing soon",
      help: `Yearly subscriptions (₪${RENEWAL_MIN_ILS}+) renewing in the next ${RENEWAL_DAYS} days, at their latest price without VAT — the last moment to cancel, downgrade or switch.`,
    },
    {
      scope: "booked",
      label: `${MONTH_SHORT[lm - 1]} booked`,
      display: data.lastMonthRows.length ? `${finalRows} of ${data.lastMonthRows.length}` : null,
      series: [],
      good: finalRows === data.lastMonthRows.length,
      note: "salary, freelance, income rows final",
      help: "Last month's salary, freelance and income rows that are final. A draft (actual) or an estimate (predicted) means the month isn't booked yet. Expenses are left out: most stay drafts.",
    },
  ];
}
