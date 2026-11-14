// Amount + VAT for one expense line — the pure half of the Expenses page's
// amount fields. What matters is the number WITHOUT VAT, so entering an amount
// is one switch: it either includes VAT (18% comes off) or it doesn't (counted
// as typed — a net amount, an exempt item, a dealer who charges none: the
// reason doesn't matter). Foreign currency never has VAT taken off.

import type { ExpenseRowDb } from "./db";
import { netIls, netOfVat, round2 } from "./finance";
import type { FxTable } from "./fx";

export interface AmountDraft {
  amount: string;
  currency: string;
  /** Does the typed shekel amount include VAT? Ignored for foreign currency. */
  withVat: boolean;
}

export const EMPTY_AMOUNT: AmountDraft = { amount: "", currency: "ILS", withVat: true };

export const yearOfDate = (date: string) => Number(date.slice(0, 4)) || new Date().getFullYear();
export const monthOfDate = (date: string) => Number(date.slice(5, 7)) || new Date().getMonth() + 1;

/** What a stored shekel row shows on its chip. "mixed" is display-only: a
 * receipt imported with its own net (some items taxed, some not). */
export function vatShapeOf(r: ExpenseRowDb): "incl" | "none" | "mixed" {
  const gross = Number(r.amount_gross);
  const net = r.amount_no_vat == null ? null : Number(r.amount_no_vat);
  if (!r.vat_included || (net != null && Math.abs(net - gross) < 0.005)) return "none";
  if (net == null || Math.abs(net - netOfVat(gross, yearOfDate(r.date))) <= 0.02) return "incl";
  return "mixed";
}

/** The editor's starting point for a stored row. A mixed receipt opens as its
 * net amount, "without VAT" — the number that counts, unchanged on save. */
export function amountDraftOf(r: ExpenseRowDb): AmountDraft {
  if (r.currency !== "ILS") return { amount: String(Number(r.amount_gross)), currency: r.currency, withVat: false };
  const shape = vatShapeOf(r);
  if (shape === "mixed") return { amount: String(Number(r.amount_no_vat)), currency: "ILS", withVat: false };
  return { amount: String(Number(r.amount_gross)), currency: "ILS", withVat: shape === "incl" };
}

/** The stored fields for a draft, or null while it isn't a valid amount yet.
 * For foreign currency amount_no_vat is a snapshot at the rate of the month
 * it's dated — the P&L re-converts at each month's own rate anyway. */
export function amountFieldsOf(
  d: AmountDraft,
  date: string,
  fx: FxTable | undefined,
): Pick<ExpenseRowDb, "amount_gross" | "amount_no_vat" | "currency" | "vat_included"> | null {
  const amount = Number(d.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const y = yearOfDate(date);
  if (d.currency !== "ILS") {
    const net = round2(netIls(amount, d.currency, false, y, { table: fx, month: monthOfDate(date) }));
    return { amount_gross: amount, amount_no_vat: net, currency: d.currency, vat_included: false };
  }
  return d.withVat
    ? { amount_gross: amount, amount_no_vat: round2(netOfVat(amount, y)), currency: "ILS", vat_included: true }
    : { amount_gross: amount, amount_no_vat: amount, currency: "ILS", vat_included: false };
}
