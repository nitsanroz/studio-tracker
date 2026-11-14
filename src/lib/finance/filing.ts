// Invoice filing marks on the Expenses page. Invoices are filed in the first
// week of a month, so the marks start over on the 25th: a mark counts only if
// it was made on or after the most recent 25th. Nothing has to clear them.

/** Day of the month the filing marks start over. */
export const FILING_RESET_DAY = 25;

/** The most recent reset: the 25th of this month once it has come, else of last month. */
export function filingCycleStart(today = new Date()): Date {
  const y = today.getFullYear();
  const m = today.getMonth();
  return today.getDate() >= FILING_RESET_DAY
    ? new Date(y, m, FILING_RESET_DAY)
    : new Date(y, m - 1, FILING_RESET_DAY);
}

/** Is a row's filing mark (an ISO timestamp, or null) still current? */
export function isFiled(filedAt: string | null | undefined, today = new Date()): boolean {
  return !!filedAt && new Date(filedAt) >= filingCycleStart(today);
}
