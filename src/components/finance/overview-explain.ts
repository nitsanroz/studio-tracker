// Hover cards for the Overview's key figures — the same card as the Plan grid
// (explain-card.tsx), fed from the P&L lines and the per-client months for the
// selected period, and compared with the period the tile itself compares to.

import type { AccountantYear } from "@/lib/finance/accountant";
import { LINE, NON_BILLABLE_CLIENT_CANON, summarizeRows, type ClientMonthly, type PnlMonthly } from "@/lib/finance/finance";
import { formatHours, formatILS, formatPct, formatShortYear } from "@/lib/finance/format";
import { MONTH_SHORT, NOUNS, breakdownCard, iso, profitWhy, toMap, trend, type Explanation, type Say, type Trend } from "./explain-card";

export interface KpiContext {
  /** The accountant’s yearly figures (useCompanyFigures) — empty when the viewer isn’t given them. */
  accountantYears: AccountantYear[];
  pnl: PnlMonthly[];
  clientMonthly: ClientMonthly[];
  /** The P&L rows of the selected period, and of the period it's compared to. */
  curRows: PnlMonthly[];
  priorRows: PnlMonthly[];
  priorLabel: string | null;
  /** null = all time (the mini chart then shows years). */
  selYear: number | null;
  years: number[];
  partial: boolean;
}

export const kpiKey = (label: string) => `kpi|${label}`;

export const lineSum = (rows: PnlMonthly[], line: string) => rows.reduce((s, r) => (r.lineItem === line ? s + r.value : s), 0);

/** Revenue and hours per client over exactly the months in `rows`. */
export function clientTotals(ctx: KpiContext, rows: PnlMonthly[]) {
  const months = new Set(rows.map((r) => `${r.year}-${r.month}`));
  const acc = new Map<string, { revenue: number; hours: number }>();
  for (const c of ctx.clientMonthly) {
    if (c.clientCanon === NON_BILLABLE_CLIENT_CANON || !months.has(`${c.year}-${c.month}`)) continue;
    const cur = acc.get(c.clientCanon) ?? { revenue: 0, hours: 0 };
    cur.revenue += c.revenueGross;
    cur.hours += c.hours;
    acc.set(c.clientCanon, cur);
  }
  return acc;
}

export function revenueItems(ctx: KpiContext, rows: PnlMonthly[]) {
  const items = [...clientTotals(ctx, rows)].map(([label, v]) => ({ label, n: v.revenue }));
  // Whatever the clients don't explain (one-off projects, or client months
  // the P&L doesn't count yet) — kept, so the parts always add up to the total.
  const rest = lineSum(rows, LINE.totalRevenues) - items.reduce((s, i) => s + i.n, 0);
  if (Math.abs(rest) > 1) items.push({ label: rest > 0 ? "Projects & other" : "Not in the P&L yet", n: rest });
  return items;
}

/** Expense parts that exist in every year — older years only have the
 * combined "other" bucket, so everything else is counted together. */
export function expenseItems(rows: PnlMonthly[]) {
  const parts = [
    { label: "Salaries", n: lineSum(rows, LINE.salaries) },
    { label: "Freelance", n: lineSum(rows, LINE.freelance) },
    { label: "Rent", n: lineSum(rows, LINE.rentExpenses) },
    { label: "Investments", n: lineSum(rows, LINE.investments) },
  ];
  const other = lineSum(rows, LINE.totalExpenses) - parts.reduce((s, p) => s + p.n, 0);
  if (Math.abs(other) > 1) parts.push({ label: "Other overhead", n: other });
  return parts.filter((p) => p.n);
}

/** One value per month of the selected year, or per year for all time. */
function series(ctx: KpiContext, f: (rows: PnlMonthly[]) => number): Explanation["series"] {
  if (ctx.selYear != null) {
    const y = ctx.selYear;
    return { values: MONTH_SHORT.map((_, i) => f(ctx.pnl.filter((r) => r.year === y && r.month === i + 1))), current: null };
  }
  return {
    values: ctx.years.map((y) => f(ctx.pnl.filter((r) => r.year === y))),
    current: null,
    labels: ctx.years.map(formatShortYear),
  };
}

/** A share's move in percentage points ("▲ 3 pts vs 2025"). */
function ptsTrend(cur: number, prev: number, label: string, upIsGood: boolean): Trend | null {
  const pts = Math.round((cur - prev) * 100);
  if (!pts) return null;
  return { text: `${Math.abs(pts)} pts vs ${label}`, dir: pts > 0 ? "up" : "down", good: (pts > 0) === upIsGood };
}

