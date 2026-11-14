// Tax-aware advice (v1.33.0, Nitsan 2026-11-12: "advice comments and tips
// should take the tax aspects and the annual reports into account").
// Three rules, pure like the rest of signals.ts: the company's tax to set
// aside, the dividend / loan date, and the gap between our books and the
// accountant's — tax follows HIS books. Constants come from the scenarios'
// company facts (the accountant's 2025 report and the Nov 2026 call), so
// they stay one set of numbers. ⚠️ Titles never hold an amount; bodies may.

import { LINE } from "@/lib/finance/finance";
import { formatILS, formatILSShort, formatPct } from "@/lib/finance/format";
import { projectYear } from "@/lib/finance/overview";
import { ARRANGEMENTS_LAW } from "@/lib/finance/scenarios/facts-shared";
import type { AdviceData, Finding } from "./signals";

const MINUS = "−";
const money = (n: number) => (Math.abs(n) >= 10_000 ? formatILSShort(n) : formatILS(Math.round(n))).replace("-", MINUS);
const noon = (iso: string) => new Date(`${iso}T12:00:00`);

/** A year's profit as our P&L books it (the Profit line, summed). */
function ourYear(data: AdviceData, year: number): { revenue: number; profit: number; months: number } | null {
  const rows = data.pnl.filter((r) => r.year === year);
  const months = new Set(rows.filter((r) => r.lineItem === LINE.totalRevenues && r.value > 0).map((r) => r.month)).size;
  if (months < 12) return null;
  const sum = (line: string) => rows.filter((r) => r.lineItem === line).reduce((s, r) => s + r.value, 0);
  return { revenue: sum(LINE.totalRevenues), profit: sum(LINE.profit), months };
}

/** The year's estimated profit will owe company tax — set that share aside. */
export function taxReserve(data: AdviceData): Finding[] {
  const [y, m] = data.today.split("-").map(Number);
  if (m < 4) return []; // too early in the year for an estimate worth acting on
  const proj = projectYear(data.pnl, y, noon(data.today));
  const DEFAULT_FACTS = data.figures?.facts;
  if (!DEFAULT_FACTS || !proj || proj.profit <= 0) return [];
  const tax = proj.profit * DEFAULT_FACTS.corporateTax;
  return [
    {
      key: `tax-reserve:${y}`,
      signal: "tax-reserve",
      kind: "heads",
      area: "Tax",
      clientId: null,
      severity: 1,
      facts: { year: y, profitEstimateIls: Math.round(proj.profit), taxIls: Math.round(tax), rate: formatPct(DEFAULT_FACTS.corporateTax, 0) },
      figure: money(tax),
      title: `${y} is on course to owe company tax`,
      body:
        `The estimate for ${y} is ${money(proj.profit)} profit before tax; company tax at ${formatPct(DEFAULT_FACTS.corporateTax, 0)} is about ${money(tax)}. ` +
        `Whatever is then paid out as a dividend is taxed again at ${formatPct(DEFAULT_FACTS.dividendTax, 0)}, so keep the tax in the bank rather than in what you take.`,
      reminder: false,
      href: "/finance/scenarios",
      action: "Open Scenarios",
    },
  ];
}

/**
 * A dividend declared on last year's profits is due by 19 January; the owner's
 * loan to settle runs up 6% a year, which the company can't deduct. Shown from
 * 1 December to the date itself, and a reminder you can tick off.
 */
export function dividendWindow(data: AdviceData): Finding[] {
  const [y, m, d] = data.today.split("-").map(Number);
  const dueYear = m === 12 ? y + 1 : y;
  const inWindow = m === 12 || (m === 1 && d <= 19);
  const DEFAULT_FACTS = data.figures?.facts;
  if (!DEFAULT_FACTS || !inWindow) return [];
  const loanInterest = DEFAULT_FACTS.loan * DEFAULT_FACTS.loanInterest;
  return [
    {
      key: `dividend-window:${dueYear}`,
      signal: "dividend-window",
      kind: "heads",
      area: "Tax",
      clientId: null,
      severity: 2,
      facts: { dueYear, loanIls: DEFAULT_FACTS.loan, loanInterestIls: Math.round(loanInterest), retainedIls: DEFAULT_FACTS.retained },
      figure: "19 Jan",
      title: `A dividend on ${dueYear - 1}'s profits is due by 19 January`,
      body:
        `Retained earnings stood at ${money(DEFAULT_FACTS.retained)} at the end of ${dueYear - 1} (the Arrangements Law forces a distribution above ${money(ARRANGEMENTS_LAW)}). ` +
        `Your loan to settle was ${money(DEFAULT_FACTS.loan)}, growing about ${money(loanInterest)} a year at ${formatPct(DEFAULT_FACTS.loanInterest, 0)} — interest the company can't deduct. ` +
        `A dividend is taxed at ${formatPct(DEFAULT_FACTS.dividendTax, 0)}; salary is cheaper up to roughly ${money(DEFAULT_FACTS.bracketTop)} a month. Settle the split with the accountant before the date.`,
      reminder: true,
      href: "/finance/scenarios",
      action: "Open Scenarios",
    },
  ];
}

/**
 * The accountant books revenue by invoice, we by the month of the work, so a
 * year can differ a lot while tax follows his figure. Last year's gap, and
 * what to do about it at year end.
 */
export function booksGap(data: AdviceData): Finding[] {
  const [y] = data.today.split("-").map(Number);
  const acc = data.figures?.accountantYears.find((a) => a.year === y - 1);
  const ours = acc ? ourYear(data, y - 1) : null;
  if (!acc || !ours) return [];
  const gap = ours.profit - acc.pretaxProfit;
  if (Math.abs(gap) < 100_000) return [];
  const higher = gap > 0;
  return [
    {
      key: `books-gap:${y - 1}`,
      signal: "books-gap",
      kind: "heads",
      area: "Tax",
      clientId: null,
      severity: 1,
      facts: { year: y - 1, ourProfitIls: Math.round(ours.profit), accountantProfitIls: acc.pretaxProfit, gapIls: Math.round(gap) },
      figure: `${higher ? "+" : MINUS}${money(Math.abs(gap))}`,
      title: `${y - 1} profit differs between our books and the accountant's`,
      body:
        `Ours shows ${money(ours.profit)}; his statement shows ${money(acc.pretaxProfit)} before tax — ${money(Math.abs(gap))} ${higher ? "less" : "more"}. ` +
        `He books revenue when it is invoiced and writes equipment off over years; we book the month the work was done. Tax follows his figure, so plan the year-end around it: ` +
        `work finished in December but invoiced in January lands in the next tax year.`,
      reminder: false,
      href: "/finance",
      action: "Compare on the Overview",
    },
  ];
}
