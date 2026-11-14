// &advice's rules that read BOTH sides (finance merge, stage 4 — Nitsan,
// 2026-11-14): the tracker knows hours, tasks and periods; finance knows what an
// hour is worth and what a freelancer costs. Neither pane could say these alone.
//
// Pure: run.ts loads both data sets and hands them over. Amounts are fine here —
// the store is the owner's alone (`finance_advice_items`) — but a TITLE never
// carries one: titles are what Claude is sent (lib/finance/advice/redact.ts).

import { parseISO, shiftDays, toISODate } from "@/lib/format";
import { daysBetween } from "@/lib/period-math";
import { paymentDueFor, DEFAULT_PAYMENT_TERMS_DAYS } from "@/lib/payment-terms";
import { rateFor, type RateTerms } from "@/lib/freelance-rate";
import { rateForClientOn } from "@/lib/finance/finance";
import { formatHours, formatILS, formatILSShort } from "@/lib/finance/format";
import type { AdviceData as MoneyData } from "@/lib/finance/advice/signals";
import type { AdviceData as StudioData } from "./signals";
import type { Finding } from "./merge";

/** A freelancer on a sliding rate, with what last month's rate needs. */
export interface CrossFreelancer {
  profileId: string;
  name: string;
  terms: RateTerms;
  /** ₪ per unit of their currency (1 for ILS) */
  fx: number;
  /** every hour they logged in the last complete month — it sets that month's rate */
  monthHours: number;
}

const MINUS = "−";
const money = (n: number) => (Math.abs(n) >= 10_000 ? formatILSShort(n) : formatILS(Math.round(n))).replace("-", MINUS);
const h = (n: number) => formatHours(Math.round(n * 10) / 10);
const pct = (f: number) => Math.round(f * 100);
const shift = (iso: string, n: number) => toISODate(shiftDays(parseISO(iso), n));
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The last complete month before `today`: its key and its name. */
export function lastMonthOf(today: string): { key: string; name: string } {
  const d = parseISO(today);
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return { key: toISODate(first).slice(0, 7), name: first.toLocaleDateString("en-GB", { month: "long" }) };
}

const liveClients = (studio: StudioData) => studio.clients.filter((c) => c.billable && !c.archived);

/** Report hours — Client Reports' own set: a billable, non-pending task of the client. */
function reportHours(studio: StudioData, clientId: string, from: string, to: string): number {
  const mine = new Set(studio.tasks.filter((t) => t.clientId === clientId && t.billable && t.pending !== true).map((t) => t.id));
  return studio.entries.filter((e) => mine.has(e.taskId) && e.date >= from && e.date <= to).reduce((t, e) => t + e.minutes / 60, 0);
}

/**
 * 1 · The studio's hour cards, in money. The tracker's rules count hours and
 * percentages because that was all it could see; the client's rate turns each
 * into what it is worth. The SAME card gains a figure and a sentence — never a
 * second card:
 *   scope       hours outside the published estimate × rate
 *   report-due  last week's unreported hours × rate
 *   cap         the hours OVER the period's cap × rate (nothing while under it)
 *   estimate    the hours OVER the estimate's top × rate (nothing while under it)
 * The rate is today's. No rate → the card is left as it was (finance's
 * "no rate" card says so). Titles are untouched: they are what Claude is sent.
 */
