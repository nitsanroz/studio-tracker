/**
 * "Paid" as the finance app's Plan says it (v1.94.0, migration 0064).
 *
 * Nitsan marks a client's month Paid on finance-admin's Plan; Client Reports
 * shows a payment period as paid when EVERY calendar month the period touches
 * is marked paid there — the same rule finance's &advice uses (`paidOnPlan`),
 * so the two never disagree. The tracker's own tick still works and still wins
 * on its own; this only ever ADDS paid, and never writes the tick.
 *
 * Booleans only cross over (`client_months_paid` returns no amounts), because
 * Michal sees Client Reports without finance access.
 */

/** "2026-10" for a year and a 1-based month. */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Every calendar month an inclusive ISO date range touches, as "YYYY-MM".
 * 20 Sep – 19 Oct → ["2026-09", "2026-10"]. An inverted range → [].
 */
export function monthsSpanned(dateFrom: string, dateTo: string): string[] {
  const end = dateTo.slice(0, 7);
  let [y, m] = dateFrom.split("-").map(Number);
  const out: string[] = [];
  // compare the DATES, not the month keys: 31 Oct → 1 Oct shares a month key
  if (dateFrom > dateTo || !Number.isFinite(y) || !Number.isFinite(m)) return out;
  for (let k = monthKey(y, m); k <= end; k = monthKey(y, m)) {
    out.push(k);
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return out;
}

/** One row of `client_months_paid`. */
export interface MonthPaidRow {
  client_id: string;
  year: number;
  month: number;
  paid: boolean;
}

/** The months the Plan has marked paid, as "YYYY-MM", for one client. */
export function paidMonthsFor(rows: MonthPaidRow[], clientId: string): Set<string> {
  const out = new Set<string>();
  for (const r of rows) if (r.client_id === clientId && r.paid) out.add(monthKey(r.year, r.month));
  return out;
}

/**
 * Whether the Plan has every month of the period marked paid. A month the Plan
 * has no row for (or a row not yet paid) leaves the period unpaid — paid is
 * never assumed.
 */
export function periodPaidInFinance(
  period: { dateFrom: string; dateTo: string },
  paidMonths: Set<string>,
): boolean {
  const months = monthsSpanned(period.dateFrom, period.dateTo);
  return months.length > 0 && months.every((k) => paidMonths.has(k));
}
