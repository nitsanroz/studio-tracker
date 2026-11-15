// &advice as a business advisor (Nitsan, 2026-11-15: "advice of running a
// business — weighing everything from salary cost to the work coming in, team
// size, expenses, tax — like an organisational and business consultant").
//
// The other rule files each watch one thing going wrong. This one reads the
// studio as a whole over the last three complete months and answers the
// questions an owner asks a consultant: is the price right, is the team the
// right size, who is worth the hours, what would it take to hit the target.
//
// Three layers, all pure (run.ts loads, this computes):
//   businessMetrics  the figures — WITH amounts, server only
//   strategy         cards the rules can state on their own, no Claude needed
//   businessBrief    the same picture with NO amount in it — percentages, hours,
//                    counts and indexes — which is all Claude is sent
//
// ⚠️ A person's cost goes in and only averages and client totals come out.

import { parseISO, toISODate } from "@/lib/format";
import { TARGET_MARGIN } from "@/lib/hours-goal";
import { rateFor } from "@/lib/freelance-rate";
import { LINE, rateForClientOn } from "@/lib/finance/finance";
import { formatHours, formatILS, formatILSShort } from "@/lib/finance/format";
import type { AdviceData as MoneyData } from "@/lib/finance/advice/signals";
import { MIN_MONTH_HOURS, type CrossFreelancer } from "./cross";
import { BENCH } from "./playbook";
import type { Finding } from "./merge";
import { workdayCount, type AdviceData as StudioData } from "./signals";

/** What one person cost the studio in one month, and which table said so. */
export interface MonthCost {
  profileId: string;
  /** "yyyy-mm" */
  month: string;
  costIls: number;
  kind: "salary" | "freelance";
}

export interface ClientMetric {
  id: string;
  name: string;
  hours: number;
  hoursShare: number;
  rate: number | null;
  /** months since the rate now in force began */
  rateAgeMonths: number | null;
  /** what is left of the hours' income after the people who worked them; null when too much of the cost isn't known */
  leftShare: number | null;
}

export interface FreelancerMetric {
  name: string;
  hoursPerMonth: number;
  /** ₪ an hour at those hours */
  hourlyIls: number;
  /** monthly hours above which an average employee would cost less */
  hireBreakEvenHours: number | null;
}

export interface BusinessMetrics {
  /** the three complete months read, oldest first: "yyyy-mm" */
  months: string[];
  label: string;
  revenue: number;
  expenses: number;
  margin: number;
  /** the same three months a year earlier, when the books have them */
  marginLastYear: number | null;
  /** each cost line's share of income */
  shares: { salaries: number; freelance: number; rent: number; tools: number; other: number };
  sharesLastYear: BusinessMetrics["shares"] | null;
  billableHours: number;
  /** hourly income ÷ billable hours */
  avgRate: number;
  /** the share of income sold by the hour (the rest is fixed-price projects) */
  hourlyShare: number;
  /** the largest client's share of the billable hours, and the top three's together */
  topClient: number;
  topThree: number;
  /** all expenses ÷ billable hours — what an hour has to bring in to break even */
  loadedHourCost: number;
  loadedHourCostLastYear: number | null;
  /** salaried people with real hours, averaged over the months */
  designers: number;
  workdays: number;
  /** salaried people's billable hours ÷ (designers × workdays × 8) */
  utilization: number | null;
  /** the owner's share of the billable hours */
  ownerShare: number | null;
  avgEmployeeCost: number | null;
  /** how far the three months fell short of the target margin, and three ways to close it */
  gap: { incomeShortPerMonth: number; rateUp: number; extraHoursPerMonth: number; extraPerDesignerDay: number | null; costCut: number } | null;
  clients: ClientMetric[];
  freelancers: FreelancerMetric[];
  pipeline: { openLeads: number; waitingOnUs: number; candidates: number };
}

const MINUS = "−";
const money = (n: number) => (Math.abs(n) >= 10_000 ? formatILSShort(n) : formatILS(Math.round(n))).replace("-", MINUS);
const h = (n: number) => formatHours(Math.round(n));
const pct = (f: number) => Math.round(f * 100);
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const monthName = (key: string, form: "long" | "short" = "short") => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleDateString("en-GB", { month: form });

