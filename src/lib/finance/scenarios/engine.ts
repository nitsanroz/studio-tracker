// The scenario engine (pure): one scenario = today's baseline + decisions,
// run month by month against each of three demand futures, for 12 months.
//
// Every month:
//   volume V   = future's hours × (1+drift)^m × (1 − in-house)  (today's sold hours)
//   delivered H = V × (1 − AI gain)
//   revenue    = H×(1−p)×rate + V×p×rate×(1−discount)  [p = fixed-price share]
//                + service lines + project income
//   logged W   = (H + service hours) ÷ (1 − Keys share)  — write-downs use capacity, earn nothing
//   capacity   = owner & staff hours → employees → freelancers, cheapest first;
//                what doesn't fit is turned away (its revenue lost)
//   costs      = employees (fixed) + freelancers (hours × rate) + office + other fixed + one-offs
// and a cash track beside the profit: the leasehold write-off is no cash;
// the tax refund, dividend tax and loan moves are cash only.
//
// The point the AI shift makes visible: billing by the hour, faster work is
// less revenue; per deliverable, it is margin.

import { billFor } from "@/lib/finance/freelance-rate";
import { addMonths, monthsBetween, type Decision } from "./decisions";
import { ARRANGEMENTS_LAW } from "./facts-shared";
import { FUTURE_IDS, type Baseline, type CompanyFacts, type Future, type FutureId, type Futures, type Member, type Price, type Ym } from "./types";

export const HORIZON = 12;

/** What the decisions in force make of one month. */
export interface MonthState {
  /** capSet: a decision gave them these hours (a replacement) — they get them first. */
  team: (Member & { costNow: number; capNow: number; capSet?: boolean })[];
  office: number;
  rateMul: number;
  keys: number;
  aiGain: number;
  inHouse: number;
  fixedShare: number;
  discount: number;
  services: { hours: number; rate: number }[];
  /** Other fixed costs after cuts, AI tools and recurring items. */
  otherFixed: number;
  ownerHours: number;
  staffHours: number;
  ownerGross: number | null;
  ownerCost: number;
  withdrawal: number;
  /** One-offs this month: P&L (signed, + income) and cash (signed, + in). */
  oneOffs: { label: string; pnl: number; cash: number }[];
}

const ramp = (from: Ym, ym: Ym, months = 0) => (months > 0 ? Math.min(1, (monthsBetween(from, ym) + 1) / months) : 1);

/** ₪ an hour for a price, at a month's hours. */
export function hourCost(price: Price, hours: number, fx: Baseline["fx"]): number {
  const k = price.currency === "ILS" ? 1 : fx[price.currency];
  if (price.kind === "flat") return price.rate * k;
  return hours > 0 ? (billFor(hours, price.terms) / hours) * k : price.terms.rateHigh * k;
}

function memberCost(m: Member, hours: number, keys: number, fx: Baseline["fx"]): number {
  if (!m.price) return m.monthlyCost;
  const paid = m.paidWritedowns === false ? hours * (1 - keys) : hours;
  if (m.price.kind === "terms") return billFor(paid, m.price.terms) * (m.price.currency === "ILS" ? 1 : fx[m.price.currency]);
  return paid * hourCost(m.price, paid, fx);
}

