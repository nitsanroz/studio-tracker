"use client";

// Hover explanations for the Plan grid — "what is this number made of?".
// Every number cell carries a `data-cell` key; hovering one shows a small card
// with the formula (with the real figures), its biggest ingredients, a
// 12-month mini chart and trend chips, and outlines the cells it's built from —
// like Excel's formula view. Highlighting is done straight on the DOM (a class
// toggled on the source cells) so hovering never re-renders the grid.

import {
  MONTH_NAMES,
  NOUNS,
  dirText,
  drivers,
  iso,
  moveOf,
  reason,
  sumOf,
  toMap,
  top,
  trend,
  useExplainHover,
  profitWhy,
  why,
  type Explanation,
  type Noun,
  type Say,
} from "./explain-card";
import { mapExpense, type ExpenseRowDb, type FreelanceRowDb, type SalaryRowDb } from "@/lib/finance/db";
import {
  LINE,
  MONTH_SHORT,
  NON_BILLABLE_CLIENT_CANON,
  rollupCurrentYear,
  stepOf,
  type ClientRate,
  type FinanceState,
  type PnlMonthly,
} from "@/lib/finance/finance";
import type { FxTable } from "@/lib/finance/fx";
import { EXPENSE_LINES, MONTHS, cellRevenue, computeMonthRollup, expenseLinesFor, monthRates, rateSummary, type ClientRow, type RatePart } from "@/lib/finance/plan-model";
import { formatHours, formatILS, formatPct, formatShortDay, studioDay } from "@/lib/finance/format";
import { DEFAULT_CLIENT_TERMS, invoiceDueFor, paymentDue, termsAdjective, type ClientTerms } from "@/lib/payment-terms";
import type { TermsByClient } from "@/lib/finance/receivables";
import { daysBetween } from "@/lib/finance/advice/tools";

// ── Cell keys ────────────────────────────────────────────────────────────────
// Month 1–12, or TOTAL_COL for a row's total column.
export const TOTAL_COL = 13;
export const cellKey = {
  hours: (client: string, m: number) => `h|${client}|${m}`,
  rate: (client: string) => `rate|${client}`,
  totalHours: (m: number) => `hT|${m}`,
  project: (desc: string, m: number) => `p|${desc}|${m}`,
  expense: (line: string, m: number) => `e|${line}|${m}`,
  rollup: (label: string, m: number) => `r|${label}|${m}`,
};

export interface ExplainData {
  year: number;
  clientRows: ClientRow[];
  priorClientRows: ClientRow[];
  rates: ClientRate[];
  projectRows: { description: string; cells: Map<number, { amount: number; state?: FinanceState; paidAt?: string | null; invoicedAt?: string | null }> }[];
  incomeByMonth: Map<number, number>;
  pnl: PnlMonthly[];
  priorPnl: PnlMonthly[];
  expenses: ExpenseRowDb[];
  salaries: SalaryRowDb[];
  freelance: FreelanceRowDb[];
  fx?: FxTable;
  /** The current month's hours logged in the tracker so far, per client — the
   * "(13)" in the grid, repeated on the card. */
  tracked?: { month: number; byClient: Record<string, number> };
  /** Each client's payment terms + invoice day (`useClientTerms`), for the
   * "payment due" / "invoice due" line on an income cell. */
  terms?: TermsByClient;
  /** today, yyyy-mm-dd — what "late" is measured against */
  today?: string;
}

const monthName = (m: number) => (m === TOTAL_COL ? "the year" : MONTH_NAMES[m - 1]);
const months = MONTHS.map((_, i) => i + 1);

const pnlValue = (pnl: PnlMonthly[], year: number, month: number, line: string) =>
  pnl.find((r) => r.year === year && r.month === month && r.lineItem === line)?.value;

/** Each ledger entry's own P&L rollup, worked out once per loaded data set
 * (`explainData` is memoised) rather than per expense row on every hover. */