/** The last `n` complete months before `today`, oldest first. */
export function completeMonths(today: string, n: number): string[] {
  const d = parseISO(today);
  return Array.from({ length: n }, (_, i) => toISODate(new Date(d.getFullYear(), d.getMonth() - (n - i), 1)).slice(0, 7));
}
const yearBefore = (key: string) => `${Number(key.slice(0, 4)) - 1}${key.slice(4)}`;
const monthBounds = (key: string): [string, string] => {
  const [y, m] = key.split("-").map(Number);
  return [`${key}-01`, `${key}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`];
};

interface Books {
  revenue: number;
  expenses: number;
  hours: number;
  hoursIncome: number;
  lines: Map<string, number>;
}
/** The P&L over some months, or null when any of them isn't booked. */
function books(money_: MoneyData, months: string[]): Books | null {
  const out: Books = { revenue: 0, expenses: 0, hours: 0, hoursIncome: 0, lines: new Map() };
  for (const key of months) {
    const [y, m] = key.split("-").map(Number);
    const v = new Map<string, number>();
    for (const r of money_.pnl) if (r.year === y && r.month === m) v.set(r.lineItem, r.value);
    const revenue = v.get(LINE.totalRevenues) ?? 0;
    if (revenue <= 0) return null;
    out.revenue += revenue;
    out.expenses += v.get(LINE.totalExpenses) ?? 0;
    out.hours += v.get(LINE.totalHours) ?? 0;
    out.hoursIncome += v.get(LINE.hoursIncome) ?? revenue - (v.get(LINE.projectIncome) ?? 0);
    for (const [k, val] of v) out.lines.set(k, (out.lines.get(k) ?? 0) + val);
  }
  return out;
}
function sharesOf(b: Books): BusinessMetrics["shares"] {
  const of = (...keys: string[]) => keys.reduce((t, k) => t + (b.lines.get(k) ?? 0), 0) / b.revenue;
  const salaries = of(LINE.salaries);
  const freelance = of(LINE.freelance);
  const rent = of(LINE.rentExpenses);
  const tools = of(LINE.expensesMonthly, LINE.expensesYearly, LINE.expensesOther);
  return { salaries, freelance, rent, tools, other: Math.max(0, b.expenses / b.revenue - salaries - freelance - rent - tools) };
}