export function stateAt(b: Baseline, decisions: Decision[], ym: Ym, facts: CompanyFacts): MonthState {
  const active = decisions.filter((d) => d.from <= ym).sort((a, z) => a.from.localeCompare(z.from));
  const team = new Map<string, MonthState["team"][number]>(b.team.map((m) => [m.id, { ...m, costNow: m.monthlyCost, capNow: m.capacity }]));
  const s: MonthState = {
    team: [],
    office: b.office,
    rateMul: 1,
    keys: b.keysShare,
    aiGain: 0,
    inHouse: 0,
    fixedShare: 0,
    discount: 0,
    services: [],
    otherFixed: b.otherFixed,
    ownerHours: b.ownerHours,
    staffHours: b.staffHours,
    ownerGross: b.ownerGross,
    ownerCost: b.team.find((m) => m.kind === "owner")?.monthlyCost ?? 0,
    withdrawal: 0,
    oneOffs: [],
  };
  const owner = b.team.find((m) => m.kind === "owner");
  if (owner) team.delete(owner.id);
  if (ym === facts.taxRefundMonth && facts.taxRefund) s.oneOffs.push({ label: "Tax refund", pnl: 0, cash: facts.taxRefund });

  // Office notices can't be undone by a later move, but a move before the end applies.
  for (const d of decisions) {
    if (d.type === "office_end") {
      const last = addMonths(d.from, d.months ?? 4);
      if (ym > last) s.office = 0;
      if (ym === last) {
        if (d.writeoff) s.oneOffs.push({ label: "Leasehold write-off", pnl: -d.writeoff, cash: 0 });
        // The cash is the price; the P&L sees price less book value (a loss below it).
        if (d.equipmentSale) s.oneOffs.push({ label: "Equipment sold", pnl: d.equipmentSale - facts.equipmentBook, cash: d.equipmentSale });
        if (d.movingCost) s.oneOffs.push({ label: "Moving", pnl: -d.movingCost, cash: -d.movingCost });
      }
    }
  }
  const officeEnded = s.office === 0;
  for (const d of active) {
    const m = d.personId ? team.get(d.personId) : undefined;
    switch (d.type) {
      case "office_end":
        if (ym > addMonths(d.from, d.months ?? 4)) s.otherFixed -= d.alsoSaves ?? 0;
        break;
      case "office_move":
        if (!officeEnded) s.office = d.amount ?? 0;
        break;
      case "person_leave":
        if (m && ym > d.from) team.delete(m.id);
        break;
      case "person_pay":
        if (m && !m.price) m.costNow *= 1 + (d.pct ?? 0) / 100;
        break;
      case "person_hours":
        if (m) {
          m.costNow *= 1 + (d.pct ?? 0) / 100;
          m.capNow *= 1 + (d.pct ?? 0) / 100;
        }
        break;
      case "person_to_freelance":
        if (m) {
          m.kind = "freelancer";
          m.price = { kind: "flat", rate: d.rate ?? 0, currency: d.currency ?? "ILS" };
          m.paidWritedowns = d.paidWritedowns ?? false;
          m.capNow = d.capacity ?? m.capNow;
          m.capSet = d.capacity != null;
          m.costNow = 0;
        }
        break;
      case "freelancer_add":
        team.set(d.id, {
          id: d.id,
          name: d.name || "Freelancer",
          initials: initialsOf(d.name || "Freelancer"),
          kind: "freelancer",
          monthlyCost: 0,
          capacity: d.capacity ?? 0,
          hours: 0,
          billable: 0,
          keys: 0,
          studio: 0,
          price: { kind: "flat", rate: d.rate ?? 0, currency: d.currency ?? "ILS" },
          paidWritedowns: d.paidWritedowns ?? false,
          costNow: 0,
          capNow: d.capacity ?? 0,
          capSet: true,
        });
        break;
      case "freelancer_change":
        if (m) {
          if (d.rate) m.price = { kind: "flat", rate: d.rate, currency: m.price?.currency ?? "ILS" };
          if (d.capacity != null) {
            m.capNow = d.capacity;
            m.capSet = true;
          }
          if (d.paidWritedowns != null) m.paidWritedowns = d.paidWritedowns;
        }
        break;
      case "freelancer_remove":
        if (m) team.delete(m.id);
        break;
      case "hire":
        team.set(d.id, {
          id: d.id,
          name: d.name || "New hire",
          initials: initialsOf(d.name || "New hire"),
          kind: "designer",
          monthlyCost: d.amount ?? 0,
          capacity: d.capacity ?? 0,
          hours: 0,
          billable: 0,
          keys: 0,
          studio: 0,
          costNow: d.amount ?? 0,
          capNow: (d.capacity ?? 0) * ramp(d.from, ym, d.months),
        });
        break;
      case "rate_change":
        s.rateMul *= 1 + (d.pct ?? 0) / 100;
        break;
      case "keys_target":
        s.keys = Math.min(0.9, Math.max(0, (d.pct ?? 0) / 100));
        break;
      case "ai_productivity":
        s.aiGain = 1 - (1 - s.aiGain) * (1 - ((d.pct ?? 0) / 100) * ramp(d.from, ym, d.months));
        s.otherFixed += d.toolCost ?? 0;
        break;
      case "in_house":
        s.inHouse = 1 - (1 - s.inHouse) * (1 - ((d.pct ?? 0) / 100) * ramp(d.from, ym, d.months));
        break;
      case "fixed_price":
        s.fixedShare = Math.min(1, Math.max(0, (d.pct ?? 0) / 100));
        s.discount = Math.min(1, Math.max(0, (d.discount ?? 0) / 100));
        break;
      case "service_line":
        s.services.push({ hours: d.hours ?? 0, rate: d.rate ?? 0 });
        break;
      case "tools_cut":
        s.otherFixed -= d.amount ?? 0;
        break;
      case "one_off":
        if (d.from === ym) s.oneOffs.push({ label: d.label || "One-off", pnl: d.amount ?? 0, cash: d.amount ?? 0 });
        break;
      case "recurring":
        s.otherFixed += d.amount ?? 0;
        break;
      case "owner_hours":
        s.ownerHours = d.hours ?? 0;
        break;
      case "staff_hours":
        s.staffHours = d.hours ?? 0;
        break;
      case "owner_salary":
        s.ownerGross = d.amount ?? 0;
        s.ownerCost = (d.amount ?? 0) * b.employerRatio;
        break;
      case "withdrawal":
        s.withdrawal = d.amount ?? 0;
        break;
      case "dividend":
      case "loan_repay":
        break; // cash only — the cash track reads them
    }
  }
  s.otherFixed = Math.max(0, s.otherFixed);
  s.team = [...team.values()];
  return s;
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export interface MonthResult {
  month: Ym;
  /** Today's sold hours coming in (after in-house), and the hours sold after AI. */
  volume: number;
  sold: number;
  /** Logged client work needed and what fitted. */
  work: number;
  served: number;
  turnedAway: number;
  /** Employee capacity left idle (paid, not used). */
  idle: number;
  revenue: number;
  team: number;
  freelance: number;
  office: number;
  other: number;
  owner: number;
  oneOff: number;
  costs: number;
  profit: number;
  cumProfit: number;
  cash: number;
  loan: number;
  /** Dividend tax paid, dividend net beyond the loan (cash to you). */
  dividendTax: number;
  dividendCash: number;
}

export interface FutureResult {
  months: MonthResult[];
  profit: number;
  worst: { month: Ym; profit: number };
  lossMonths: number;
  /** The deepest dip in cumulative profit (≤ 0) — what you'd need in reserve. */
  reserve: number;
  lowestCash: { month: Ym; cash: number };
  /** Months until cash goes under zero; null = not within the horizon. */
  runway: number | null;
  underFloor: number;
  turnedAway: number;
  idle: number;
  retainedEnd: number;
  /** Your net salary a month (it doesn't move with the studio's year). */
  salaryNet: number;
  /** The extra beyond salary: a dividend for the whole year (Nitsan,
   * 2026-11-11: "how much money can I withdraw"). Limited by the year's profit
   * after company tax AND by the cash room above your floor — a dividend
   * can't take the bank under it. Net = after dividend tax; it clears the
   * shareholder loan first, the rest reaches you. */
  dividend: { gross: number; net: number; toLoan: number; toYou: number; limitedBy: "profit" | "cash" | "none" };
  /** Salary net + the year's net dividend spread over 12 months — for the take-home floor. */
  canPayYou: number;
}

export interface ScenarioResult {
  futures: Record<FutureId, FutureResult>;
  /** Today's sold hours a month that break even once every decision is in;
   * null when even full capacity doesn't. */
  breakEven: number | null;
  /** Share of costs that don't fall when work does (month 12, middle future). */
  fixedShare: number;
  cashFloor: number;
  loanEnd: number;
}

/** One month's money at a volume, given the state — no cash, no one-offs. */
export function monthMoney(b: Baseline, s: MonthState, volume: number, projectIncome: number) {
  const sold = volume * (1 - s.aiGain);
  const serviceHours = s.services.reduce((a, x) => a + x.hours, 0);
  const work = (sold + serviceHours) / Math.max(0.1, 1 - s.keys);
  const rate = b.rate * s.rateMul;
  const variable = sold * (1 - s.fixedShare) * rate + volume * s.fixedShare * rate * (1 - s.discount) + s.services.reduce((a, x) => a + x.hours * x.rate, 0);

  // Fill: owner & staff, employees, then freelancers — first those a decision
  // gave hours (a replacement, cheapest first), then the rest shared in
  // today's mix: by their recent hours (AB and Dima take most of it today),
  // each up to their availability.
  let left = work;
  const take = (cap: number) => {
    const t = Math.max(0, Math.min(left, cap));
    left -= t;
    return t;
  };
  take(s.ownerHours + s.staffHours);
  const employees = s.team.filter((m) => !m.price && m.kind !== "freelancer");
  let idle = 0;
  for (const e of employees) idle += e.capNow - take(e.capNow);
  // Freelancers with no hours known are a fixed amount (their recent pay).
  const fixedFreelance = s.team.filter((m) => m.kind === "freelancer" && !m.price);
  const hourly = s.team.filter((m) => m.price);
  const used = new Map<string, number>();
  for (const m of [...hourly.filter((x) => x.capSet)].sort((a, z) => hourCost(a.price!, a.capNow, b.fx) - hourCost(z.price!, z.capNow, b.fx)))
    used.set(m.id, take(m.capNow));
  let pool = hourly.filter((x) => !x.capSet);
  for (let pass = 0; pass < 4 && left > 1e-9 && pool.length; pass++) {
    const weight = (m: (typeof pool)[number]) => (pool.some((x) => x.hours > 0) ? m.hours : 1);
    const total = pool.reduce((a, m) => a + weight(m), 0);
    const share = left;
    for (const m of pool) {
      const room = m.capNow - (used.get(m.id) ?? 0);
      const h = Math.min(room, (share * weight(m)) / (total || 1), left);
      used.set(m.id, (used.get(m.id) ?? 0) + Math.max(0, h));
      left -= Math.max(0, h);
    }
    pool = pool.filter((m) => (used.get(m.id) ?? 0) < m.capNow - 1e-9 && weight(m) > 0);
  }
  let freelance = fixedFreelance.reduce((a, m) => a + m.costNow, 0);
  for (const m of hourly) {
    const h = used.get(m.id) ?? 0;
    if (h > 0) freelance += memberCost(m, h, s.keys, b.fx);
  }
  const served = work - left;
  const share = work > 0 ? served / work : 1;
  const revenue = variable * share + projectIncome;
  const team = employees.reduce((a, m) => a + m.costNow, 0) + b.otherPayroll;
  const costs = team + freelance + s.office + s.otherFixed + s.ownerCost;
  return { sold: sold * share, work, served, turnedAway: left, idle, revenue, team, freelance, costs, profit: revenue - costs };
}

const futureAt = (f: Future, i: number) => f.hours * Math.pow(1 + f.drift, i);

export function cashFloorOf(b: Baseline, facts: CompanyFacts): number {
  if (facts.cashFloor != null) return facts.cashFloor;
  const s = b.actual.costs;
  return Math.round((2 * s) / 1000) * 1000;
}

export function runScenario(b: Baseline, decisions: Decision[], futures: Futures, facts: CompanyFacts): ScenarioResult {
  const cashFloor = cashFloorOf(b, facts);
  // The loan grows by its interest from its date to the forecast's start.
  const loanStart = facts.loan * (1 + (facts.loanInterest * Math.max(0, monthsBetween(facts.loanAsOf.slice(0, 7), b.start))) / 12);
  let loanEnd = loanStart;
  const out = {} as Record<FutureId, FutureResult>;
  for (const id of FUTURE_IDS) {
    const f = futures[id];
    let cum = 0;
    let cash = facts.cashToday;
    let loan = loanStart;
    let retained = facts.retained + b.profitSinceFacts * (1 - facts.corporateTax);
    const months: MonthResult[] = [];
    let salaryNetSum = 0;
    for (let i = 0; i < HORIZON; i++) {
      const ym = addMonths(b.start, i);
      const s = stateAt(b, decisions, ym, facts);
      const volume = futureAt(f, i) * (1 - s.inHouse);
      const mm = monthMoney(b, s, volume, f.projectIncome);
      const oneOffPnl = s.oneOffs.reduce((a, o) => a + o.pnl, 0);
      const profit = mm.profit + oneOffPnl;
      cum += profit;
      // Cash: profit, less the non-cash part of one-offs, plus cash-only items.
      let flow = profit - oneOffPnl + s.oneOffs.reduce((a, o) => a + o.cash, 0);
      loan += (loan * facts.loanInterest) / 12;
      flow -= s.withdrawal;
      loan += s.withdrawal;
      let dividendTax = 0;
      let dividendCash = 0;
      for (const d of decisions) {
        if (d.from !== ym) continue;
        if (d.type === "loan_repay") {
          const a = Math.min(d.amount ?? 0, loan);
          loan -= a;
          flow += a;
        }
        if (d.type === "dividend" && d.amount) {
          const gross = d.amount / (1 - facts.dividendTax);
          dividendTax += gross - d.amount;
          const toLoan = Math.min(loan, d.amount);
          loan -= toLoan;
          dividendCash += d.amount - toLoan;
          retained -= gross;
        }
      }
      flow -= dividendTax + dividendCash;
      cash += flow;
      retained += profit * (1 - facts.corporateTax);
      salaryNetSum += (s.ownerGross ?? 0) * facts.netShare;
      months.push({
        month: ym,
        volume,
        sold: mm.sold,
        work: mm.work,
        served: mm.served,
        turnedAway: mm.turnedAway,
        idle: mm.idle,
        revenue: mm.revenue + s.oneOffs.reduce((a, o) => a + Math.max(0, o.pnl), 0),
        team: mm.team,
        freelance: mm.freelance,
        office: s.office,
        other: s.otherFixed,
        owner: s.ownerCost,
        oneOff: oneOffPnl,
        costs: mm.costs - s.oneOffs.reduce((a, o) => a + Math.min(0, o.pnl), 0),
        profit,
        cumProfit: cum,
        cash,
        loan,
        dividendTax,
        dividendCash,
      });
    }
    if (id === "mid") loanEnd = loan;
    const worst = months.reduce((a, m) => (m.profit < a.profit ? m : a), months[0]);
    const low = months.reduce((a, m) => (m.cash < a.cash ? m : a), months[0]);
    const broke = months.findIndex((m) => m.cash < 0);
    const salaryNet = salaryNetSum / HORIZON;
    // The year's dividend: what profit allows (after company tax), what the
    // bank allows above the floor (the whole gross leaves: net + its tax).
    const fromProfit = Math.max(0, cum) * (1 - facts.corporateTax);
    const cashRoom = Math.max(0, low.cash - cashFloor);
    const gross = Math.min(fromProfit, cashRoom);
    const net = gross * (1 - facts.dividendTax);
    const toLoan = Math.min(net, Math.max(0, loan));
    const limitedBy = gross <= 0 ? "none" : fromProfit <= cashRoom ? "profit" : "cash";
    out[id] = {
      months,
      profit: cum,
      worst: { month: worst.month, profit: worst.profit },
      lossMonths: months.filter((m) => m.profit < 0).length,
      reserve: Math.min(0, ...months.map((m) => m.cumProfit)),
      lowestCash: { month: low.month, cash: low.cash },
      runway: broke < 0 ? null : broke,
      underFloor: months.filter((m) => m.cash < cashFloor).length,
      turnedAway: months.reduce((a, m) => a + m.turnedAway, 0),
      idle: months.reduce((a, m) => a + m.idle, 0),
      retainedEnd: retained,
      salaryNet,
      dividend: { gross, net, toLoan, toYou: net - toLoan, limitedBy },
      canPayYou: salaryNet + net / HORIZON,
    };
  }

  // Break-even: every decision in force (the last month), no drift, no one-offs.
  const last = stateAt(b, decisions, addMonths(b.start, HORIZON - 1), facts);
  const pi = futures.mid.projectIncome;
  const at = (v: number) => monthMoney(b, last, v, pi).profit;
  let breakEven: number | null = null;
  if (at(0) >= 0) breakEven = 0;
  else {
    let hi = 50;
    while (hi < 5000 && at(hi) < 0) hi *= 1.5;
    if (at(hi) >= 0) {
      let lo = 0;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2;
        if (at(mid) >= 0) hi = mid;
        else lo = mid;
      }
      breakEven = hi;
    }
  }
  const mm = monthMoney(b, last, futureAt(futures.mid, HORIZON - 1) * (1 - last.inHouse), pi);
  const fixed = mm.costs - mm.freelance + last.team.filter((m) => m.kind === "freelancer" && !m.price).reduce((a, m) => a + m.costNow, 0);
  return { futures: out, breakEven, fixedShare: mm.costs > 0 ? fixed / mm.costs : 0, cashFloor, loanEnd };
}

