// Today's studio, as the scenario engine starts from it (pure). Averages over
// the last 3 FINISHED months — what the studio costs and can deliver now. It
// says nothing about demand ahead: the futures are the owner's inputs, and
// the past only comes back as reference marks (`references`).

import { LINE, type PnlMonthly } from "@/lib/finance/finance";
import { fxQuote, type FxTable } from "@/lib/finance/fx";
import { studioToday } from "@/lib/finance/format";
import type { FormulaFreelancer } from "@/lib/finance/overview";
import { finishedThrough, monthsEnding, type Ledger, type PayslipMonth, type Person } from "@/lib/finance/people";
import { initialsOf } from "./engine";
import type { Baseline, CompanyFacts, Member, Ym } from "./types";

/** Share of a designer's logged hours that can go to clients — the rest is
 * the studio's own minimum (meetings, the website). */
export const CLIENT_SHARE_OF_HOURS = 0.9;

/** Nitsan, 2026-11-10: he and Michal can supply "about 30 billable hours a month combined". */
export const OWNER_AND_STAFF_HOURS = 30;

/** Freelancers take as much as the work needs (Nitsan, 2026-11-11: "how much
 * we use AB and Dima is unknown, it depends on client work … with fewer hired
 * full time, more freelancers will be used"). So their availability is at
 * least a full month's worth, not their recent hours. */
export const FREELANCER_OPEN_HOURS = 160;

export interface BaselineInput {
  today?: Date;
  pnl: PnlMonthly[];
  people: Person[];
  ledgers: Map<string, Ledger>;
  /** Sliding-rate freelancers kept in the tracker (getGoalInputs). */
  formula: FormulaFreelancer[];
  ownerSlips: PayslipMonth[];
  fx: FxTable;
  facts: Pick<CompanyFacts, "loanAsOf">;
}

const ymOf = (y: number, m: number): Ym => `${y}-${String(m).padStart(2, "0")}`;