/** The studio over the last three complete months. Null when those months aren't in the books yet. */
export function businessMetrics(studio: StudioData, money_: MoneyData, freelancers: CrossFreelancer[], costs: MonthCost[]): BusinessMetrics | null {
  const months = completeMonths(studio.today, 3);
  const now = books(money_, months);
  if (!now) return null;
  const then = books(money_, months.map(yearBefore));
  const inQuarter = new Set(months);

  // Hours, from the tracker: a billable task of a billable client is a billable hour (the P&L's own definition).
  const billableClient = new Set(studio.clients.filter((c) => c.billable).map((c) => c.id));
  const taskOf = new Map(studio.tasks.map((t) => [t.id, t]));
  const isBillable = (taskId: string) => {
    const t = taskOf.get(taskId);
    return !!t && t.billable && !!t.clientId && billableClient.has(t.clientId);
  };
  const entries = studio.entries.filter((e) => inQuarter.has(e.date.slice(0, 7)));
  const personMonth = new Map<string, number>();
  for (const e of entries) if (e.userId) personMonth.set(`${e.userId}|${e.date.slice(0, 7)}`, (personMonth.get(`${e.userId}|${e.date.slice(0, 7)}`) ?? 0) + e.minutes / 60);
  const trackedBillable = entries.filter((e) => isBillable(e.taskId)).reduce((t, e) => t + e.minutes / 60, 0);
  const billableHours = now.hours > 0 ? now.hours : trackedBillable;
  if (billableHours <= 0) return null;

  // People: who is salaried and really working each month.
  const salaryOf = new Map<string, number>();
  const costOf = new Map<string, number>();
  for (const c of costs) {
    if (!inQuarter.has(c.month)) continue;
    const k = `${c.profileId}|${c.month}`;
    costOf.set(k, (costOf.get(k) ?? 0) + c.costIls);
    if (c.kind === "salary") salaryOf.set(k, (salaryOf.get(k) ?? 0) + c.costIls);
  }
  const working = [...salaryOf].filter(([k, cost]) => cost > 0 && (personMonth.get(k) ?? 0) >= 40);
  const designers = working.length / months.length;
  const salariedIds = new Set(working.map(([k]) => k));
  const avgEmployeeCost = working.length ? working.reduce((t, [, cost]) => t + cost, 0) / working.length : null;
  const workdays = months.reduce((t, key) => t + workdayCount(...monthBounds(key)), 0);
  const salariedBillable = entries
    .filter((e) => e.userId && salariedIds.has(`${e.userId}|${e.date.slice(0, 7)}`) && isBillable(e.taskId))
    .reduce((t, e) => t + e.minutes / 60, 0);
  const capacity = working.reduce((t, [k]) => t + workdayCount(...monthBounds(k.split("|")[1])) * 8, 0);
  const ownerBillable = studio.ownerId ? entries.filter((e) => e.userId === studio.ownerId && isBillable(e.taskId)).reduce((t, e) => t + e.minutes / 60, 0) : 0;

  /** ₪ an hour of this person cost that month, or null when it isn't known. */
  const hourly = (pid: string, month: string): number | null => {
    const f = freelancers.find((x) => x.profileId === pid);
    if (f) return rateFor(personMonth.get(`${pid}|${month}`) ?? 0, f.terms) * f.fx;
    const cost = costOf.get(`${pid}|${month}`);
    return cost == null || cost <= 0 ? null : cost / Math.max(personMonth.get(`${pid}|${month}`) ?? 0, MIN_MONTH_HOURS);
  };

  const avgRate = now.hoursIncome / billableHours;
  const need = Math.max(0, now.expenses / (1 - TARGET_MARGIN) - now.revenue);
  const designerDays = designers * workdays;

  // Clients: their share of the hours, their rate and its age, and what they leave.
  type Sum = { hours: number; cost: number; unknown: number };
  const byClient = new Map<string, Sum>();
  for (const e of entries) {
    if (!isBillable(e.taskId)) continue;
    const id = taskOf.get(e.taskId)!.clientId!;
    const s = byClient.get(id) ?? { hours: 0, cost: 0, unknown: 0 };
    const hours = e.minutes / 60;
    s.hours += hours;
    const rate = e.userId ? hourly(e.userId, e.date.slice(0, 7)) : null;
    if (rate == null) s.unknown += hours;
    else s.cost += hours * rate;
    byClient.set(id, s);
  }
  const clients: ClientMetric[] = studio.clients
    .filter((c) => c.billable && !c.archived && (byClient.get(c.id)?.hours ?? 0) > 0)
    .map((c) => {
      const s = byClient.get(c.id)!;
      const rate = rateForClientOn(money_.rates, c.name, studio.today);
      const inForce = money_.rates
        .filter((r) => r.clientCanon === c.name && r.effectiveFrom <= studio.today && (!r.effectiveTo || r.effectiveTo >= studio.today))
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
      const age = inForce ? (Number(studio.today.slice(0, 4)) - Number(inForce.effectiveFrom.slice(0, 4))) * 12 + Number(studio.today.slice(5, 7)) - Number(inForce.effectiveFrom.slice(5, 7)) : null;
      const income = rate == null ? 0 : s.hours * rate;
      return {
        id: c.id,
        name: c.name,
        hours: s.hours,
        hoursShare: trackedBillable > 0 ? s.hours / trackedBillable : 0,
        rate,
        rateAgeMonths: age,
        leftShare: income > 0 && s.unknown / s.hours <= 0.2 ? (income - s.cost) / income : null,
      };
    })
    .sort((a, b) => b.hours - a.hours);

  return {
    months,
    label: `${monthName(months[0])}–${monthName(months[2])}`,
    revenue: now.revenue,
    expenses: now.expenses,
    margin: (now.revenue - now.expenses) / now.revenue,
    marginLastYear: then ? (then.revenue - then.expenses) / then.revenue : null,
    shares: sharesOf(now),
    sharesLastYear: then ? sharesOf(then) : null,
    billableHours,
    avgRate,
    hourlyShare: now.hoursIncome / now.revenue,
    topClient: clients[0]?.hoursShare ?? 0,
    topThree: clients.slice(0, 3).reduce((t, c) => t + c.hoursShare, 0),
    loadedHourCost: now.expenses / billableHours,
    loadedHourCostLastYear: then && then.hours > 0 ? then.expenses / then.hours : null,
    designers,
    workdays,
    utilization: capacity > 0 ? salariedBillable / capacity : null,
    ownerShare: trackedBillable > 0 && studio.ownerId ? ownerBillable / trackedBillable : null,
    avgEmployeeCost,
    gap:
      need > 0 && avgRate > 0
        ? {
            incomeShortPerMonth: need / months.length,
            rateUp: now.hoursIncome > 0 ? need / now.hoursIncome : 0,
            extraHoursPerMonth: need / avgRate / months.length,
            extraPerDesignerDay: designerDays > 0 ? need / avgRate / designerDays : null,
            costCut: (now.expenses - now.revenue * (1 - TARGET_MARGIN)) / now.expenses,
          }
        : null,
    clients,
    freelancers: freelancers
      .map((f) => {
        const hoursPerMonth = months.reduce((t, key) => t + (personMonth.get(`${f.profileId}|${key}`) ?? 0), 0) / months.length;
        const hourlyIls = rateFor(hoursPerMonth, f.terms) * f.fx;
        return { name: f.name.split(" ")[0], hoursPerMonth, hourlyIls, hireBreakEvenHours: avgEmployeeCost && hourlyIls > 0 ? avgEmployeeCost / hourlyIls : null };
      })
      .filter((f) => f.hoursPerMonth > 0),
    pipeline: { openLeads: studio.leadsOpen ?? 0, waitingOnUs: studio.leadsWaiting?.length ?? 0, candidates: studio.candidates?.length ?? 0 },
  };
}