const expenseRollups = new WeakMap<ExplainData, { r: ExpenseRowDb; out: ReturnType<typeof rollupCurrentYear> }[]>();
function rollupsPerExpense(d: ExplainData) {
  let list = expenseRollups.get(d);
  if (!list) {
    list = d.expenses.map((r) => ({
      r,
      out: rollupCurrentYear({ year: d.year, hours: [], rates: [], income: [], salaries: [], freelance: [], expenses: [mapExpense(r)], fx: d.fx }),
    }));
    expenseRollups.set(d, list);
  }
  return list;
}

/** What each ledger entry contributes to one expense line in one month — the
 * same rules the P&L uses (spread, monthly rates, no VAT). */
function ledgerBreakdown(d: ExplainData, line: string, m: number): { label: string; n: number }[] {
  if (line === LINE.salaries) {
    return d.salaries.filter((s) => s.year === d.year && s.month === m).map((s) => ({ label: s.employee_name, n: Number(s.gross_amount) }));
  }
  if (line === LINE.freelance) {
    return d.freelance.filter((f) => f.year === d.year && f.month === m).map((f) => ({ label: f.person_name, n: Number(f.amount) }));
  }
  const acc = new Map<string, number>();
  for (const { r, out } of rollupsPerExpense(d)) {
    const v = out.get(m)?.get(line);
    if (!v) continue;
    const label = r.vendor.trim() || r.description.trim() || "(unnamed)";
    acc.set(label, (acc.get(label) ?? 0) + v);
  }
  return [...acc.entries()].map(([label, n]) => ({ label, n }));
}

const lineLabel = (key: string) => (key === LINE.expensesOther ? "Expenses" : EXPENSE_LINES.find((l) => l.key === key)?.label ?? key);
const nounForLine = (line: string): Noun =>
  line === LINE.salaries ? NOUNS.person : line === LINE.freelance ? NOUNS.freelancer : NOUNS.vendor;

const notNull = <T,>(x: T | null | undefined): x is T => x != null;

// A stored timestamp is read as the studio's day: sliced, a mark made between
// 00:00 and 03:00 in Tel Aviv read as the day before (and the due date with it).
const day = (iso: string) => formatShortDay(studioDay(iso));
const late = (due: string, today: string | undefined) => {
  const n = today ? daysBetween(due, today) : 0;
  return n > 0 ? ` — ${n} ${n === 1 ? "day" : "days"} late` : "";
};

/**
 * The money's next date for one income cell (Nitsan, 2026-11-10): once the
 * invoice is out, when the PAYMENT is due on the client's terms; before that,
 * when the INVOICE is due to go out (the client's invoice day in the month after)
 * and when it would then be paid. Paid → when. `terms` null = a project line:
 * 14 days, and no invoice day to predict from.
 */
function moneyNote(
  cell: { state?: FinanceState; paidAt?: string | null; invoicedAt?: string | null } | undefined,
  terms: ClientTerms | null,
  year: number,
  m: number,
  today: string | undefined,
): string | null {
  if (!cell?.state) return null;
  const step = stepOf(cell.state, cell.paidAt ?? null, cell.invoicedAt ?? null);
  const t = terms ?? DEFAULT_CLIENT_TERMS;
  if (step === "paid") return cell.paidAt ? `Paid ${day(cell.paidAt)}` : "Paid";
  if (step === "invoiced" && cell.invoicedAt) {
    const due = paymentDue(studioDay(cell.invoicedAt), t);
    return `Invoiced ${day(cell.invoicedAt)} · payment due ${day(due)} (${termsAdjective(t)} terms)${late(due, today)}`;
  }
  if (!terms) return null;
  const invoice = invoiceDueFor(year, m, terms);
  return `Invoice due ${day(invoice)}${late(invoice, today)} · then paid by ${day(paymentDue(invoice, terms))} (${termsAdjective(terms)} terms)`;
}
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
};

/** Any audit correction on the hovered month (or line) is shown on its card. */
export function explainCell(key: string, d: ExplainData): Explanation | null {
  const ex = explainBase(key, d);
  if (!ex) return ex;
  const [kind, a, b] = key.split("|");
  const m = Number(b);
  if ((kind !== "r" && kind !== "e") || !(m >= 1 && m <= 12)) return ex;
  const audit = [
    ...new Set(
      d.pnl
        .filter((r) => r.year === d.year && r.month === m && r.note && (kind === "r" || r.lineItem === a))
        .map((r) => `Corrected: ${r.note}`),
    ),
  ];
  return audit.length ? { ...ex, notes: [...audit, ...ex.notes] } : ex;
}

