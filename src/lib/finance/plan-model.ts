import {
  LINE,
  MONTH_SHORT,
  NON_BILLABLE_CLIENT_CANON,
  isPeriodLocked,
  rateForMonth,
  round2,
  type ClientMonthly,
  type ClientRate,
  type FinanceState,
  type HoursCell,
  type PnlMonthly,
} from "@/lib/finance/finance";

/** finance.ts's month names, under the name the grids import. */
export const MONTHS: readonly string[] = MONTH_SHORT;

/** One client's row in the plan grid: hours + state per month (1–12). */
export interface ClientRow {
  clientCanon: string;
  clientId: string | null;
  discipline: string | null;
  /** month(1–12) → { hours, state, comment } */
  cells: Map<number, { hours: number; state: FinanceState; comment: string; revenue?: number; parts?: RatePart[]; paidAt?: string | null; invoicedAt?: string | null }>;
}

/** One sheet row inside a client's month — a client can bill several
 * sub-accounts at their own rates (Mobileye Corporate / HR, Raven / Web). */
export interface RatePart {
  sub: string;
  rate: number;
  hours: number;
}

/** What a client cell billed: a locked month keeps the revenue it was booked
 * at (an old sheet's own per-row rate); a live month is hours × the rate. */
export function cellRevenue(
  rates: ClientRate[],
  row: ClientRow,
  year: number,
  month: number,
): { revenue: number; rate: number | null } {
  const cell = row.cells.get(month);
  if (!cell?.hours) return { revenue: 0, rate: rateFor(rates, row.clientCanon, year, month) };
  if (cell.state === "final" && cell.revenue) return { revenue: cell.revenue, rate: round2(cell.revenue / cell.hours) };
  const rate = rateFor(rates, row.clientCanon, year, month);
  return { revenue: cell.hours * (rate ?? 0), rate };
}

/** Effective rate for a client in a given month (null if none set) — finance.ts's
 * `rateForMonth`, under the name the Plan imports. */
export const rateFor = rateForMonth;

/** The rate(s) a client's month billed at: a locked month keeps each sheet
 * row's own booked rate; a live month uses the rate in effect. Biggest first. */
export function monthRates(rates: ClientRate[], row: ClientRow, year: number, month: number): RatePart[] {
  const cell = row.cells.get(month);
  if (!cell?.hours) return [];
  if (cell.state === "final" && cell.parts?.length) {
    return cell.parts.filter((p) => p.hours > 0).sort((a, b) => b.hours - a.hours);
  }
  const rate = rateFor(rates, row.clientCanon, year, month);
  return rate == null ? [] : [{ sub: "", rate, hours: cell.hours }];
}

/** The Plan grid's RATE column: the latest rate billed (the month's main
 * rate), and whether it changed during the year — the hover card has the
 * history. A row with no hours yet falls back to the June rate. */
export function rateSummary(rates: ClientRate[], row: ClientRow, year: number): { latest: number | null; changed: boolean } {
  const seen = new Set<number>();
  let latest: number | null = null;
  for (let m = 1; m <= 12; m++) {
    const parts = monthRates(rates, row, year, m);
    for (const p of parts) seen.add(p.rate);
    if (parts.length) latest = parts[0].rate;
  }
  if (latest == null) return { latest: rateFor(rates, row.clientCanon, year, 6), changed: false };
  return { latest, changed: seen.size > 1 };
}

/** The rates billed through the year, in order, e.g. "250→300" (CSV export). */
export function rateLabel(rates: ClientRate[], row: ClientRow, year: number): string {
  const billed: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const r = monthRates(rates, row, year, m)[0]?.rate;
    if (r != null && billed[billed.length - 1] !== r) billed.push(r);
  }
  if (billed.length) return billed.join("→");
  const fallback = rateFor(rates, row.clientCanon, year, 6);
  return fallback == null ? "" : String(fallback);
}