export function withMoney(findings: Finding[], money_: MoneyData): Finding[] {
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return findings.map((f) => {
    if (typeof f.facts.client !== "string") return f;
    let hours: number | null = null;
    let says: (amount: string) => string = () => "";
    if (f.signal === "scope") {
      hours = num(f.facts.outsideHours);
      says = (a) => ` At their rate that is about ${a} of work they haven't agreed to.`;
    } else if (f.signal === "report-due") {
      hours = num(f.facts.hours);
      says = (a) => ` About ${a} of work they haven't seen yet.`;
    } else if (f.signal === "cap") {
      const [used, cap] = [num(f.facts.usedPct), num(f.facts.capHours)];
      hours = used != null && cap != null && used > 100 ? (cap * (used - 100)) / 100 : null;
      says = (a) => ` The hours over the cap are worth about ${a}.`;
    } else if (f.signal === "estimate") {
      // "40h" or "30–40h": the top of the range is the budget.
      const top = typeof f.facts.estimated === "string" ? Number(f.facts.estimated.match(/(\d+(?:\.\d+)?)h$/)?.[1]) : NaN;
      const logged = num(f.facts.hours);
      hours = logged != null && Number.isFinite(top) && logged > top ? logged - top : null;
      says = (a) => ` The hours past the estimate are worth about ${a}.`;
    } else return f;
    if (hours == null || hours <= 0) return f;
    const rate = rateForClientOn(money_.rates, f.facts.client, money_.today);
    if (rate == null) return f;
    const value = hours * rate;
    return {
      ...f,
      facts: { ...f.facts, rateIls: rate, valueIls: Math.round(value) },
      figure: formatILSShort(value),
      body: `${f.body}${says(money(value))}`,
    };
  });
}

/**
 * 2 · What a freelancer's hours cost against what they bring in, per client,
 * in the last complete month. Cost = their hours for the client × their sliding
 * rate that month (set by ALL their hours that month) in ₪; income = their
 * BILLABLE hours for the client × the client's rate. A heads-up from 75%
 * (under a quarter is left for the studio), "do now" from 100% (each hour
 * loses money). Quiet under 5 hours, and where the client has no rate.
 */
export function freelancerMargin(studio: StudioData, money_: MoneyData, freelancers: CrossFreelancer[]): Finding[] {
  if (!freelancers.length) return [];
  const month = lastMonthOf(studio.today);
  const byId = new Map(freelancers.map((f) => [f.profileId, f]));
  const taskOf = new Map(studio.tasks.map((t) => [t.id, t]));
  type Sum = { hours: number; billable: number; cost: number; who: Set<string> };
  const byClient = new Map<string, Sum>();
  for (const e of studio.entries) {
    const f = e.userId ? byId.get(e.userId) : undefined;
    if (!f || !e.date.startsWith(month.key)) continue;
    const t = taskOf.get(e.taskId);
    if (!t?.clientId) continue;
    const hours = e.minutes / 60;
    const s = byClient.get(t.clientId) ?? { hours: 0, billable: 0, cost: 0, who: new Set<string>() };
    s.hours += hours;
    if (t.billable && t.pending !== true) s.billable += hours;
    s.cost += hours * rateFor(f.monthHours, f.terms) * f.fx;
    s.who.add(f.name.split(" ")[0]);
    byClient.set(t.clientId, s);
  }
  const out: Finding[] = [];
  for (const c of liveClients(studio)) {
    const s = byClient.get(c.id);
    if (!s || s.hours < 5) continue;
    const rate = rateForClientOn(money_.rates, c.name, `${month.key}-15`);
    if (rate == null) continue;
    const income = s.billable * rate;
    if (income <= 0) continue;
    const share = s.cost / income;
    if (share < 0.75) continue;
    const loses = share >= 1;
    out.push({
      key: `freelancer-margin:${c.id}:${month.key}`,
      signal: "freelancer-margin",
      kind: loses ? "now" : "heads",
      area: "Freelance",
      clientId: c.id,
      severity: loses ? 3 : 2,
      facts: {
        client: c.name,
        month: month.name,
        hours: Number(s.hours.toFixed(2)),
        billableHours: Number(s.billable.toFixed(2)),
        sharePct: pct(share),
        costIls: Math.round(s.cost),
        incomeIls: Math.round(income),
      },
      figure: loses ? `${MINUS}${formatILSShort(s.cost - income)}` : `${formatILSShort(income - s.cost)} left`,
      title: `${c.name}: freelance hours cost ${pct(share)}% of what they brought in (${month.name})`,
      body:
        `${andList([...s.who])} logged ${h(s.hours)}h for them in ${month.name}: ${money(s.cost)} to the studio, ` +
        `${money(income)} billed (${h(s.billable)}h × ${formatILS(rate)}). ` +
        (loses ? "Each of those hours loses money — raise the rate, or keep this work in-house." : `That leaves ${money(income - s.cost)} for everything else.`),
      reminder: false,
      href: "/finance/freelance",
      action: "Open Freelance",
    });
  }
  return out;
}

