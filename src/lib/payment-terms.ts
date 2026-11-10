import { parseISO, shiftDays, toISODate } from "./format";

/**
 * When a client's payment is due (Nitsan, 2026-11-10): the invoice goes out on
 * the client's invoice day — the day after a billing period ends, since Client
 * Reports aligns periods to end the day before it — and the client has its own
 * number of days from there (`clients.payment_terms_days`, migration 0065).
 * 14 for nearly everyone; Maccabi is on net+30.
 *
 * ⚠️ The finance app counts the same way (its receivables + &advice read the
 * same column), so the two apps never call one payment late on different days.
 * Change the rule in both repos.
 */

/** The studio's usual terms, and what a client without the column reads as. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 14;

/** The invoice date for a billing period: the day after it ends. */
export function invoiceDateFor(periodEnd: string): string {
  return toISODate(shiftDays(parseISO(periodEnd), 1));
}

/** The payment date for a billing period, on this client's terms. */
export function paymentDueFor(periodEnd: string, termsDays: number = DEFAULT_PAYMENT_TERMS_DAYS): string {
  return toISODate(shiftDays(parseISO(invoiceDateFor(periodEnd)), termsDays));
}

/**
 * A typed terms value, or null to refuse it — like the cap and invoice day
 * fields, nothing is coerced: `Number("")` is 0, which would make every invoice
 * due the day it is sent. Whole days, 0–180 (the column's check).
 */
export function termsToStore(raw: string): number | null {
  const v = raw.trim().replace(/\s*days?$/i, "").replace(/^net\s*\+?\s*/i, "");
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n <= 180 ? n : null;
}