/**
 * Every finance_client_monthly row one client's month is made of: its main
 * row (sub_account "") and any sub-account rows (Mobileye Corporate / HR,
 * Raven / Web) — the rows the grid sums into one cell (`buildClientRows`).
 */
export function clientMonthRows(list: ClientMonthly[], year: number, month: number, clientCanon: string): ClientMonthly[] {
  return list.filter((r) => r.year === year && r.month === month && r.clientCanon === clientCanon);
}

/**
 * Whether the Plan may write a client's month as its one main ("") row — no
 * rows yet, or only the main one. A month held in sub-account rows is left
 * alone: each bills at its own rate, and a main row written beside them would
 * count the month's hours twice (client-rate.ts applies the same rule when a
 * rate brings tracker hours in).
 */
export function mainRowOnly(rows: ClientMonthly[]): boolean {
  return rows.every((r) => r.subAccount === "");
}

/** One `finance_undo_log` batch, as the Plan reads it. */
export interface UndoBatch {
  action_label: string;
  changes: { match?: { year?: number } }[] | null;
}

/** The label every Plan tracker-sync batch starts with — Rates (client-rate.ts)
 * logs to the same table under its own labels. */
export const SYNC_LABEL = "Synced ";

/**
 * "Undo last sync" takes only a tracker-sync batch of the year on screen: the
 * table also holds Rates repricings (client-rate.ts) and other years' syncs,
 * which the button must never reach for.
 */
export function isSyncBatchFor(batch: UndoBatch, year: number): boolean {
  const changes = batch.changes ?? [];
  return batch.action_label.startsWith(SYNC_LABEL) && changes.length > 0 && changes.every((c) => c.match?.year === year);
}

/** Assemble the per-client hours rows for a year from finance_client_monthly. */
export function buildClientRows(clientMonthly: ClientMonthly[], year: number): ClientRow[] {
  const byClient = new Map<string, ClientRow>();
  for (const r of clientMonthly) {
    if (r.year !== year) continue;
    let row = byClient.get(r.clientCanon);
    if (!row) {
      row = {
        clientCanon: r.clientCanon,
        clientId: r.clientId,
        discipline: r.discipline,
        cells: new Map(),
      };
      byClient.set(r.clientCanon, row);
    }
    const cur = row.cells.get(r.month);
    // Sum sub-accounts into a single client row.
    row.cells.set(r.month, {
      hours: (cur?.hours ?? 0) + r.hours,
      state: r.state,
      comment: r.comment || cur?.comment || "",
      // Paid only when every sub-account row of the month is.
      paidAt: cur && !cur.paidAt ? null : (r.paidAt ?? null),
      // Invoiced likewise — every row invoiced (or paid, which implies it).
      invoicedAt: cur && !(cur.invoicedAt || cur.paidAt) ? null : (r.invoicedAt ?? r.paidAt ?? null),
      revenue: (cur?.revenue ?? 0) + (r.revenueGross || 0),
      parts: [
        ...(cur?.parts ?? []),
        ...(r.hours ? [{ sub: r.subAccount || "", rate: r.rate ?? round2((r.revenueGross || 0) / r.hours), hours: r.hours }] : []),
      ],
    });
  }
  const rows = [...byClient.values()].sort((a, b) => a.clientCanon.localeCompare(b.clientCanon));
  // Studio is an internal, non-billable bucket — keep it out of the
  // alphabetical client order, always first (never counted, see NON_BILLABLE_CLIENT_CANON).
  const studioIdx = rows.findIndex((r) => r.clientCanon === NON_BILLABLE_CLIENT_CANON);
  if (studioIdx !== -1) rows.unshift(...rows.splice(studioIdx, 1));
  return rows;
}