/**
 * 3 · The pace of hours against open debt. Finance's "unpaid" card watches a
 * client's LAST period and goes quiet 45 days after its payment date. This one
 * is for what that leaves out: two or more ended periods past their payment
 * date, or one more than 45 days late — while 10h+ still went to the client in
 * the last 30 days. Only periods whose hours are all in hand (they start on or
 * after the oldest entry loaded) — whenever they ended.
 * One card per client, so a snooze holds until it gets worse. Where it fires,
 * run.ts drops that client's "unpaid" card (`oneDebtCard`): the last period is
 * already in this one's total.
 */
export function debtPace(studio: StudioData, money_: MoneyData): Finding[] {
  const today = studio.today;
  // The first day the loaded entries reach: a period starting before it has hours we can't see.
  const since = studio.entriesSince ?? studio.entries.reduce((min, e) => (e.date < min ? e.date : min), today);
  const out: Finding[] = [];
  for (const c of liveClients(studio)) {
    const terms = { days: c.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS, net: c.paymentTermsNet === true };
    const open = studio.periods
      .filter((p) => p.clientId === c.id && !p.paid && p.dateTo < today && p.dateFrom >= since)
      .map((p) => ({ ...p, late: daysBetween(parseISO(paymentDueFor(p.dateTo, terms)), parseISO(today)), hours: reportHours(studio, c.id, p.dateFrom, p.dateTo) }))
      .filter((p) => p.late >= 1 && p.hours > 0)
      .sort((a, b) => a.dateTo.localeCompare(b.dateTo));
    if (!open.length) continue;
    const worst = Math.max(...open.map((p) => p.late));
    if (open.length < 2 && worst <= 45) continue;
    const recent = reportHours(studio, c.id, shift(today, -29), today);
    if (recent < 10) continue;
    const rateNow = rateForClientOn(money_.rates, c.name, today);
    let debt = 0;
    let priced = true;
    for (const p of open) {
      const rate = rateForClientOn(money_.rates, c.name, p.dateTo);
      if (rate == null) priced = false;
      else debt += p.hours * rate;
    }
    if (!priced || rateNow == null) continue;
    const recentValue = recent * rateNow;
    const labels = andList(open.map((p) => p.label));
    out.push({
      key: `debt:${c.id}`,
      signal: "debt",
      kind: "now",
      area: "Clients",
      clientId: c.id,
      severity: open.length >= 3 || worst > 60 ? 3 : 2,
      facts: {
        client: c.name,
        periods: open.length,
        daysLate: worst,
        recentHours: Number(recent.toFixed(2)),
        debtIls: Math.round(debt),
        recentIls: Math.round(recentValue),
      },
      figure: formatILSShort(debt),
      title:
        open.length > 1
          ? `${c.name}: ${open.length} periods unpaid while the work goes on`
          : `${c.name}: ${open[0].label} is ${worst} days late and the work goes on`,
      body:
        `${labels} ${open.length > 1 ? "are" : "is"} past ${open.length > 1 ? "their" : "its"} payment date — ${money(debt)} before VAT. ` +
        `${h(recent)}h more went to them in the last 30 days (≈${money(recentValue)}). Agree a payment date before the next period starts.`,
      reminder: false,
      href: `/client-reports?client=${c.id}`,
      action: "Open their reports",
    });
  }
  return out;
}

/**
 * A client with a "debt" card doesn't also get the "unpaid" card: debt adds up
 * every period past its payment date, the last one included, so the two would
 * state the same money twice and count as two things to do.
 */
export function oneDebtCard(findings: Finding[]): Finding[] {
  const inDebt = new Set(findings.filter((f) => f.signal === "debt").map((f) => f.clientId));
  return findings.filter((f) => !(f.signal === "unpaid" && inDebt.has(f.clientId)));
}
