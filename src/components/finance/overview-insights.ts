// The Overview's insight cards — plain-words findings about the business for
// the selected period. Every one is computed from the booked figures (the
// same rows the key-figure tiles read); a finding with nothing to say for the
// period is simply left out.

import { LINE, annualize, summarizeRows, type PnlMonthly } from "@/lib/finance/finance";
import { formatILS, formatPct } from "@/lib/finance/format";
import { MONTH_NAMES, NOUNS, iso, profitWhy, reason, toMap } from "./explain-card";
import { clientTotals, expenseItems, lineSum, revenueItems, type KpiContext } from "./overview-explain";

export interface Insight {
  id: string;
  /** Short topic chip: Revenue, Profit, Clients… */
  tag: string;
  tone: "good" | "bad" | "neutral";
  title: string;
  body: string;
}

const pct = (n: number) => formatPct(n, 0);
const short = (n: number): string => {
  if (n < 0) return `−${short(-n)}`;
  return n >= 1_000_000 ? `₪${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `₪${Math.round(n / 1000)}k` : formatILS(Math.round(n));
};
const rowsOf = (pnl: PnlMonthly[], year: number) => pnl.filter((r) => r.year === year);

interface YearFig {
  year: number;
  rows: PnlMonthly[];
  revenue: number;
  profit: number;
  margin: number;
  salariesShare: number;
  freelanceShare: number;
  rate: number;
  hours: number;
  /** Months with booked revenue — 12 for a full year. */
  months: number;
}

function yearFigs(ctx: KpiContext): YearFig[] {
  return ctx.years.map((year) => {
    const rows = rowsOf(ctx.pnl, year);
    const revenue = lineSum(rows, LINE.totalRevenues);
    const profit = lineSum(rows, LINE.profit);
    return {
      year,
      rows,
      revenue,
      profit,
      margin: revenue ? profit / revenue : 0,
      salariesShare: revenue ? lineSum(rows, LINE.salaries) / revenue : 0,
      freelanceShare: revenue ? lineSum(rows, LINE.freelance) / revenue : 0,
      rate: summarizeRows(rows).avgRate,
      hours: lineSum(rows, LINE.totalHours),
      months: new Set(rows.filter((r) => r.lineItem === LINE.totalRevenues).map((r) => r.month)).size,
    };
  });
}

// ── All time ─────────────────────────────────────────────────────────────────

function allTimeInsights(ctx: KpiContext): Insight[] {
  const out: Insight[] = [];
  const thisYear = new Date().getFullYear();
  // Full years only for comparisons (the first, partial year and this one aside).
  const full = yearFigs(ctx).filter((f) => f.year !== thisYear && f.months >= 12);
  if (full.length < 3) return out;

  // Revenue: recent three years against the three before.
  const last3 = full.slice(-3);
  const prev3 = full.slice(-6, -3);
  const avg = (fs: YearFig[]) => fs.reduce((s, f) => s + f.revenue, 0) / fs.length;
  const peak = [...full].sort((a, b) => b.revenue - a.revenue)[0];
  if (prev3.length === 3) {
    const g = avg(last3) / avg(prev3) - 1;
    out.push({
      id: "rev-trend",
      tag: "Revenue",
      tone: g > 0.1 ? "good" : g < -0.05 ? "bad" : "neutral",
      title: Math.abs(g) < 0.1 ? "Revenue has plateaued" : g > 0 ? "Revenue keeps growing" : "Revenue is shrinking",
      body: `The last three full years averaged ${short(avg(last3))} a year, ${g >= 0 ? "up" : "down"} ${pct(Math.abs(g))} on the three before. The peak so far is ${peak.year} at ${short(peak.revenue)}.`,
    });
  }

  // Profit: best and worst years.
  const best = [...full].sort((a, b) => b.profit - a.profit)[0];
  const worst = [...full].sort((a, b) => a.profit - b.profit)[0];
  const losses = full.filter((f) => f.profit < 0);
  out.push({
    id: "profit-range",
    tag: "Profit",
    tone: losses.length ? "bad" : "good",
    title: `${best.year} was the best year`,
    body:
      `${short(best.profit)} profit at a ${pct(best.margin)} margin. ` +
      (losses.length
        ? `The weakest, ${worst.year}, lost ${short(-worst.profit)} — the only ${losses.length === 1 ? "year" : `${losses.length} years`} in the red.`
        : `Even the weakest, ${worst.year}, kept a ${pct(worst.margin)} margin.`),
  });

  // The accountant's statements: two years together are the fair comparison
  // (he books by invoice, we by the month of the work), and tax follows his.
  const pair = ctx.accountantYears.slice(-2);
  const ourPair = pair.map((a) => full.find((f) => f.year === a.year));
  if (pair.length === 2 && pair[1].year === pair[0].year + 1 && ourPair.every(Boolean)) {
    const ours = ourPair.reduce((s, f) => s + f!.profit, 0);
    const his = pair.reduce((s, a) => s + a.pretaxProfit, 0);
    const lastAcc = pair[1];
    const taxPaid = pair.reduce((s, a) => s + (a.pretaxProfit - a.netProfit), 0);
    out.push({
      id: "accountant",
      tag: "Tax",
      tone: "neutral",
      title: `${pair[0].year}–${pair[1].year} together: our profit against the accountant's`,
      body:
        `Together we book ${short(ours)} and he ${short(his)} before tax, so most of a single year's gap is timing between the two ways of booking. ` +
        `On his books ${lastAcc.year} closed at ${short(lastAcc.pretaxProfit)} before tax and ${short(lastAcc.retained)} retained; income tax across the two years was ${short(taxPaid)}. ` +
        `Switch "+ Accountant" on the chart to see them side by side.`,
    });
  }

  // Payroll share — the swing factor between good and bad years.
  const salLo = [...full].sort((a, b) => a.salariesShare - b.salariesShare)[0];
  const salHi = [...full].sort((a, b) => b.salariesShare - a.salariesShare)[0];
  if (salHi.salariesShare - salLo.salariesShare > 0.15) {
    out.push({
      id: "payroll",
      tag: "Costs",
      tone: "bad",
      title: "Payroll decides the margin",
      body: `Salaries took ${pct(salLo.salariesShare)} of revenue in ${salLo.year} and ${pct(salHi.salariesShare)} in ${salHi.year}, when the margin was ${pct(salHi.margin)}. Every extra 10% of revenue that goes to payroll comes straight out of the margin.`,
    });
  }

  // Rate: how far it moved, and how long since it last moved.
  const firstRate = full[0];
  const lastRate = full[full.length - 1];
  let flat = 1;
  for (let i = full.length - 2; i >= 0 && Math.abs(full[i].rate - lastRate.rate) < 5; i--) flat++;
  const flatFrom = full[full.length - flat];
  const payGrowth = flatFrom.salariesShare && flatFrom.revenue ? (lastRate.salariesShare * lastRate.revenue) / (flatFrom.salariesShare * flatFrom.revenue) - 1 : 0;
  out.push({
    id: "rate",
    tag: "Rate",
    tone: flat >= 3 ? "bad" : "good",
    title: flat >= 3 ? `The rate has stood at ₪${Math.round(lastRate.rate)} for ${flat} years` : "The rate keeps rising",
    body:
      `Average rate went from ₪${Math.round(firstRate.rate)} in ${firstRate.year} to ₪${Math.round(lastRate.rate)} in ${lastRate.year}` +
      (flat >= 3
        ? payGrowth > 0.03
          ? ` — while payroll grew ${pct(payGrowth)} over the same years, so a flat rate squeezes the margin.`
          : `. A raise is the cheapest lever: hours stay the same, revenue goes up.`
        : "."),
  });

  // Clients: how many, how concentrated, who stayed.
  const counts = full.map((f) => ({ year: f.year, n: clientTotals(ctx, f.rows).size }));
  const peakClients = [...counts].sort((a, b) => b.n - a.n)[0];
  const lastClients = counts[counts.length - 1];
  const lastTotals = [...clientTotals(ctx, lastRate.rows)].sort((a, b) => b[1].revenue - a[1].revenue);
  const lastRev = lastTotals.reduce((s, [, v]) => s + v.revenue, 0);
  if (lastTotals.length) {
    const top = lastTotals[0];
    out.push({
      id: "clients",
      tag: "Clients",
      tone: top[1].revenue / lastRev > 0.3 ? "bad" : "neutral",
      title: lastClients.n < peakClients.n * 0.7 ? "Fewer, bigger clients" : "A broad client base",
      body: `${lastClients.n} clients billed in ${lastClients.year} (the peak was ${peakClients.n} in ${peakClients.year}). ${iso(top[0])} alone brought ${pct(top[1].revenue / lastRev)} of that year's hours income.`,
    });
  }
  const yearsActive = new Map<string, number>();
  for (const f of full) for (const name of clientTotals(ctx, f.rows).keys()) yearsActive.set(name, (yearsActive.get(name) ?? 0) + 1);
  const loyal = [...yearsActive].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]);
  if (loyal.length) {
    out.push({
      id: "loyal",
      tag: "Clients",
      tone: "good",
      title: `${loyal.length} clients have stayed 5+ years`,
      body: `${loyal.slice(0, 5).map(([n, k]) => `${iso(n)} (${k})`).join(", ")}${loyal.length > 5 ? " and more" : ""} — the long-term core worth protecting.`,
    });
  }

  // Seasonality: strongest and weakest quarter on average.
  const q = [0, 0, 0, 0];
  for (const f of full) for (const r of f.rows) if (r.lineItem === LINE.totalRevenues) q[Math.floor((r.month - 1) / 3)] += r.value / full.length;
  const qs = q.map((v, i) => ({ q: i + 1, v })).sort((a, b) => b.v - a.v);
  if (qs[0].v > qs[3].v * 1.1) {
    out.push({
      id: "season",
      tag: "Seasons",
      tone: "neutral",
      title: `Q${qs[0].q} is the strongest quarter`,
      body: `On average Q${qs[0].q} brings ${short(qs[0].v)}, against ${short(qs[3].v)} in Q${qs[3].q} — ${pct(qs[0].v / qs[3].v - 1)} more. Plan cash and hiring around the quiet quarter.`,
    });
  }

  // Freelance reliance.
  const frHi = [...full].sort((a, b) => b.freelanceShare - a.freelanceShare)[0];
  out.push({
    id: "freelance",
    tag: "Team",
    tone: "neutral",
    title: lastRate.freelanceShare > 0.12 ? "Freelancers carry a big share again" : "Mostly an in-house team",
    body: `Freelance cost was ${pct(lastRate.freelanceShare)} of revenue in ${lastRate.year}; its high point was ${pct(frHi.freelanceShare)} in ${frHi.year}.`,
  });
  return out;
}