/**
 * The P&L's hours and hourly income, FROM THE PLAN (Nitsan, 2026-11-10: "the
 * Plan wins"). The recompute used to price the tracker's logged hours, so a
 * sync suggestion kept back or hours typed on the Plan left the Plan's Total
 * income and the Overview/P&L disagreeing for every month not yet booked. Now
 * each client-month is exactly what the Plan's own rollup counts
 * (`computeMonthRollup`): sub-accounts summed, a final month at its booked
 * revenue, else hours × the rate in effect; Studio left out.
 */
export function planHoursCells(clientMonthly: ClientMonthly[], rates: ClientRate[], year: number): HoursCell[] {
  const out: HoursCell[] = [];
  for (const row of buildClientRows(clientMonthly, year)) {
    if (row.clientCanon === NON_BILLABLE_CLIENT_CANON) continue;
    for (const [month, cell] of row.cells) {
      if (!cell.hours) continue;
      out.push({ year, month, clientId: row.clientId, clientCanon: row.clientCanon, hours: cell.hours, revenue: cellRevenue(rates, row, year, month).revenue });
    }
  }
  return out;
}

/** month(1–12) → value, for one pnl line item (actuals + rollup + import). */
export function pnlLineByMonth(pnl: PnlMonthly[], year: number, lineItem: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of pnl) {
    if (r.year === year && r.lineItem === lineItem) {
      out.set(r.month, (out.get(r.month) ?? 0) + r.value);
    }
  }
  return out;
}

export const EXPENSE_LINES = [
  { key: LINE.salaries, label: "Salaries", href: "/finance/salaries" },
  { key: LINE.freelance, label: "Freelance", href: "/finance/freelance" },
  { key: LINE.rentExpenses, label: "Rent expenses", href: "/finance/expenses" },
  { key: LINE.expensesMonthly, label: "Monthly expenses", href: "/finance/expenses" },
  { key: LINE.expensesYearly, label: "Yearly expenses", href: "/finance/expenses" },
  { key: LINE.expensesMisc, label: "Misc expenses", href: "/finance/expenses" },
  { key: LINE.expensesAccounting, label: "Accounting", href: "/finance/expenses" },
  { key: LINE.expensesLawyer, label: "Lawyer", href: "/finance/expenses" },
  { key: LINE.expensesGur, label: "Gur", href: "/finance/expenses" },
  { key: LINE.investments, label: "Investments", href: "/finance/expenses" },
] as const;

export interface ExpenseLine {
  key: string;
  label: string;
  href: string;
}

/** The expense lines a year's books carry. Sheets before 2025 kept a single
 * combined "Expenses" line, with no Monthly / Yearly / Misc split — such a
 * year shows that line as booked rather than three empty split lines. */
export function expenseLinesFor(pnl: PnlMonthly[], year: number): readonly ExpenseLine[] {
  const has = (key: string) => pnl.some((r) => r.year === year && r.lineItem === key && r.value);
  const split = has(LINE.expensesMonthly) || has(LINE.expensesYearly) || has(LINE.expensesMisc);
  if (split || !has(LINE.expensesOther)) return EXPENSE_LINES;
  return EXPENSE_LINES.flatMap((l): ExpenseLine[] =>
    l.key === LINE.expensesMonthly
      ? [{ key: LINE.expensesOther, label: "Expenses", href: "/finance/expenses" }]
      : l.key === LINE.expensesYearly || l.key === LINE.expensesMisc
        ? []
        : [l],
  );
}

/** Is (year, month) locked for a block? Same predicate as `isPeriodLocked` —
 * kept as a local alias since every grid in this codebase imports it from
 * here by this name. */
export const monthLocked = isPeriodLocked;

export interface RollupRow {
  hoursIncome: number;
  projectIncome: number;
  totalRevenue: number;
  totalExpense: number;
  profit: number;
  profitPct: number;
  totalHours: number;
  avgRate: number;
  /** Total expenses / total revenue expressed as hours-equivalents at
   * avgRate — comparable to totalHours on the same scale. */
  minHoursToBE: number;
  incomeInHours: number;
  /** Booked revenue the grid's own rows don't carry (a sheet's rent income,
   * grants…): booked total − hours income − project income. 0 when live. */
  otherIncome: number;
  /** True when the month's totals are its booked (locked) figures. */
  booked: boolean;
}