/** Heading toward the Arrangements Law's line? */
export const nearArrangementsLaw = (r: ScenarioResult) => r.futures.good.retainedEnd > ARRANGEMENTS_LAW * 0.9;

/** How steady a scenario is, 0–100 (Nitsan, 2026-11-11: "a grade of
 * stability or risk"). Four parts, each 0–1, all read from the BAD future —
 * the one that tests a plan:
 *   35% break-even cushion — how far the bad future's hours sit above
 *       break-even (−50% or worse = 0, +50% or better = 1);
 *   25% cash — the bad future's lowest cash against the cash floor (0 at
 *       zero cash, 1 at 1.5× the floor);
 *   20% flexibility — the share of costs that fall when work does;
 *   20% steady months — months NOT at a loss in the bad future.
 * Higher is safer. It says nothing about how much a scenario earns — that's
 * the profit beside it. */
export function stabilityGrade(r: ScenarioResult, futures: Futures): number {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const bad = r.futures.bad;
  const cushion = r.breakEven == null ? 0 : clamp(0.5 + (futures.bad.hours - r.breakEven) / Math.max(1, futures.bad.hours));
  const cash = r.cashFloor > 0 ? clamp(bad.lowestCash.cash / (1.5 * r.cashFloor)) : bad.lowestCash.cash > 0 ? 1 : 0;
  const flexible = clamp(1 - r.fixedShare);
  const steady = clamp(1 - bad.lossMonths / HORIZON);
  return Math.round(100 * (0.35 * cushion + 0.25 * cash + 0.2 * flexible + 0.2 * steady));
}