function explainBase(key: string, d: ExplainData): Explanation | null {
  const [kind, a, b] = key.split("|");
  const lines = expenseLinesFor(d.pnl, d.year);
  const rollupAt = (m: number) => computeMonthRollup(d.clientRows, d.rates, d.incomeByMonth, d.pnl, d.year, m);
  const hrsFmt = (n: number) => `${formatHours(n)} h`;

  // ── A client's rate ──
  if (kind === "rate") {
    const client = a;
    const row = d.clientRows.find((r) => r.clientCanon === client);
    // The rate(s) billed each month with hours; consecutive months alike are grouped.
    // Sub-accounts are named only when they billed at different rates.
    const label = (parts: RatePart[]) =>
      new Set(parts.map((p) => p.rate)).size > 1
        ? parts.map((p) => `₪${p.rate}${p.sub ? ` ${p.sub}` : ""}`).join(" · ")
        : `₪${parts[0].rate}/h`;
    const groups: { text: string; from: number; to: number }[] = [];
    for (const m of months) {
      const parts = row ? monthRates(d.rates, row, d.year, m) : [];
      if (!parts.length) continue;
      const text = label(parts);
      const last = groups[groups.length - 1];
      if (last && last.text === text && last.to === m - 1) last.to = m;
      else groups.push({ text, from: m, to: m });
    }
    const summary = row ? rateSummary(d.rates, row, d.year) : { latest: null, changed: false };
    // The effective-dated rate table only drives live years; a closed year
    // shows what each month was booked at.
    const live = d.year >= new Date().getFullYear();
    const history = live
      ? d.rates.filter((r) => r.clientCanon === client).sort((x, y) => x.effectiveFrom.localeCompare(y.effectiveFrom))
      : [];
    return {
      title: `${client} · rate`,
      value: summary.latest != null ? `₪${summary.latest}/h` : "No rate",
      formula: live ? "The rate in effect on the 15th of each month is the one billed" : "As booked in the year's sheet, month by month",
      items: history.slice(-5).reverse().map((r) => ({
        label: r.effectiveTo ? `${fmtDate(r.effectiveFrom)} → ${fmtDate(r.effectiveTo)}` : `from ${fmtDate(r.effectiveFrom)}`,
        value: `₪${r.rate}`,
        n: 0,
      })),
      trends: [],
      notes: groups.map((g) => {
        const span = g.from === g.to ? MONTH_SHORT[g.from - 1] : `${MONTH_SHORT[g.from - 1]}–${MONTH_SHORT[g.to - 1]}`;
        return `${span} ${d.year}: ${g.text}`;
      }),
      sources: row ? months.filter((m) => row.cells.get(m)?.hours).map((m) => cellKey.hours(client, m)) : [],
    };
  }

  // ── Client hours ──
  if (kind === "h") {
    const client = a;
    const m = Number(b);
    const row = d.clientRows.find((r) => r.clientCanon === client);
    if (!row) return null;
    const billable = client !== NON_BILLABLE_CLIENT_CANON;
    const series = { values: months.map((mm) => row.cells.get(mm)?.hours ?? 0), current: m === TOTAL_COL ? null : m };
    if (m === TOTAL_COL) {
      const total = series.values.reduce((s, v) => s + v, 0);
      const active = months.filter((mm) => series.values[mm - 1] > 0);
      const best = [...active].sort((x, y) => series.values[y - 1] - series.values[x - 1])[0];
      const revenue = months.reduce((s, mm) => s + cellRevenue(d.rates, row, d.year, mm).revenue, 0);
      return {
        title: `${client} · ${d.year}`,
        value: hrsFmt(total),
        formula: `Sum of ${active.length} month${active.length === 1 ? "" : "s"} with hours`,
        trends: [],
        notes: [
          billable ? `≈ ${formatILS(revenue)} billed` : "Internal, not billed",
          best ? `Busiest month: ${MONTH_NAMES[best - 1]} (${hrsFmt(series.values[best - 1])})` : null,
          active.length ? `Average ${hrsFmt(total / active.length)} per active month` : null,
        ].filter(notNull),
        series,
        sources: months.map((mm) => cellKey.hours(client, mm)),
      };
    }
    const hours = row.cells.get(m)?.hours ?? 0;
    const { rate, revenue: billed } = cellRevenue(d.rates, row, d.year, m);
    const prev = m > 1 ? row.cells.get(m - 1)?.hours : undefined;
    const monthTotal = d.clientRows.filter((r) => r.clientCanon !== NON_BILLABLE_CLIENT_CANON).reduce((s, r) => s + (r.cells.get(m)?.hours ?? 0), 0);
    const logged = d.tracked?.month === m ? (d.tracked.byClient[client] ?? 0) : undefined;
    return {
      title: `${client} · ${monthName(m)}`,
      value: logged !== undefined ? `${hrsFmt(hours)} (${formatHours(logged)})` : hrsFmt(hours),
      formula: billable && rate ? `${formatHours(hours)} h × ₪${rate} = ${formatILS(billed)}` : billable ? "No rate this month — ₪0 billed" : "Internal hours, not billed",
      trends: [trend(hours, prev, hrsFmt, "last month", billable ? true : null)].filter(notNull),
      notes: [
        logged !== undefined
          ? `(${formatHours(logged)}) logged in the tracker so far${hours ? ` — ${formatPct(logged / hours, 0)} of the plan` : ""}`
          : null,
        billable && monthTotal ? `${formatPct(hours / monthTotal, 0)} of the month's billable hours` : null,
        billable && hours > 0
          ? moneyNote(row.cells.get(m), (row.clientId ? d.terms?.get(row.clientId) : undefined) ?? d.terms?.get(client) ?? DEFAULT_CLIENT_TERMS, d.year, m, d.today)
          : null,
      ].filter(notNull),
      series,
      tasks: hours > 0 ? { client, year: d.year, month: m } : undefined,
      sources: [cellKey.rate(client)],
    };
  }

  // ── Total hours row (billable clients) ──
  // The row shows the rollup's total — billable clients only, and a booked
  // month's booked figure (plan-grid's totalHoursRow). This card summed every
  // row, Studio included, so it disagreed with the cell it explains.
  if (kind === "hT") {
    const m = Number(a);
    const billable = d.clientRows.filter((r) => r.clientCanon !== NON_BILLABLE_CLIENT_CANON);
    const roll = months.map((mm) => rollupAt(mm));
    const totals = roll.map((r) => r.totalHours);
    const total = totals[m - 1];
    const rowsSum = billable.reduce((s, r) => s + (r.cells.get(m)?.hours ?? 0), 0);
    const logged = d.tracked?.month === m ? Object.values(d.tracked.byClient).reduce((s, v) => s + v, 0) : undefined;
    return {
      title: `Total hours · ${monthName(m)}`,
      value: logged !== undefined ? `${hrsFmt(total)} (${formatHours(logged)})` : hrsFmt(total),
      formula: roll[m - 1].booked
        ? "As booked for the month (internal Studio time not counted)"
        : "Sum of every billable client's hours (internal Studio time not counted)",
      ...top(billable.map((r) => ({ label: r.clientCanon, n: r.cells.get(m)?.hours ?? 0 })), hrsFmt),
      trends: [trend(total, m > 1 ? totals[m - 2] : undefined, hrsFmt, "last month", true)].filter(notNull),
      why:
        m > 1
          ? why(
              toMap(billable.map((r) => ({ label: r.clientCanon, n: r.cells.get(m)?.hours ?? 0 }))),
              toMap(billable.map((r) => ({ label: r.clientCanon, n: r.cells.get(m - 1)?.hours ?? 0 }))),
              NOUNS.client,
            )
          : undefined,
      notes: [
        logged !== undefined ? `(${formatHours(logged)}) billable hours logged in the tracker so far` : null,
        roll[m - 1].booked && Math.abs(rowsSum - total) >= 0.005 ? `The clients' rows add up to ${hrsFmt(rowsSum)}` : null,
      ].filter(notNull),
      series: { values: totals, current: m },
      sources: billable.map((r) => cellKey.hours(r.clientCanon, m)),
    };
  }

  // ── Project income ──
  if (kind === "p") {
    const desc = a;
    const m = Number(b);
    const row = d.projectRows.find((r) => r.description === desc);
    if (!row) return null;
    const values = months.map((mm) => row.cells.get(mm)?.amount ?? 0);
    const amount = m === TOTAL_COL ? values.reduce((s, v) => s + v, 0) : values[m - 1];
    return {
      title: `${desc} · ${monthName(m)}`,
      value: formatILS(amount),
      formula: m === TOTAL_COL ? "Sum of the months" : "One-off / fixed-fee income, typed here",
      trends: [],
      notes: m !== TOTAL_COL && amount > 0 ? [moneyNote(row.cells.get(m), null, d.year, m, d.today)].filter(notNull) : [],
      series: { values, current: m === TOTAL_COL ? null : m },
      sources: m === TOTAL_COL ? months.map((mm) => cellKey.project(desc, mm)) : [],
    };
  }

  // ── Expense lines ──
  if (kind === "e") {
    const line = a;
    const m = Number(b);
    const values = months.map((mm) => pnlValue(d.pnl, d.year, mm, line) ?? 0);
    const series = { values, current: m === TOTAL_COL ? null : m };
    if (m === TOTAL_COL) {
      const total = values.reduce((s, v) => s + v, 0);
      const filled = values.filter((v) => v);
      return {
        title: `${lineLabel(line)} · ${d.year}`,
        value: formatILS(total),
        formula: "Sum of the months",
        trends: [],
        notes: filled.length ? [`Average ${formatILS(total / filled.length)} a month`] : [],
        series,
        sources: months.map((mm) => cellKey.expense(line, mm)),
      };
    }
    const value = values[m - 1];
    const parts = ledgerBreakdown(d, line, m);
    const ledgerSum = parts.reduce((s, p) => s + p.n, 0);
    return {
      title: `${lineLabel(line)} · ${monthName(m)}`,
      value: formatILS(value),
      formula: parts.length ? `${parts.length} entr${parts.length === 1 ? "y" : "ies"}, all without VAT` : "No entries behind this figure",
      ...top(parts, formatILS),
      trends: [
        trend(value, m > 1 ? values[m - 2] : undefined, formatILS, "last month", false),
        trend(value, pnlValue(d.priorPnl, d.year - 1, m, line), formatILS, `${MONTH_SHORT[m - 1]} ${d.year - 1}`, false),
      ].filter(notNull),
      why: m > 1 && parts.length ? why(toMap(parts), toMap(ledgerBreakdown(d, line, m - 1)), nounForLine(line)) : undefined,
      notes: [parts.length && Math.abs(ledgerSum - value) > 1 ? `Entries add up to ${formatILS(ledgerSum)} — this figure is a locked one` : null].filter(notNull),
      series,
      sources: [],
    };
  }

  // ── Rollup ──
  if (kind === "r") {
    const label = a;
    const m = Number(b);
    const isTotal = m === TOTAL_COL;
    const all = months.map(rollupAt);
    const R = isTotal ? all : [all[m - 1]];
    const sum = (f: (r: (typeof all)[number]) => number) => R.reduce((s, r) => s + f(r), 0);
    const rev = sum((r) => r.totalRevenue);
    const exp = sum((r) => r.totalExpense);
    const hrsIncome = sum((r) => r.hoursIncome);
    const proj = sum((r) => r.projectIncome);
    const other = sum((r) => r.otherIncome);
    const isBooked = R.every((r) => r.booked);
    const hrs = sum((r) => r.totalHours);
    const rate = hrs ? hrsIncome / hrs : 0;
    const prev = !isTotal && m > 1 ? all[m - 2] : null;
    const ly = (line: string) => (isTotal ? undefined : pnlValue(d.priorPnl, d.year - 1, m, line));
    const lyLabel = `${MONTH_SHORT[m - 1] ?? ""} ${d.year - 1}`;
    const ms = isTotal ? months : [m];
    const keys = (fn: (mm: number) => string[]) => ms.flatMap(fn);
    // "Total revenues" stays the key; the row reads "Total income" (2026-11-02).
    const title = `${label === "Total revenues" ? "Total income" : label} · ${monthName(m)}`;
    // Break-even, in hours: what used to be its own rows ("Min hours to BE",
    // "Income in hours") now lives here, on income, expenses and profit.
    const be = rate ? exp / rate : 0;
    const beNote = be
      ? `Break-even ${hrsFmt(be)} at avg ₪${rate.toFixed(0)}/h` +
        (hrs ? (hrs >= be ? ` — worked ${hrsFmt(hrs - be)} above it` : ` — ${hrsFmt(be - hrs)} short of it`) : "")
      : null;
    const cur = isTotal ? null : m;
    const projKeys = (mm: number) => d.projectRows.map((p) => cellKey.project(p.description, mm));
    const billableKeys = (mm: number) =>
      d.clientRows.filter((r) => r.clientCanon !== NON_BILLABLE_CLIENT_CANON).map((r) => cellKey.hours(r.clientCanon, mm));
    const byClient = (f: (r: ClientRow, mm: number) => number) =>
      d.clientRows.filter((r) => r.clientCanon !== NON_BILLABLE_CLIENT_CANON).map((r) => ({ label: r.clientCanon, n: ms.reduce((s, mm) => s + f(r, mm), 0) }));

    const revByClient = (mm: number) => {
      const map = toMap(
        d.clientRows
          .filter((r) => r.clientCanon !== NON_BILLABLE_CLIENT_CANON)
          .map((r) => ({ label: r.clientCanon, n: cellRevenue(d.rates, r, d.year, mm).revenue })),
      );
      const projects = all[mm - 1].projectIncome;
      if (projects) map.set("project income", projects);
      return map;
    };
    const hoursOf = (client: string, mm: number) => d.clientRows.find((r) => r.clientCanon === client)?.cells.get(mm)?.hours ?? 0;
    /** Revenue that moved without the hours moving the same way came from the rate. */
    const rateOrHours: Say = (dr, move) => {
      if (move !== "up" && move !== "down") return null;
      const dh = hoursOf(dr.label, m) - hoursOf(dr.label, m - 1);
      return Math.sign(dh) === Math.sign(dr.delta) ? null : `${iso(dr.label)}'s rate ${move === "up" ? "went up" : "went down"}`;
    };
    const linesAt = (mm: number) => toMap(lines.map((l) => ({ label: l.label, n: pnlValue(d.pnl, d.year, mm, l.key) ?? 0 })));
    /** The expense story one level down: which line moved, and inside it why. */
    const expenseWhy = (): string | undefined => {
      if (isTotal || m < 2) return undefined;
      const cur = linesAt(m);
      const prevL = linesAt(m - 1);
      const total = sumOf(cur) - sumOf(prevL);
      const top1 = drivers(cur, prevL, total)[0];
      const line = top1 && lines.find((l) => l.label === top1.label);
      if (!line) return why(cur, prevL, NOUNS.line);
      const inner = reason(toMap(ledgerBreakdown(d, line.key, m)), toMap(ledgerBreakdown(d, line.key, m - 1)), nounForLine(line.key));
      const dir = dirText(total, sumOf(prevL));
      return inner ? `${dir} vs last month, mainly ${line.label}: ${inner}.` : `${dir} vs last month, mainly ${NOUNS.line(line.label, moveOf(top1))}.`;
    };

    switch (label) {
      case "Total revenues": {
        const parts = byClient((r, mm) => cellRevenue(d.rates, r, d.year, mm).revenue);
        if (proj) parts.push({ label: "Projects (one-off)", n: proj });
        return {
          title,
          value: formatILS(rev),
          formula:
            `Hours ${formatILS(hrsIncome)} (${formatHours(hrs)} h × avg ₪${rate.toFixed(0)}) + projects ${formatILS(proj)}` +
            (Math.abs(other) >= 1 ? ` + other ${formatILS(other)}` : ""),
          ...top(Math.abs(other) >= 1 ? [...parts, { label: "Other booked income", n: other }] : parts, formatILS, 5),
          trends: [prev ? trend(rev, prev.totalRevenue, formatILS, "last month", true) : null, trend(rev, ly(LINE.totalRevenues), formatILS, lyLabel, true)].filter(notNull),
          why: !isTotal && m > 1 ? why(revByClient(m), revByClient(m - 1), NOUNS.client, rateOrHours) : undefined,
          notes: [rate ? `Worth ${hrsFmt(rev / rate)} at avg ₪${rate.toFixed(0)}/h` : null, beNote].filter(notNull),
          series: { values: all.map((r) => r.totalRevenue), current: cur },
          sources: keys((mm) => [...billableKeys(mm), ...projKeys(mm)]),
        };
      }
      case "Total expenses": {
        const linesSum = lines.reduce((s, l) => s + ms.reduce((t, mm) => t + (pnlValue(d.pnl, d.year, mm, l.key) ?? 0), 0), 0);
        return {
          title,
          value: formatILS(exp),
          formula: "Sum of the expense lines above, all without VAT",
          ...top(lines.map((l) => ({ label: l.label, n: ms.reduce((s, mm) => s + (pnlValue(d.pnl, d.year, mm, l.key) ?? 0), 0) })), formatILS, 6),
          trends: [prev ? trend(exp, prev.totalExpense, formatILS, "last month", false) : null, trend(exp, ly(LINE.totalExpenses), formatILS, lyLabel, false)].filter(notNull),
          why: expenseWhy(),
          notes: [
            rev ? `${formatPct(exp / rev, 0)} of revenue` : null,
            beNote,
            isBooked && Math.abs(linesSum - exp) >= 1 ? `Booked total — the lines above add up to ${formatILS(linesSum)}` : null,
          ].filter(notNull),
          series: { values: all.map((r) => r.totalExpense), current: cur },
          sources: keys((mm) => lines.map((l) => cellKey.expense(l.key, mm))),
        };
      }
      case "Profit": {
        const profit = sum((r) => r.profit);
        return {
          title,
          value: formatILS(profit),
          formula: `Revenue ${formatILS(rev)} − expenses ${formatILS(exp)}`,
          trends: [prev ? trend(profit, prev.profit, formatILS, "last month", true) : null, trend(profit, ly(LINE.profit), formatILS, lyLabel, true)].filter(notNull),
          why: prev
            ? profitWhy({
                rev: { cur: rev, prev: prev.totalRevenue, parts: [revByClient(m), revByClient(m - 1)] },
                exp: { cur: exp, prev: prev.totalExpense, parts: [linesAt(m), linesAt(m - 1)] },
                label: "last month",
              })
            : undefined,
          notes: [rev ? `Margin ${formatPct(profit / rev, 1)}` : null, beNote].filter(notNull),
          series: { values: all.map((r) => r.profit), current: cur },
          sources: keys((mm) => [cellKey.rollup("Total revenues", mm), cellKey.rollup("Total expenses", mm)]),
        };
      }
      case "Profit %": {
        const profit = rev - exp;
        return {
          title,
          value: rev ? formatPct(profit / rev, 1) : "—",
          formula: `Profit ${formatILS(profit)} ÷ revenue ${formatILS(rev)}`,
          trends: [],
          notes: [
            prev && prev.totalRevenue ? `Last month ${formatPct(prev.profitPct, 1)}` : null,
            ly(LINE.profitPct) != null ? `${lyLabel}: ${formatPct(ly(LINE.profitPct)!, 1)}` : null,
          ].filter(notNull),
          series: { values: all.map((r) => r.profitPct), current: cur },
          sources: keys((mm) => [cellKey.rollup("Profit", mm), cellKey.rollup("Total revenues", mm)]),
        };
      }
    }
  }
  return null;
}

// ── Hover wiring + card ──────────────────────────────────────────────────────

/** The Plan grid's hover cards. */
export function usePlanExplain(data: ExplainData | null) {
  return useExplainHover((key) => (data ? explainCell(key, data) : null));
}