export function buildBaseline(input: BaselineInput): Baseline {
  const today = input.today ?? new Date();
  const start = studioToday(today).slice(0, 7);
  const basedOn = monthsEnding(finishedThrough(today), 3);
  const n = basedOn.length;

  const vals = new Map<Ym, Map<string, number>>();
  for (const r of input.pnl) {
    const k = ymOf(r.year, r.month);
    let v = vals.get(k);
    if (!v) vals.set(k, (v = new Map()));
    v.set(r.lineItem, (v.get(r.lineItem) ?? 0) + r.value);
  }
  const line = (k: Ym, l: string) => vals.get(k)?.get(l) ?? 0;
  const avg = (l: string) => basedOn.reduce((a, k) => a + line(k, l), 0) / n;
  const hourlyIncome = (k: Ym) => vals.get(k)?.get(LINE.hoursIncome) ?? line(k, LINE.totalRevenues) - line(k, LINE.projectIncome);

  const soldSum = basedOn.reduce((a, k) => a + line(k, LINE.totalHours), 0);
  const rate = soldSum ? basedOn.reduce((a, k) => a + hourlyIncome(k), 0) / soldSum : 0;
  const parts = [LINE.expensesMonthly, LINE.expensesYearly, LINE.expensesMisc, LINE.expensesAccounting, LINE.expensesLawyer, LINE.expensesGur];
  const otherFixed = basedOn.reduce((a, k) => {
    const sum = parts.reduce((s, l) => s + line(k, l), 0);
    return a + (sum || line(k, LINE.expensesOther));
  }, 0) / n;

  // ── The team ────────────────────────────────────────────────────────────
  const formulaIds = new Set(input.formula.map((f) => f.profileId).filter(Boolean));
  const team: Member[] = [];
  // Salaries paid last finished month to the people kept — the P&L's rest is "other payroll".
  let lastPay = 0;
  let keys = 0;
  let clientWork = 0;
  for (const p of input.people) {
    if (p.endDate && p.endDate.slice(0, 7) < start) continue;
    const ledger = input.ledgers.get(p.id);
    if (!ledger) continue;
    const months = basedOn.map((k) => ledger.get(k));
    const sum = (f: "salary" | "freelance" | "hours" | "billableHours" | "keysHours" | "studioHours") => months.reduce((a, m) => a + (m?.[f] ?? 0), 0);
    const salary = sum("salary");
    const freelance = sum("freelance");
    if (salary <= 0 && freelance <= 0) continue;
    // An employee not paid in the last finished month has left (Shaked, 9 Sep
    // 2026): not on today's team, whatever the tracker's end date says.
    const lastMonth = months[n - 1];
    if (salary > 0 && freelance <= 0 && (lastMonth?.salary ?? 0) <= 0) continue;
    lastPay += lastMonth?.salary ?? 0;
    const lastSalary = [...months].reverse().find((m) => (m?.salary ?? 0) > 0)?.salary ?? 0;
    const hours = sum("hours") / n;
    const base = { id: p.id, name: p.name, initials: initialsOf(p.name), hours, billable: sum("billableHours") / n, keys: sum("keysHours") / n, studio: sum("studioHours") / n };
    if (salary > 0) {
      const kind = p.position === "owner" ? "owner" : p.position == null || p.position === "designer" ? "designer" : "staff";
      team.push({ ...base, kind, monthlyCost: lastSalary, capacity: kind === "designer" ? Math.round(hours * CLIENT_SHARE_OF_HOURS) : 0 });
      if (kind === "designer") {
        keys += base.keys;
        clientWork += base.billable + base.keys;
      }
    } else if (!formulaIds.has(p.id)) {
      const tracked = hours >= 20;
      const maxHours = Math.max(...months.map((m) => m?.hours ?? 0));
      team.push({
        ...base,
        kind: "freelancer",
        monthlyCost: tracked ? 0 : freelance / n,
        capacity: tracked ? Math.max(FREELANCER_OPEN_HOURS, Math.round(maxHours * 1.1)) : 0,
        price: tracked ? { kind: "flat", rate: freelance / (hours * n), currency: "ILS" } : undefined,
        paidWritedowns: true,
      });
      if (tracked) {
        keys += base.keys;
        clientWork += base.billable + base.keys;
      }
    }
  }
  // Sliding-rate freelancers kept in the tracker (AB, Milica, Dima): their
  // terms in ₪ at the official rate, as finance books them.
  for (const f of input.formula) {
    const recent = f.recent.map((r) => r.hours);
    const avgHours = recent.length ? recent.reduce((a, h) => a + h, 0) / recent.length : 0;
    const t = f.terms;
    team.push({
      id: f.profileId ?? `tracker:${f.name}`,
      name: f.name,
      initials: initialsOf(f.name),
      kind: "freelancer",
      monthlyCost: 0,
      capacity: Math.max(FREELANCER_OPEN_HOURS, Math.round(Math.max(...recent, f.soFar, 0) * 1.1)),
      hours: avgHours,
      billable: avgHours,
      keys: 0,
      studio: 0,
      price: { kind: "terms", currency: "ILS", terms: { ...t, rateHigh: t.rateHigh * f.fx, rateLow: t.rateLow * f.fx } },
      paidWritedowns: true,
    });
  }
  team.sort((a, z) => order(a.kind) - order(z.kind) || z.monthlyCost - a.monthlyCost || a.name.localeCompare(z.name));

  const owner = team.find((m) => m.kind === "owner");
  const slip = [...input.ownerSlips].sort((a, z) => z.year - a.year || z.month - a.month)[0];
  const ownerGross = slip ? (slip.salaryRate ?? slip.grossTotal ?? null) : null;
  const hasStaff = team.some((m) => m.kind === "staff");

  const [sy, sm] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
  const references = referencesOf(vals, finishedThrough(today));
  const factsYm = input.facts.loanAsOf.slice(0, 7);
  const upTo = finishedThrough(today);
  let profitSinceFacts = 0;
  for (const [k, v] of vals) if (k > factsYm && k <= upTo) profitSinceFacts += v.get(LINE.profit) ?? 0;

  return {
    start,
    basedOn,
    rate,
    keysShare: clientWork > 0 ? keys / clientWork : 0,
    soldHours: soldSum / n,
    projectIncome: avg(LINE.projectIncome),
    team,
    otherPayroll: Math.max(0, line(basedOn[n - 1], LINE.salaries) - lastPay),
    office: avg(LINE.rentExpenses),
    otherFixed,
    ownerId: owner?.id ?? null,
    ownerGross,
    employerRatio: owner && ownerGross ? owner.monthlyCost / ownerGross : 1.3,
    ownerHours: hasStaff ? OWNER_AND_STAFF_HOURS / 2 : OWNER_AND_STAFF_HOURS,
    staffHours: hasStaff ? OWNER_AND_STAFF_HOURS / 2 : 0,
    fx: { EUR: fxQuote(input.fx, "EUR", sy, sm).rate, USD: fxQuote(input.fx, "USD", sy, sm).rate },
    references,
    actual: { revenue: avg(LINE.totalRevenues), costs: avg(LINE.totalExpenses), profit: avg(LINE.profit), freelance: avg(LINE.freelance) },
    profitSinceFacts,
  };
}

const order = (k: Member["kind"]) => ({ owner: 0, staff: 1, designer: 2, freelancer: 3 })[k];

/** Past sold hours a month — shown beside the demand sliders, never fed in. */
function referencesOf(vals: Map<Ym, Map<string, number>>, upTo: Ym): Baseline["references"] {
  const byYear = new Map<number, number[]>();
  for (const [k, v] of vals) {
    const h = v.get(LINE.totalHours) ?? 0;
    if (k > upTo || h <= 0) continue;
    const y = Number(k.slice(0, 4));
    byYear.set(y, [...(byYear.get(y) ?? []), h]);
  }
  const out: Baseline["references"] = [];
  const y = Number(upTo.slice(0, 4));
  for (const yr of [y - 1, y]) {
    const hs = byYear.get(yr);
    if (hs?.length) out.push({ label: `${yr} average`, hours: hs.reduce((a, h) => a + h, 0) / hs.length });
  }
  const cur = byYear.get(y);
  if (cur?.length) out.push({ label: `${y} lowest month`, hours: Math.min(...cur) });
  const last3 = monthsEnding(upTo, 3).map((k) => vals.get(k)?.get(LINE.totalHours) ?? 0);
  out.push({ label: "Last 3 months", hours: last3.reduce((a, h) => a + h, 0) / 3 });
  return out;
}
