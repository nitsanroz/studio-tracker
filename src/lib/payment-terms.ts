import { parseISO, shiftDays, toISODate } from "./format";
import { parseInvoiceDay } from "./billing-rollover";

/**
 * When a client's payment is due (Nitsan, 2026-11-10). The invoice goes out on
 * the client's invoice day — the day after a billing period ends, since Client
 * Reports aligns periods to end the day before it — and the client then has
 * its terms (`clients.payment_terms_days` + `payment_terms_net`, 0065/0066):
 *
 *  · **N days** (the studio's usual 14): due N days after the invoice.
 *  · **Net+N** (Maccabi, net+30 — שוטף+30): the clock starts at the END of the
 *    invoice's month, and the money comes in the payment run on the 1st–5th
 *    after that. So an invoice of 20 Oct is due 5 Dec — 40–45 days later, as it
 *    really arrives — not 19 Nov.
 *
 * ONE copy since the finance merge (2026-11): finance's receivables, &advice and
 * the Plan's hover cards read this file too (the block at its end).
 */

export interface PaymentTerms {
  days: number;
  /** net+N: counted from the end of the invoice's month, paid by the 5th after */
  net: boolean;
}

/** The studio's usual terms, and what a client without the columns reads as. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 14;
export const DEFAULT_PAYMENT_TERMS: PaymentTerms = { days: DEFAULT_PAYMENT_TERMS_DAYS, net: false };

/** Net terms are paid in the run on the 1st–5th of the month: due by the 5th. */
export const NET_PAY_DAY = 5;

/** The invoice date for a billing period: the day after it ends. */
export function invoiceDateFor(periodEnd: string): string {
  return toISODate(shiftDays(parseISO(periodEnd), 1));
}

/**
 * The payment date for an invoice sent on `invoiceDate`.
 *
 * Net+N counts whole months, not days: the end of the invoice's month + N days
 * lands in the month `ceil(N / 30)` after it, and the payment run is the 5th of
 * the month after THAT. Months rather than days because "31 Jan + 30" is 2 March,
 * which would push a February invoice's payment a whole month late.
 */
export function paymentDue(invoiceDate: string, terms: PaymentTerms = DEFAULT_PAYMENT_TERMS): string {
  if (!terms.net) return toISODate(shiftDays(parseISO(invoiceDate), terms.days));
  const d = parseISO(invoiceDate);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1 + Math.ceil(terms.days / 30), NET_PAY_DAY));
}

/** The payment date for a billing period, on this client's terms. */
export function paymentDueFor(periodEnd: string, terms: PaymentTerms = DEFAULT_PAYMENT_TERMS): string {
  return paymentDue(invoiceDateFor(periodEnd), terms);
}

/** "14 days" / "Net+30" — how the terms are written on screen. */
export function termsLabel(terms: PaymentTerms): string {
  return terms.net ? `Net+${terms.days}` : `${terms.days} ${terms.days === 1 ? "day" : "days"}`;
}

/**
 * Typed terms, or null to refuse them — like the cap and invoice day fields,
 * nothing is coerced: `Number("")` is 0, which would make every invoice due the
 * day it is sent. Whole days, 0–180 (the column's check). "14", "14 days" →
 * 14 days; "net+30", "Net 30", "שוטף+30" → net+30.
 */
export function termsToStore(raw: string): PaymentTerms | null {
  let v = raw.trim().toLowerCase();
  // (no `\b`: it doesn't see Hebrew letters as word characters)
  const net = /^(net|שוטף)/.test(v);
  v = v.replace(/^(net|שוטף)\s*\+?\s*/, "").replace(/\s*(days?|ימים|יום)$/, "");
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n <= 180 ? { days: n, net } : null;
}

// ── What finance reads on top (merged from finance-admin, 2026-11) ───────────
// Its receivables, Plan hover cards and &advice used a hand-kept mirror of this
// file that had drifted: UTC dates where this uses the studio's local ones, and
// its own, stricter copy of parseInvoiceDay. One copy now.

/** A client's terms together with the day of the month their invoice goes out. */
export interface ClientTerms extends PaymentTerms {
  /** day of the month the invoice goes out (1–31); null = the 1st, a calendar month */
  invoiceDay: number | null;
}

export const DEFAULT_CLIENT_TERMS: ClientTerms = { ...DEFAULT_PAYMENT_TERMS, invoiceDay: null };

/**
 * When the invoice for a calendar month's hours is due to go out: the client's
 * invoice day in the FOLLOWING month (the period holding the month's last days
 * closes the day before it), clamped to that month's length; the 1st when the
 * client has none. NoTraffic (the 15th): October's hours → 15 Nov.
 */
export function invoiceDueFor(year: number, month: number, terms: Pick<ClientTerms, "invoiceDay"> = DEFAULT_CLIENT_TERMS): string {
  const day = terms.invoiceDay ?? 1;
  const last = new Date(year, month + 1, 0).getDate(); // the next month's length
  return toISODate(new Date(year, month, Math.min(day, last)));
}

/** The terms as an adjective, for a sentence: "(14-day terms)", "(Net+30 terms)". */
export function termsAdjective(terms: PaymentTerms): string {
  return terms.net ? `Net+${terms.days}` : `${terms.days}-day`;
}

/** A `clients` row (selected as `*`, so missing columns are simply absent) → its terms. */
export function termsFromClientRow(r: { payment_terms_days?: unknown; payment_terms_net?: unknown; invoice_note?: unknown }): ClientTerms {
  return {
    days: r.payment_terms_days == null ? DEFAULT_PAYMENT_TERMS_DAYS : Number(r.payment_terms_days),
    net: r.payment_terms_net === true,
    invoiceDay: parseInvoiceDay(r.invoice_note as string | null | undefined),
  };
}