export function explainKpi(key: string, ctx: KpiContext): Explanation | null {
  const [kind, label] = key.split("|");
  if (kind !== "kpi") return null;
  const cur = ctx.curRows;
  const prior = ctx.priorRows.length && ctx.priorLabel ? ctx.priorRows : null;
  const vs = ctx.priorLabel ?? "";
  const period = ctx.selYear == null ? "all time" : `${ctx.selYear}${ctx.partial ? " so far" : ""}`;
  const title = `${label} · ${period}`;
  const rev = lineSum(cur, LINE.totalRevenues);
  const exp = lineSum(cur, LINE.totalExpenses);
  const profit = lineSum(cur, LINE.profit);
  const hours = lineSum(cur, LINE.totalHours);
  const pRev = prior ? lineSum(prior, LINE.totalRevenues) : 0;
  const pExp = prior ? lineSum(prior, LINE.totalExpenses) : 0;

  switch (label) {
    case "Revenue": {
      const curClients = clientTotals(ctx, cur);
      const priorClients = prior ? clientTotals(ctx, prior) : new Map();
      // Revenue that moved without the hours moving the same way came from the rate.
      const rateOrHours: Say = (dr, move) => {
        if (move !== "up" && move !== "down") return null;
        const dh = (curClients.get(dr.label)?.hours ?? 0) - (priorClients.get(dr.label)?.hours ?? 0);
        return Math.sign(dh) === Math.sign(dr.delta) ? null : `${iso(dr.label)}'s rate ${move === "up" ? "went up" : "went down"}`;
      };
      return breakdownCard({
        title,
        value: rev,
        formula: `Client hours ${formatILS(rev - lineSum(cur, LINE.projectIncome))} + one-off projects ${formatILS(lineSum(cur, LINE.projectIncome))}`,
        items: revenueItems(ctx, cur),
        prev: prior ? { items: revenueItems(ctx, prior), label: vs } : undefined,
        noun: NOUNS.client,
        say: rateOrHours,
        upIsGood: true,
        series: series(ctx, (rows) => lineSum(rows, LINE.totalRevenues)),
        max: 5,
      });
    }
    case "Expenses":
      return breakdownCard({
        title,
        value: exp,
        formula: "Every expense line, all without VAT",
        items: expenseItems(cur),
        prev: prior ? { items: expenseItems(prior), label: vs } : undefined,
        noun: NOUNS.line,
        upIsGood: false,
        series: series(ctx, (rows) => lineSum(rows, LINE.totalExpenses)),
        notes: [rev ? `${formatPct(exp / rev, 0)} of revenue` : null],
      });
    case "Profit":
      return {
        title,
        value: formatILS(profit),
        formula: `Revenue ${formatILS(rev)} − expenses ${formatILS(exp)}`,
        trends: prior ? [trend(profit, lineSum(prior, LINE.profit), formatILS, vs, true)].filter((t): t is Trend => t != null) : [],
        why: prior
          ? profitWhy({
              rev: { cur: rev, prev: pRev, parts: [toMap(revenueItems(ctx, cur)), toMap(revenueItems(ctx, prior))] },
              exp: { cur: exp, prev: pExp, parts: [toMap(expenseItems(cur)), toMap(expenseItems(prior))] },
              label: vs,
            })
          : undefined,
        notes: [rev ? `Margin ${formatPct(profit / rev, 1)}` : ""].filter(Boolean),
        series: series(ctx, (rows) => lineSum(rows, LINE.profit)),
        sources: [kpiKey("Revenue"), kpiKey("Expenses")],
      };
    case "Margin": {
      const m = rev ? profit / rev : 0;
      const pm = prior && pRev ? lineSum(prior, LINE.profit) / pRev : null;
      return {
        title,
        value: formatPct(m, 1),
        formula: `Profit ${formatILS(profit)} ÷ revenue ${formatILS(rev)}`,
        trends: pm != null ? [ptsTrend(m, pm, vs, true)].filter((t): t is Trend => t != null) : [],
        notes: [pm != null ? `${vs}: ${formatPct(pm, 1)}` : ""].filter(Boolean),
        series: series(ctx, (rows) => {
          const r = lineSum(rows, LINE.totalRevenues);
          return r ? lineSum(rows, LINE.profit) / r : 0;
        }),
        sources: [kpiKey("Profit"), kpiKey("Revenue")],
      };
    }
    case "Avg rate": {
      // All time divides all revenue (project fees too) by hours, as the tile
      // does (aggregateSummaries); a single year uses hourly income only.
      const allTime = ctx.selYear == null;
      // summarizeRows' rate, as the tile's: a year with no hours-income line
      // (2016) counts its revenue less project fees as hourly — this card read
      // the bare line and said ₪0.
      const rate = hours ? (allTime ? rev / hours : summarizeRows(cur).avgRate) : 0;
      const pHours = prior ? lineSum(prior, LINE.totalHours) : 0;
      const pRate = prior && pHours ? summarizeRows(prior).avgRate : undefined;
      // Each client's own effective rate, biggest by hours.
      const clients = [...clientTotals(ctx, cur)].filter(([, v]) => v.hours > 0).sort((a, b) => b[1].hours - a[1].hours);
      return {
        title,
        value: `₪${Math.round(rate)}`,
        formula: allTime
          ? `Revenue ${formatILS(rev)} (project fees included) ÷ ${formatHours(hours)} h`
          : `Hours income ${formatILS(rate * hours)} ÷ ${formatHours(hours)} h`,
        items: clients.slice(0, 6).map(([name, v]) => ({ label: name, value: `₪${Math.round(v.revenue / v.hours)}/h · ${formatHours(v.hours)} h`, n: v.hours })),
        more: Math.max(0, clients.length - 6),
        trends: [trend(rate, pRate, (n) => `₪${Math.round(n)}`, vs, true)].filter((t): t is Trend => t != null),
        notes: ["Bars: hours per client"],
        series: series(ctx, (rows) => summarizeRows(rows).avgRate),
        sources: [],
      };
    }
    case "Salaries % rev": {
      const sal = lineSum(cur, LINE.salaries);
      const share = rev ? sal / rev : 0;
      const pShare = prior && pRev ? lineSum(prior, LINE.salaries) / pRev : null;
      return {
        title,
        value: formatPct(share, 1),
        formula: `Salaries ${formatILS(sal)} ÷ revenue ${formatILS(rev)}`,
        trends: pShare != null ? [ptsTrend(share, pShare, vs, false)].filter((t): t is Trend => t != null) : [],
        notes: [pShare != null ? `${vs}: ${formatPct(pShare, 1)}` : ""].filter(Boolean),
        series: series(ctx, (rows) => {
          const r = lineSum(rows, LINE.totalRevenues);
          return r ? lineSum(rows, LINE.salaries) / r : 0;
        }),
        sources: [kpiKey("Revenue")],
      };
    }
  }
  return null;
}