/**
 * Live rollup for the grid: revenue from client hours × rate + non-hourly
 * income, expenses from the pnl expense lines. Recomputes as cells are edited.
 */
export function computeMonthRollup(
  clientRows: ClientRow[],
  rates: ClientRate[],
  incomeByMonth: Map<number, number>,
  pnl: PnlMonthly[],
  year: number,
  month: number,
): RollupRow {
  let hoursIncome = 0;
  let totalHours = 0;
  for (const row of clientRows) {
    if (row.clientCanon === NON_BILLABLE_CLIENT_CANON) continue;
    const cell = row.cells.get(month);
    if (!cell) continue;
    totalHours += cell.hours;
    hoursIncome += cellRevenue(rates, row, year, month).revenue;
  }
  const projectIncome = incomeByMonth.get(month) ?? 0;
  const totalRevenue = hoursIncome + projectIncome;
  // The year's and the month's rows once, rather than a scan of all of pnl
  // per expense line — same rows in the same order, so the same sums.
  const yearRows = pnl.filter((r) => r.year === year);
  const monthRows = yearRows.filter((r) => r.month === month);
  let totalExpense = 0;
  for (const line of expenseLinesFor(yearRows, year)) {
    for (const r of monthRows) {
      if (r.lineItem === line.key) totalExpense += r.value;
    }
  }
  const profit = totalRevenue - totalExpense;
  const avgRate = totalHours ? hoursIncome / totalHours : 0;
  const live: RollupRow = {
    hoursIncome,
    projectIncome,
    totalRevenue,
    totalExpense,
    profit,
    profitPct: totalRevenue ? profit / totalRevenue : 0,
    totalHours,
    avgRate,
    minHoursToBE: avgRate ? totalExpense / avgRate : 0,
    incomeInHours: avgRate ? totalRevenue / avgRate : 0,
    otherIncome: 0,
    booked: false,
  };
  return bookedRollup(live, monthRows, year, month);
}

/**
 * A booked month — its P&L totals locked "final" (every closed year, the
 * finished months of this one) — shows what was booked, not a recount of the
 * detail rows. The books carry things the detail doesn't (a sheet's rent
 * income or grants, its own formulas), and recounting a closed year must
 * never quietly rewrite its result. Lines that weren't booked keep the live
 * figure; Recompute's gap list is where a booked/live difference surfaces.
 */
function bookedRollup(live: RollupRow, pnl: PnlMonthly[], year: number, month: number): RollupRow {
  const booked = (line: string) =>
    pnl.find((r) => r.year === year && r.month === month && r.lineItem === line && r.state === "final")?.value;
  const totalRevenue = booked(LINE.totalRevenues);
  const totalExpense = booked(LINE.totalExpenses);
  if (totalRevenue === undefined || totalExpense === undefined) return live;
  const profit = booked(LINE.profit) ?? totalRevenue - totalExpense;
  const totalHours = booked(LINE.totalHours) ?? live.totalHours;
  const hoursIncome = booked(LINE.hoursIncome) ?? live.hoursIncome;
  const projectIncome = booked(LINE.projectIncome) ?? live.projectIncome;
  const avgRate = totalHours ? hoursIncome / totalHours : 0;
  return {
    hoursIncome,
    projectIncome,
    totalRevenue,
    totalExpense,
    profit,
    profitPct: totalRevenue ? profit / totalRevenue : 0,
    totalHours,
    avgRate,
    minHoursToBE: booked(LINE.minHoursBE) ?? (avgRate ? totalExpense / avgRate : 0),
    incomeInHours: booked(LINE.incomeInHours) ?? (avgRate ? totalRevenue / avgRate : 0),
    otherIncome: totalRevenue - hoursIncome - projectIncome,
    booked: true,
  };
}

