import { DEFAULT_CLIENT_TERMS, DEFAULT_PAYMENT_TERMS_DAYS, invoiceDueFor, paymentDue, termsAdjective, type ClientTerms } from "@/lib/payment-terms";
import { NON_BILLABLE_CLIENT_CANON, round2, stepOf, vatRate, type ClientMonthly, type FinanceState } from "@/lib/finance/finance";
import { studioDay } from "@/lib/finance/format";

/**
 * What clients owe the studio (Nitsan, 2026-10-31: "a list of who owes what"):
 * the Plan's income cells that are final — checked and locked — and not
 * marked paid. A client's hours month is one line (its sub-accounts summed),
 * as is a project's month. Amounts are before VAT, as the Plan books them;
 * `withVat` is what the invoice asks for.
 *
 * Due date (lib/payment-terms.ts, the tracker's rule): an invoiced line is due
 * on its CLIENT's terms after its invoice — 14 days, or Maccabi's net+30 (paid
 * by the 5th of the month after next). A line not invoiced yet counts from when
 * its invoice was due to go out — the client's invoice day in the following
 * month — so a month left uninvoiced shows as late too, which is the point.
 * Projects have no client terms: 14 days, from the month's last day until
 * invoiced. A client the map doesn't know gets the usual 14 and the 1st.
 */

/** The studio's usual terms — the tracker's `DEFAULT_PAYMENT_TERMS_DAYS`. */
export const RECEIVABLE_TERMS_DAYS = DEFAULT_PAYMENT_TERMS_DAYS;

/** A client's terms by its id and by its name (the Plan's canon). */
export type TermsByClient = Map<string, ClientTerms>;

export interface Receivable {
  kind: "hours" | "project";
  name: string;
  year: number;
  month: number;
  /** before VAT */
  amount: number;
  withVat: number;
  step: "final" | "invoiced";
  invoicedAt: string | null;
  due: string;
  /** the terms `due` was counted with: "14-day" / "Net+30" */
  termsLabel: string;
  /** days past `due` (≤ 0 = not due yet) */
  daysLate: number;
}

export interface IncomeLike {
  date: string;
  description: string;
  amount: number | string;
  state: FinanceState;
  paid_at?: string | null;
  invoiced_at?: string | null;
}

const lastDay = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

interface Group {
  kind: Receivable["kind"];
  name: string;
  year: number;
  month: number;
  amount: number;
  /** an hours line's client terms; null = a project (14 days, no invoice day) */
  terms: ClientTerms | null;
  /** every row final and unpaid — a part paid or not final leaves the line out */
  open: boolean;
  invoicedAt: string | null;
  allInvoiced: boolean;
}

export function receivables(
  clientMonthly: ClientMonthly[],
  income: IncomeLike[],
  today: string,
  terms: TermsByClient = new Map(),
): Receivable[] {
  const groups = new Map<string, Group>();
  const add = (g: Omit<Group, "open" | "allInvoiced" | "invoicedAt">, state: FinanceState, paidAt: string | null, invoicedAt: string | null) => {
    const key = `${g.kind}|${g.name}|${g.year}|${g.month}`;
    const cur = groups.get(key) ?? { ...g, amount: 0, open: true, invoicedAt: null, allInvoiced: true };
    const step = stepOf(state, paidAt, invoicedAt);
    cur.amount += g.amount;
    cur.open &&= step === "final" || step === "invoiced";
    cur.allInvoiced &&= step === "invoiced";
    // The latest invoice date among the rows: the line is due from the last one sent.
    if (invoicedAt && (!cur.invoicedAt || invoicedAt > cur.invoicedAt)) cur.invoicedAt = invoicedAt;
    groups.set(key, cur);
  };
  for (const r of clientMonthly) {
    if (r.clientCanon === NON_BILLABLE_CLIENT_CANON) continue;
    const t = (r.clientId ? terms.get(r.clientId) : undefined) ?? terms.get(r.clientCanon) ?? DEFAULT_CLIENT_TERMS;
    add({ kind: "hours", name: r.clientCanon, year: r.year, month: r.month, amount: r.revenueGross || 0, terms: t }, r.state, r.paidAt ?? null, r.invoicedAt ?? null);
  }
  for (const r of income) {
    const [y, m] = r.date.split("-").map(Number);
    add({ kind: "project", name: r.description || "Untitled project", year: y, month: m, amount: Number(r.amount) || 0, terms: null }, r.state, r.paid_at ?? null, r.invoiced_at ?? null);
  }
  const out: Receivable[] = [];
  for (const g of groups.values()) {
    if (!g.open || g.amount <= 0) continue;
    const invoiced = g.allInvoiced && g.invoicedAt != null;
    const t = g.terms ?? DEFAULT_CLIENT_TERMS;
    // The invoice's studio day: sliced, one marked 00:00–03:00 in Tel Aviv
    // counted from the day before, and fell due a day early.
    const from = invoiced ? studioDay(g.invoicedAt!) : g.terms ? invoiceDueFor(g.year, g.month, g.terms) : lastDay(g.year, g.month);
    const due = paymentDue(from, t);
    out.push({
      kind: g.kind,
      name: g.name,
      year: g.year,
      month: g.month,
      amount: round2(g.amount),
      withVat: round2(g.amount * (1 + vatRate(g.year))),
      step: invoiced ? "invoiced" : "final",
      invoicedAt: invoiced ? g.invoicedAt : null,
      due,
      termsLabel: termsAdjective(t),
      daysLate: daysBetween(due, today),
    });
  }
  // Most overdue first.
  return out.sort((a, b) => b.daysLate - a.daysLate || a.name.localeCompare(b.name));
}