/* ── What the rules can say on their own ────────────────────────────────── */

/** Clients with under this share of the hours aren't worth a strategic sentence. */
const MATTERS = 0.05;

/**
 * The strategic cards. All "ideas": none is urgent today, each is a decision.
 * One key per card per quarter-end month, so a dismissal holds until the
 * picture is a month newer.
 */
export function strategy(m: BusinessMetrics | null): Finding[] {
  if (!m) return [];
  const at = m.months[2];
  const out: Finding[] = [];
  const card = (name: string, f: Omit<Finding, "key" | "signal" | "kind" | "clientId" | "reminder">): void => {
    out.push({ key: `strategy:${name}:${at}`, signal: name, kind: "idea", clientId: null, reminder: false, ...f });
  };
  const target = pct(TARGET_MARGIN);

  // 1 · What it takes to reach the target margin: the same gap, as three levers.
  if (m.gap) {
    const g = m.gap;
    card("target-gap", {
      area: "Strategy · Profit",
      severity: m.margin < 0 ? 3 : 2,
      facts: {
        months: m.label,
        marginPct: pct(m.margin),
        targetPct: target,
        rateUpPct: pct(g.rateUp),
        extraHoursPerMonth: Math.round(g.extraHoursPerMonth),
        extraPerDesignerDay: g.extraPerDesignerDay == null ? null : Number(g.extraPerDesignerDay.toFixed(1)),
        costCutPct: pct(g.costCut),
        shortIls: Math.round(g.incomeShortPerMonth),
      },
      figure: `${MINUS}${formatILSShort(g.incomeShortPerMonth)}/mo`,
      title: `${m.label} ran at ${pct(m.margin)}% — three ways to the ${target}% target`,
      body:
        `The studio was about ${money(g.incomeShortPerMonth)} a month short of a ${target}% margin. Any one of these closes it: ` +
        `rates up ${pct(g.rateUp)}% across the board; ${h(g.extraHoursPerMonth)} more billable hours a month` +
        (g.extraPerDesignerDay == null ? "" : ` (${g.extraPerDesignerDay.toFixed(1)}h a designer a day)`) +
        `; or costs down ${pct(g.costCut)}%. In practice a little of each.`,
      href: "/finance",
      action: "Open the Overview",
    });
  }

  // 2 · Clients paying less than an hour costs.
  const under = m.clients.filter((c) => c.hoursShare >= MATTERS && c.rate != null && c.rate < m.loadedHourCost);
  if (under.length) {
    const lost = under.reduce((t, c) => t + (m.loadedHourCost - c.rate!) * c.hours, 0) / m.months.length;
    card("hour-cost", {
      area: "Strategy · Pricing",
      severity: 2,
      facts: {
        months: m.label,
        clients: under.map((c) => c.name).join(", "),
        hoursSharePct: pct(under.reduce((t, c) => t + c.hoursShare, 0)),
        hourCostIls: Math.round(m.loadedHourCost),
        gapIls: Math.round(lost),
      },
      figure: `${MINUS}${formatILSShort(lost)}/mo`,
      title: `${under.length === 1 ? `${under[0].name} pays` : `${under.length} clients pay`} less than an hour costs the studio`,
      body:
        `Over ${m.label} a billable hour cost ${formatILS(Math.round(m.loadedHourCost))} with everything in — salaries, freelancers, rent, tools. ` +
        `${andList(under.map((c) => `${c.name} (${formatILS(c.rate!)})`))} ${under.length === 1 ? "is" : "are"} below that, on ${pct(under.reduce((t, c) => t + c.hoursShare, 0))}% of the hours: ` +
        `about ${money(lost)} a month the other clients make up. Raise the rate, or cap the hours.`,
      href: "/finance/rates",
      action: "Open Rates",
    });
  }

  // 3 · Rates that haven't moved while the cost of an hour has.
  const old = m.clients.filter((c) => c.hoursShare >= MATTERS && c.rateAgeMonths != null && c.rateAgeMonths >= BENCH.rateAgeMonths);
  if (old.length) {
    const rise = m.loadedHourCostLastYear ? m.loadedHourCost / m.loadedHourCostLastYear - 1 : null;
    card("rate-age", {
      area: "Strategy · Pricing",
      severity: 1,
      facts: { clients: old.map((c) => c.name).join(", "), oldestMonths: Math.max(...old.map((c) => c.rateAgeMonths!)), hourCostRisePct: rise == null ? null : pct(rise) },
      figure: null,
      title: `${old.length === 1 ? `${old[0].name}'s rate hasn't` : `${old.length} clients' rates haven't`} moved in a year or more`,
      body:
        `${andList(old.map((c) => `${c.name} (${c.rateAgeMonths} months)`))}.` +
        (rise != null && rise >= 0.03 ? ` An hour costs the studio ${pct(rise)}% more than a year ago, so the same rate buys less margin each quarter.` : "") +
        " Studios that hold their margin raise rates on a schedule, usually yearly — new clients first, existing ones at renewal, with a month or two of notice.",
      href: "/finance/rates",
      action: "Open Rates",
    });
  }

  // 4 · Is the team the right size for the work?
  if (m.utilization != null && m.designers >= 2) {
    const spare = (BENCH.utilizationTarget - m.utilization) * m.designers * (m.workdays / m.months.length) * 8;
    if (m.utilization < BENCH.utilizationLow) {
      card("capacity", {
        area: "Strategy · Team",
        severity: 2,
        facts: { months: m.label, utilizationPct: pct(m.utilization), designers: Number(m.designers.toFixed(1)), spareHoursPerMonth: Math.round(spare), openLeads: m.pipeline.openLeads, spareIls: Math.round(spare * m.avgRate) },
        figure: `${formatILSShort(spare * m.avgRate)}/mo`,
        title: `The team billed ${pct(m.utilization)}% of its hours over ${m.label} — there is room to sell`,
        body:
          `${m.designers.toFixed(1)} salaried designers billed ${pct(m.utilization)}% of a full day on average. A healthy studio bills 65–80% (a rule of thumb); getting to 75% is about ${h(spare)} more billable hours a month — ` +
          `${money(spare * m.avgRate)} at the average rate, with no new cost. ` +
          (m.pipeline.openLeads ? `${m.pipeline.openLeads} leads are open: that is where it comes from, before any hire.` : "No lead is open right now: new work matters more than anything on the cost side."),
        href: "/leads",
        action: "Open Leads",
      });
    } else if (m.utilization > BENCH.utilizationHigh) {
      card("capacity", {
        area: "Strategy · Team",
        severity: 2,
        facts: { months: m.label, utilizationPct: pct(m.utilization), designers: Number(m.designers.toFixed(1)), openLeads: m.pipeline.openLeads, candidates: m.pipeline.candidates },
        figure: null,
        title: `The team billed ${pct(m.utilization)}% of its hours over ${m.label} — it is full`,
        body:
          `${m.designers.toFixed(1)} salaried designers billed ${pct(m.utilization)}% of a full day, which leaves little for holidays, sick days or a new client. ` +
          `With ${m.pipeline.openLeads} leads open, the order is a higher rate for new work, then a freelancer for the overflow, then a hire — and only if the work is profitable: busy and thin is a pricing problem` +
          (m.pipeline.candidates ? ` (${m.pipeline.candidates} candidates are active).` : "."),
        href: "/plan",
        action: "Open the weekly plan",
      });
    }
  }

  // 5 · A freelancer working enough hours that a hire would cost less.
  const heavy = m.freelancers.filter((f) => f.hireBreakEvenHours != null && (f.hoursPerMonth >= f.hireBreakEvenHours * 0.9 || f.hoursPerMonth >= BENCH.freelancerSteadyHours));
  if (heavy.length) {
    const f = heavy.sort((a, b) => b.hoursPerMonth - a.hoursPerMonth)[0];
    card("freelance-or-hire", {
      area: "Strategy · Team",
      severity: 1,
      facts: { months: m.label, name: f.name, hoursPerMonth: Math.round(f.hoursPerMonth), breakEvenHours: Math.round(f.hireBreakEvenHours!), monthIls: Math.round(f.hoursPerMonth * f.hourlyIls) },
      figure: `${formatILSShort(f.hoursPerMonth * f.hourlyIls)}/mo`,
      title: `${f.name} works ${h(f.hoursPerMonth)}h a month — worth comparing with a hire`,
      body:
        `At ${f.name}'s rate, ${h(f.hireBreakEvenHours!)}h a month costs what an average salaried designer does. Over ${m.label} it was ${h(f.hoursPerMonth)}h a month. ` +
        "If that work is steady, a hire is cheaper and yours; if it comes and goes, the freelancer is still the right shape.",
      href: "/finance/freelance",
      action: "Open Freelance",
    });
  }

  // 6 · People's cost against the income they bring.
  const people = m.shares.salaries + m.shares.freelance;
  if (people >= BENCH.peopleShareWarn) {
    card("people-share", {
      area: "Strategy · Costs",
      severity: people >= 0.65 ? 2 : 1,
      facts: { months: m.label, peopleSharePct: pct(people), salariesPct: pct(m.shares.salaries), freelancePct: pct(m.shares.freelance), benchmarkPct: pct(BENCH.peopleShare), peopleIls: Math.round(people * m.revenue) },
      figure: `${pct(people)}%`,
      title: `People took ${pct(people)}% of income over ${m.label}`,
      body:
        `Salaries ${pct(m.shares.salaries)}% and freelancers ${pct(m.shares.freelance)}%. The usual rule of thumb for agencies is ${pct(BENCH.peopleShare)}% or less — US-centric, so read it as a direction, not a target. ` +
        "The lever is rarely the salaries themselves: it is the price of an hour and how many of the team's hours are billed.",
      href: "/finance/salaries",
      action: "Open Salaries",
    });
  }

  // 7 · Selling hours in a year when tools make the hours shorter.
  if (m.hourlyShare >= BENCH.hourlyShare) {
    card("hourly-model", {
      area: "Strategy · Pricing",
      severity: 1,
      facts: { months: m.label, hourlySharePct: pct(m.hourlyShare) },
      figure: null,
      title: `${pct(m.hourlyShare)}% of income over ${m.label} was sold by the hour`,
      body:
        "When AI makes the team faster, an hourly price pays the studio less for the same result. The route practitioners describe is from hours to fixed-price or productized work to value — " +
        "for new clients first, never all at once. Pick one repeatable piece of work and quote the next one as a fixed deliverable; keep tracking the hours as your cost.",
      href: "/leads",
      action: "Open Leads",
    });
  }

  // 8 · How much of what the studio sells is the owner's own time.
  if (m.ownerShare != null && m.ownerShare >= 0.25) {
    card("owner-load", {
      area: "Strategy · You",
      severity: m.ownerShare >= 0.4 ? 2 : 1,
      facts: { months: m.label, ownerSharePct: pct(m.ownerShare) },
      figure: null,
      title: `${pct(m.ownerShare)}% of the billable hours over ${m.label} were yours`,
      body: `That much of the income stops when you do, and the hours you bill aren't spent selling, hiring or pricing. Which of those clients could someone else lead by next quarter?`,
      href: "/reports",
      action: "Open Reports",
    });
  }
  return out;
}

