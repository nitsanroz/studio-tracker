// Instant tips (pure, no Claude): what the numbers of one scenario say on
// their own. Short, bottom line first, one finding each. English or Hebrew
// through `t` (i18n.ts).

import { formatILSShort } from "@/lib/finance/format";
import { ARRANGEMENTS_LAW } from "./facts-shared";
import { EN, monthIn, type T } from "./i18n";
import type { ScenarioResult } from "./engine";
import type { Baseline, CompanyFacts, Futures } from "./types";

export interface Tip {
  tone: "danger" | "warning" | "good";
  text: string;
}

const k = formatILSShort;
const h = (n: number) => `${Math.round(n)}h`;

export function tipsFor(b: Baseline, r: ScenarioResult, futures: Futures, facts: CompanyFacts, t: T = EN): Tip[] {
  const out: Tip[] = [];
  const bad = r.futures.bad;
  const mid = r.futures.mid;
  const good = r.futures.good;
  const month = (ym: string) => monthIn(t.lang, ym);

  if (r.breakEven == null) out.push({ tone: "danger", text: t("No break-even within capacity: even with every hour sold, costs aren't covered.") });
  else if (r.breakEven > futures.bad.hours)
    out.push({
      tone: r.breakEven > futures.mid.hours ? "danger" : "warning",
      text: t("Break-even is {be} a month — above the bad future ({bad}). A bad stretch loses money every month.", { be: h(r.breakEven), bad: h(futures.bad.hours) }),
    });
  else out.push({ tone: "good", text: t("Break-even {be} a month — under even the bad future ({bad}).", { be: h(r.breakEven), bad: h(futures.bad.hours) }) });

  if (bad.runway != null) out.push({ tone: "danger", text: t("In the bad future the company runs out of cash in {month}.", { month: month(bad.months[bad.runway].month) }) });
  else if (bad.underFloor > 0)
    out.push({
      tone: "warning",
      text: t("In the bad future cash falls under your floor ({floor}) for {n} months, lowest {low} in {month}.", {
        floor: k(r.cashFloor),
        n: bad.underFloor,
        low: k(bad.lowestCash.cash),
        month: month(bad.lowestCash.month),
      }),
    });

  const divMonth = mid.months.find((m) => m.dividendTax > 0);
  if (divMonth && divMonth.cash < r.cashFloor)
    out.push({
      tone: "warning",
      text: t("The dividend tax ({tax}) leaves cash at {cash} in {month} — under your floor. Split it in two steps?", { tax: k(divMonth.dividendTax), cash: k(divMonth.cash), month: month(divMonth.month) }),
    });

  if (b.keysShare > 0.08)
    out.push({
      tone: "warning",
      text: t("{pct}% of client work is written down to Keys — every point back is about {amount} a month.", { pct: Math.round(b.keysShare * 100), amount: k(b.soldHours * 0.01 * b.rate) }),
    });

  for (const m of b.team) {
    if (m.kind !== "designer" || m.hours < 40) continue;
    const share = m.billable / m.hours;
    if (share < 0.7)
      out.push({
        tone: "warning",
        text: t("{name} is {pct}% billable ({billable} of {hours}) — not enough work coming in. Hours already paid for: give them freelancers' work before buying more hours.", { name: m.name, pct: Math.round(share * 100), billable: h(m.billable), hours: h(m.hours) }),
      });
  }

  if (good.turnedAway > 0) out.push({ tone: "warning", text: t("The good future turns away {hours} of work over the year — line up freelancers before you need them.", { hours: h(good.turnedAway) }) });
  if (mid.idle > 12 * 20) out.push({ tone: "warning", text: t("In the middle future employees sit idle ~{hours} a month — paid capacity with no work.", { hours: h(mid.idle / 12) }) });

  if (r.fixedShare > 0.8) out.push({ tone: "warning", text: t("{pct}% of costs are fixed — little falls away if work drops.", { pct: Math.round(r.fixedShare * 100) }) });

  if (facts.takeHomeFloor != null) {
    if (bad.canPayYou < facts.takeHomeFloor)
      out.push({
        tone: "danger",
        text: t("In the bad future your salary plus the year's dividend comes to ~{amount} net a month — under your floor of {floor}.", { amount: k(bad.canPayYou), floor: k(facts.takeHomeFloor) }),
      });
    else
      out.push({ tone: "good", text: t("Even the bad future covers your floor (salary + dividend ~{amount} net a month vs {floor}).", { amount: k(bad.canPayYou), floor: k(facts.takeHomeFloor) }) });
  } else out.push({ tone: "warning", text: t("Set your take-home floor (Company facts) to check every future against it.") });

  if (mid.dividend.net > 0 && mid.dividend.toLoan >= mid.dividend.net)
    out.push({ tone: "warning", text: t("In the middle future the whole year's dividend ({amount} net) goes to closing the shareholder loan — none reaches you in cash.", { amount: k(mid.dividend.net) }) });
  else if (mid.dividend.limitedBy === "cash")
    out.push({ tone: "warning", text: t("The dividend is held back by cash, not profit: taking more would drop the bank under your floor ({floor}).", { floor: k(r.cashFloor) }) });

  if (good.retainedEnd > ARRANGEMENTS_LAW * 0.9)
    out.push({
      tone: "warning",
      text: t("Retained earnings reach {amount} in the good future — near the Arrangements Law's {law}. Plan dividends with the accountant.", { amount: k(good.retainedEnd), law: k(ARRANGEMENTS_LAW) }),
    });

  if (facts.cashAsOf < `${b.start}-01` && monthsSince(facts.cashAsOf, b.start) > 2)
    out.push({ tone: "warning", text: t("Cash today is the figure from {date}. Update it with the bank balance — the cash track starts from it.", { date: facts.cashAsOf }) });
  return out;
}

const monthsSince = (iso: string, ym: string) => (Number(ym.slice(0, 4)) - Number(iso.slice(0, 4))) * 12 + Number(ym.slice(5, 7)) - Number(iso.slice(5, 7));