// ── One year ─────────────────────────────────────────────────────────────────

function yearInsights(ctx: KpiContext): Insight[] {
  const out: Insight[] = [];
  const y = ctx.selYear!;
  const cur = ctx.curRows;
  const prior = ctx.priorRows.length && ctx.priorLabel ? ctx.priorRows : null;
  const vs = ctx.priorLabel ?? "";
  const rev = lineSum(cur, LINE.totalRevenues);
  const exp = lineSum(cur, LINE.totalExpenses);
  const profit = lineSum(cur, LINE.profit);
  if (!rev) return out;

  if (prior) {
    const pRev = lineSum(prior, LINE.totalRevenues);
    const pExp = lineSum(prior, LINE.totalExpenses);
    const g = pRev ? rev / pRev - 1 : 0;
    const why = reason(toMap(revenueItems(ctx, cur)), toMap(revenueItems(ctx, prior)), NOUNS.client);
    out.push({
      id: "rev",
      tag: "Revenue",
      tone: g > 0.03 ? "good" : g < -0.03 ? "bad" : "neutral",
      title: `Revenue ${g >= 0 ? "up" : "down"} ${pct(Math.abs(g))} on ${vs}`,
      body: `${short(rev)} against ${short(pRev)}.${why ? ` Mainly because ${why}.` : ""}`,
    });
    const pw = profitWhy({
      rev: { cur: rev, prev: pRev, parts: [toMap(revenueItems(ctx, cur)), toMap(revenueItems(ctx, prior))] },
      exp: { cur: exp, prev: pExp, parts: [toMap(expenseItems(cur)), toMap(expenseItems(prior))] },
      label: vs,
    });
    const pProfit = lineSum(prior, LINE.profit);
    out.push({
      id: "profit",
      tag: "Profit",
      tone: profit >= pProfit ? "good" : "bad",
      title: profit < 0 ? `A loss of ${short(-profit)}` : `${short(profit)} profit, ${pct(profit / rev)} margin`,
      body: `${vs}: ${short(pProfit)}.${pw ? ` ${pw}` : ""}`,
    });

    // Clients won and lost.
    const now = clientTotals(ctx, cur);
    const then = clientTotals(ctx, prior);
    const won = [...now].filter(([n]) => !then.has(n)).sort((a, b) => b[1].revenue - a[1].revenue);
    const lost = [...then].filter(([n]) => !now.has(n)).sort((a, b) => b[1].revenue - a[1].revenue);
    if (won.length || lost.length) {
      out.push({
        id: "churn",
        tag: "Clients",
        tone: won.length >= lost.length ? "good" : "bad",
        title: `${won.length} new client${won.length === 1 ? "" : "s"}, ${lost.length} gone`,
        body:
          (won.length ? `New: ${won.slice(0, 3).map(([n, v]) => `${iso(n)} (${short(v.revenue)})`).join(", ")}. ` : "") +
          (lost.length ? `Not back since ${vs}: ${lost.slice(0, 3).map(([n, v]) => `${iso(n)} (${short(v.revenue)} then)`).join(", ")}.` : ""),
      });
    }

    // Rate.
    const r = summarizeRows(cur).avgRate;
    const pr = summarizeRows(prior).avgRate;
    if (r && pr) {
      const d = r / pr - 1;
      out.push({
        id: "rate",
        tag: "Rate",
        tone: d > 0.02 ? "good" : d < -0.02 ? "bad" : "neutral",
        title: Math.abs(d) < 0.02 ? `The rate held at ₪${Math.round(r)}` : `Average rate ${d > 0 ? "up" : "down"} to ₪${Math.round(r)}`,
        body: `₪${Math.round(pr)} in ${vs}. Each ₪10 on the average rate is worth about ${short(lineSum(cur, LINE.totalHours) * 10)} over these hours.`,
      });
    }

    // The cost line that moved most.
    const cNow = toMap(expenseItems(cur));
    const cThen = toMap(expenseItems(prior));
    const moves = [...new Set([...cNow.keys(), ...cThen.keys()])]
      .map((k) => ({ k, d: (cNow.get(k) ?? 0) - (cThen.get(k) ?? 0) }))
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    if (moves[0] && Math.abs(moves[0].d) > exp * 0.02) {
      out.push({
        id: "cost-move",
        tag: "Costs",
        tone: moves[0].d > 0 ? "bad" : "good",
        title: `${moves[0].k} ${moves[0].d > 0 ? "grew" : "fell"} the most`,
        body: `${moves[0].d > 0 ? "+" : "−"}${short(Math.abs(moves[0].d))} against ${vs} — the biggest move among the cost lines.`,
      });
    }
  }

  // Payroll share, against the business's long-run norm.
  const sal = lineSum(cur, LINE.salaries);
  const shares = yearFigs(ctx).filter((f) => f.year !== y && f.revenue).map((f) => f.salariesShare);
  const norm = shares.length ? shares.reduce((s, v) => s + v, 0) / shares.length : 0;
  out.push({
    id: "payroll",
    tag: "Costs",
    tone: sal / rev > norm + 0.05 ? "bad" : "good",
    title: `Salaries are ${pct(sal / rev)} of revenue`,
    body: norm ? `The business's usual level is about ${pct(norm)}. ${sal / rev > norm + 0.05 ? "Above it, profit gets thin fast." : "At or below it, the margin has room."}` : "",
  });

  // Concentration.
  const totals = [...clientTotals(ctx, cur)].sort((a, b) => b[1].revenue - a[1].revenue);
  const hi = totals.reduce((s, [, v]) => s + v.revenue, 0);
  if (totals.length && hi) {
    const top1 = totals[0][1].revenue / hi;
    const top3 = totals.slice(0, 3).reduce((s, [, v]) => s + v.revenue, 0) / hi;
    out.push({
      id: "concentration",
      tag: "Clients",
      tone: top1 > 0.35 ? "bad" : "neutral",
      title: top1 > 0.35 ? `${iso(totals[0][0])} is a big dependency` : `${iso(totals[0][0])} leads, but not alone`,
      body: `${pct(top1)} of hours income from one client, ${pct(top3)} from the top three (${totals.length} clients in all).`,
    });
  }

  // Best and worst month.
  const byMonth = new Map<number, number>();
  for (const r of cur) if (r.lineItem === LINE.profit) byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.value);
  const ms = [...byMonth].sort((a, b) => b[1] - a[1]);
  if (ms.length >= 3) {
    const losing = ms.filter(([, v]) => v < 0).length;
    out.push({
      id: "months",
      tag: "Months",
      tone: losing > ms.length / 3 ? "bad" : "neutral",
      title: `${MONTH_NAMES[ms[0][0] - 1]} was the best month`,
      body: `${short(ms[0][1])} profit; the weakest was ${MONTH_NAMES[ms[ms.length - 1][0] - 1]} at ${short(ms[ms.length - 1][1])}. ${losing ? `${losing} of ${ms.length} months ran at a loss.` : "No month ran at a loss."}`,
    });
  }

  // Break-even: months worked below the hours needed to cover costs.
  const minBE = new Map<number, number>();
  const worked = new Map<number, number>();
  for (const r of cur) {
    if (r.lineItem === LINE.minHoursBE) minBE.set(r.month, r.value);
    if (r.lineItem === LINE.totalHours) worked.set(r.month, r.value);
  }
  const below = [...minBE].filter(([m, need]) => need > 0 && (worked.get(m) ?? 0) < need).sort((a, b) => a[0] - b[0]);
  if (minBE.size) {
    out.push({
      id: "break-even",
      tag: "Hours",
      tone: below.length > minBE.size / 2 ? "bad" : "good",
      title: below.length ? `${below.length} month${below.length === 1 ? "" : "s"} below break-even hours` : "Every month cleared break-even",
      body: below.length
        ? `${below.map(([m]) => MONTH_NAMES[m - 1].slice(0, 3)).join(", ")} logged fewer hours than it took to cover that month's costs.`
        : "Hours logged covered costs in every month of the period.",
    });
  }

  // Run-rate for a year in progress.
  if (ctx.partial) {
    const months = new Set(cur.filter((r) => r.lineItem === LINE.totalRevenues).map((r) => r.month)).size;
    if (months) {
      const fullYears = yearFigs(ctx).filter((f) => f.year < y && f.months >= 12);
      const last = fullYears[fullYears.length - 1];
      out.push({
        id: "run-rate",
        tag: "Outlook",
        tone: last && annualize(rev, months) >= last.revenue ? "good" : "neutral",
        title: `On pace for ${short(annualize(rev, months))} this year`,
        body: `${months} months in, at the same pace the year ends near ${short(annualize(rev, months))} revenue and ${short(annualize(profit, months))} profit${last ? ` (${last.year}: ${short(last.revenue)} / ${short(last.profit)})` : ""}.`,
      });
    }
  }
  return out;
}

export function buildInsights(ctx: KpiContext): Insight[] {
  return (ctx.selYear == null ? allTimeInsights(ctx) : yearInsights(ctx)).filter((i) => i.body);
}
