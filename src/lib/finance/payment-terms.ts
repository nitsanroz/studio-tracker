/**
 * When a client's invoice goes out and when its payment is due — the tracker's
 * rule (its `lib/payment-terms.ts`, v1.102.0), read from the same columns:
 * `clients.payment_terms_days` (0065), `payment_terms_net` (0066) and the
 * invoice day in `clients.invoice_note` (edited on the tracker's Client Reports).
 *
 *  · **N days** (the studio's usual 14): due N days after the invoice.
 *  · **Net+N** (Maccabi, net+30 — שוטף+30): counted from the END of the
 *    invoice's month, paid in the run on the 1st–5th after — an invoice of
 *    20 Oct is due 5 Dec, 40–45 days later, as it really arrives.
 *
 * ⚠️ Change the rule in both repos. Plain ISO-date maths in UTC, so no clock
 * change can move a day.
 */

export interface ClientTerms {
  days: number;
  net: boolean;
  /** day of the month the invoice goes out (1–31); null = the 1st, a calendar month */
  invoiceDay: number | null;
}

export const DEFAULT_TERMS_DAYS = 14;
export const DEFAULT_TERMS: ClientTerms = { days: DEFAULT_TERMS_DAYS, net: false, invoiceDay: null };

/** Net terms are paid in the run on the 1st–5th of the month: due by the 5th. */
export const NET_PAY_DAY = 5;

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

/** The payment date for an invoice sent on `invoiceDate` (yyyy-mm-dd or a timestamp). */
export function paymentDue(invoiceDate: string, terms: Pick<ClientTerms, "days" | "net"> = DEFAULT_TERMS): string {
  const d = utc(invoiceDate);
  if (!terms.net) {
    d.setUTCDate(d.getUTCDate() + terms.days);
    return ymd(d);
  }
  // Months, not days: "31 Jan + 30" is 2 March and would push February a month late.
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1 + Math.ceil(terms.days / 30), NET_PAY_DAY)));
}

/**
 * When the invoice for a calendar month's hours is due to go out: the client's
 * invoice day in the FOLLOWING month (the period holding the month's last days
 * closes the day before it), clamped to that month's length; the 1st when the
 * client has none. NoTraffic (the 15th): October's hours → 15 Nov.
 */
export function invoiceDueFor(year: number, month: number, terms: Pick<ClientTerms, "invoiceDay"> = DEFAULT_TERMS): string {
  const day = terms.invoiceDay ?? 1;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); // the next month's length
  return ymd(new Date(Date.UTC(year, month, Math.min(day, last))));
}

/** "14 days" / "Net+30". */
export function termsLabel(terms: Pick<ClientTerms, "days" | "net">): string {
  return terms.net ? `Net+${terms.days}` : `${terms.days}-day`;
}

/**
 * The invoice day from the tracker's free-text `invoice_note`: a bare number or
 * an ordinal ("20th", "1st") — the tracker's `parseInvoiceDay`. Anything else
 * ("Net 30") is not a day, and reads as null.
 */
export function parseInvoiceDay(note: string | null | undefined): number | null {
  const m = String(note ?? "").trim().match(/^(\d{1,2})(st|nd|rd|th)?\b/i);
  if (!m) return null;
  if (!m[2] && String(note).trim() !== m[1]) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 31 ? n : null;
}

/** A `clients` row (selected as `*`, so missing columns are simply absent) → its terms. */
export function termsFromClientRow(r: { payment_terms_days?: unknown; payment_terms_net?: unknown; invoice_note?: unknown }): ClientTerms {
  return {
    days: r.payment_terms_days == null ? DEFAULT_TERMS_DAYS : Number(r.payment_terms_days),
    net: r.payment_terms_net === true,
    invoiceDay: parseInvoiceDay(r.invoice_note as string | null | undefined),
  };
}