/* ── What Claude is sent: the same picture, no amounts ─────────────────── */

/**
 * The studio for an outside reader. ⚠️ NO AMOUNT: money appears only as a
 * share of income, a percentage change, or an index where the average rate is
 * 100. Hours, counts and months are given as they are.
 */
export function businessBrief(m: BusinessMetrics, today: string, findings: { area: string; title: string }[]) {
  const index = (v: number | null) => (v == null || m.avgRate <= 0 ? null : Math.round((v / m.avgRate) * 100));
  const share = (s: BusinessMetrics["shares"] | null) => (s ? { salaries: pct(s.salaries), freelancers: pct(s.freelance), rent: pct(s.rent), tools: pct(s.tools), other: pct(s.other) } : null);
  return {
    today,
    period: m.label,
    profit: { marginPct: pct(m.margin), sameMonthsLastYearPct: m.marginLastYear == null ? null : pct(m.marginLastYear), targetPct: pct(TARGET_MARGIN) },
    costsAsShareOfIncomePct: share(m.shares),
    costsAsShareOfIncomeLastYearPct: share(m.sharesLastYear),
    team: {
      salariedDesigners: Number(m.designers.toFixed(1)),
      billedShareOfAFullDayPct: m.utilization == null ? null : pct(m.utilization),
      ownersShareOfBillableHoursPct: m.ownerShare == null ? null : pct(m.ownerShare),
      billableHoursPerMonth: Math.round(m.billableHours / m.months.length),
      activeCandidates: m.pipeline.candidates,
    },
    pricing: {
      averageRateIndex: 100,
      costOfABillableHourIndex: index(m.loadedHourCost),
      costOfAnHourChangeOverAYearPct: m.loadedHourCostLastYear ? pct(m.loadedHourCost / m.loadedHourCostLastYear - 1) : null,
      rateIndexNeededForTarget: index(m.loadedHourCost / (1 - TARGET_MARGIN)),
    },
    toReachTarget: m.gap
      ? {
          ratesUpPct: pct(m.gap.rateUp),
          orExtraBillableHoursPerMonth: Math.round(m.gap.extraHoursPerMonth),
          orExtraHoursPerDesignerPerDay: m.gap.extraPerDesignerDay == null ? null : Number(m.gap.extraPerDesignerDay.toFixed(1)),
          orCostsDownPct: pct(m.gap.costCut),
        }
      : "at or above target",
    incomeSoldByTheHourPct: pct(m.hourlyShare),
    concentration: { largestClientShareOfHoursPct: pct(m.topClient), topThreeShareOfHoursPct: pct(m.topThree), activeClients: m.clients.length },
    clients: m.clients.slice(0, 12).map((c) => ({
      name: c.name,
      shareOfBillableHoursPct: pct(c.hoursShare),
      rateIndex: index(c.rate),
      rateUnchangedForMonths: c.rateAgeMonths,
      leftAfterItsPeoplePct: c.leftShare == null ? null : pct(c.leftShare),
    })),
    freelancers: m.freelancers.map((f) => ({
      name: f.name,
      hoursPerMonth: Math.round(f.hoursPerMonth),
      hourCostIndex: index(f.hourlyIls),
      hoursPerMonthWhereAHireCostsTheSame: f.hireBreakEvenHours == null ? null : Math.round(f.hireBreakEvenHours),
    })),
    pipeline: { openLeads: m.pipeline.openLeads, leadsWaitingOnTheStudio: m.pipeline.waitingOnUs },
    whatTheChecksFoundToday: findings,
  };
}
