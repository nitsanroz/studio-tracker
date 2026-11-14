// Rent tab bills from the mail (v1.24.0, Nitsan 2026-11-09: "import and scan
// invoices and mails for the rent tab — adapt it to the semi-auto approach").
// The Rent tab is a grid: one line per cost of the place (rent, arnona,
// electricity…) × 12 months, each cell a `rent` expense row on the 15th.
// A bill from one of these senders is suggested as that line's cell(s) — its
// two months for a bill that covers two — and once the grid already holds its
// amount, its files are simply put on the cell(s).
//
// ⚠️ PURE — no clock, no database.
//
// Nitsan's answers, 2026-11-09: Aluel's "חשבונית מרכזת" is the rent only; the
// electricity, arnona, water, Partner and insurance bills come by email to
// office@; two-month bills are split over their two months; the cleaner is
// paid in cash with no invoice (no mail to read); "קריניטי" is notebook
// printing, not Rent. ניצנה 20 is the owner's home building — never the studio's.

import { netOfVat } from "../finance";

export interface RentSource {
  /** the Rent line, as the grid names it */
  line: string;
  /** sender sites that bill this line */
  sites: string[];
  /** words that name this bill in a subject, from any sender */
  words: RegExp;
  /** months one bill covers */
  months: 1 | 2;
  /** a two-month bill for the period it starts (arnona), not the one just ended (electricity, water) */
  advance?: boolean;
  /**
   * The bill's total includes VAT (Nitsan, 2026-11-09: Aluel's rent invoice is
   * ₪15,506.74 + 18% = ₪18,297.95, and the grid holds it without VAT, like
   * every ₪ figure on Expenses). Arnona, the building fee and insurance carry none.
   */
  vat: boolean;
  /**
   * The bill is behind the supplier's login (Nitsan, 2026-11-09: "water
   * invoices are only via login… just the fact it arrived, then we need the
   * amount" — ₪113.6 without VAT for Aug+Sep): the email only says it's
   * ready, so no file is looked for and the amount is typed without VAT.
   */
  loginOnly?: { site: string; url: string };
}

export const RENT_SOURCES: RentSource[] = [
  { line: "שכירות", sites: ["aluel.co.il"], words: /חשבונית\s+מרכזת/, months: 1, vat: true },
  { line: "חשמל", sites: ["iec.co.il"], words: /חברת\s+החשמל|חשבון\s+(ה)?חשמל/, months: 2, vat: true },
  { line: "ארנונה", sites: ["tel-aviv.gov.il"], words: /ארנונה/, months: 2, advance: true, vat: false },
  { line: "מים", sites: ["meiavivim.co.il"], words: /מי\s+אביבים|חשבון\s+(ה)?מים/, months: 2, vat: false, loginOnly: { site: "Mei Avivim", url: "https://www.meiavivim.co.il" } },
  // Partner's monthly bill comes from partner.bill@partner.net.il ("…,החשבונית החודשית שלך מפרטנר") —
  // not partner.co.il, which the search used to look for (2026-11-09: none of 2026's was found).
  { line: "פרטנר", sites: ["partner.net.il", "partner.co.il"], words: /פרטנר/, months: 1, vat: true },
  { line: "ועד בית", sites: ["idan-shani.co.il"], words: /ו?ועד\s+(ה)?בית.*ניצנה\s*11|דמי\s+ו?ועד.*ניצנה\s*11/, months: 1, vat: false },
  { line: "ביטוח סטודיו", sites: [], words: /ביטוח\s+(עסק|בית\s+עסק|סטודיו|משרד)|פוליסת\s+ביטוח/, months: 1, vat: false },
];

/** A bill, an invoice, a receipt or a payment confirmation — not a newsletter or an outage notice. */
const BILL = /חשבון|חשבונית|קבלה|תשלום|תלוש|הודעת\s+חיוב|פוליסה|bill|invoice|receipt|payment/i;
/** The owner's home building: its building-fee confirmations are not the studio's (2026-11-09). */
const NOT_STUDIO = /ניצנה\s*20/;

/**
 * How far back Rent bills are looked for (Nitsan, 2026-11-09: "get the
 * invoices for all of 2026's rent months"): the start of the year — or the
 * receipts' own window when that reaches further (a January's December bills).
 */
export function rentSince(now: number, receiptDays: number): Date {
  const jan1 = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  return new Date(Math.min(jan1, now - receiptDays * 86_400_000));
}

/** The Gmail search for these bills (office@ gets them): the senders, or the words in a subject. */
export function rentQuery(days: number): string {
  const sites = RENT_SOURCES.flatMap((s) => s.sites);
  return `(from:(${sites.join(" OR ")}) OR subject:(ארנונה OR "חשבון חשמל" OR "חברת החשמל" OR "חשבון מים" OR "מי אביבים" OR "חשבונית מרכזת" OR פוליסה)) newer_than:${days}d -in:chats -in:sent -from:studionmore.com`;
}

const trim = (s: string) => s.trim().replace(/\s+/g, " ");

/**
 * The Rent line this email bills, or null: a sender the owner already filed
 * under a Rent line (`learned`), a known site with a bill word, or a bill
 * naming the line in its subject. `lines` = the Rent lines the grid has.
 */
export function rentLineOf(
  r: { domain: string; subject: string; key?: string },
  lines: string[] = [],
  learned: Record<string, string> = {},
): RentSource | null {
  if (NOT_STUDIO.test(r.subject)) return null;
  const have = new Set(lines.map(trim));
  const taught = r.key ? learned[r.key] : undefined;
  if (taught && have.has(trim(taught))) return RENT_SOURCES.find((s) => s.line === trim(taught)) ?? { line: trim(taught), sites: [], words: /$^/, months: 1, vat: true };
  if (!BILL.test(r.subject)) return null;
  return RENT_SOURCES.find((s) => s.sites.includes(r.domain)) ?? RENT_SOURCES.find((s) => s.words.test(r.subject)) ?? null;
}

const ym = (y: number, m: number) => {
  const t = y * 12 + (m - 1);
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

const HE_MONTH: Record<string, number> = { ינואר: 1, פברואר: 2, מרץ: 3, מרס: 3, אפריל: 4, מאי: 5, יוני: 6, יולי: 7, אוגוסט: 8, ספטמבר: 9, אוקטובר: 10, נובמבר: 11, דצמבר: 12 };

/**
 * "1/7/2026 - 31/8/2026", "07/2026-08/2026" → the months between; "לחודש מאי -
 * 2026" → May (the month a payment is FOR — 2026-11-09: Idan Shani's 98342
 * came on 17 April for May). Null when the text names none.
 */
export function periodIn(text: string): string[] | null {
  const named = new RegExp(`לחודש\\s+(${Object.keys(HE_MONTH).join("|")})\\s*-?\\s*(\\d{4})`).exec(text);
  if (named) return [ym(Number(named[2]), HE_MONTH[named[1]])];
  const full = /(\d{1,2})[./](\d{1,2})[./](\d{2,4})\s*(?:-|–|עד)\s*(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(text);
  const short = /\b(\d{1,2})[./](\d{4})\s*(?:-|–|עד)\s*(\d{1,2})[./](\d{4})\b/.exec(text);
  const yr = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
  let from: [number, number] | null = null;
  let to: [number, number] | null = null;
  if (full) [from, to] = [[yr(full[3]), Number(full[2])], [yr(full[6]), Number(full[5])]];
  else if (short) [from, to] = [[Number(short[2]), Number(short[1])], [Number(short[4]), Number(short[3])]];
  if (!from || !to || from[1] < 1 || from[1] > 12 || to[1] < 1 || to[1] > 12) return null;
  const n = to[0] * 12 + to[1] - (from[0] * 12 + from[1]);
  if (n < 0 || n > 1) return null;
  return n === 0 ? [ym(from[0], from[1])] : [ym(from[0], from[1]), ym(from[0], from[1] + 1)];
}

/**
 * The months a bill covers ("YYYY-MM"): a period its subject names, else its
 * own month for a monthly bill; a two-month bill takes the pair the line's
 * cells already use (Jan–Feb or Feb–Mar, from equal neighbours in the grid,
 * Jan–Feb when there are none) — the pair it falls in when billed ahead
 * (arnona), else the pair before (electricity, water: billed after).
 */
/**
 * The two months a bill's period mostly covers: IEC's "לתקופה - 08/09/2026 - 30/06/2026" (either order)
 * is July–August — its one day in June doesn't count (Nitsan, 2026-11-09: each bill is its period's pair).
 * Null when the text names no such range (up to ~4 months).
 */
export function periodPair(text: string): string[] | null {
  const m = /(\d{1,2})[./](\d{1,2})[./](\d{2,4})\s*(?:-|–|עד)\s*(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(text);
  if (!m) return null;
  const yr = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
  const at = [Date.UTC(yr(m[3]), Number(m[2]) - 1, Number(m[1])), Date.UTC(yr(m[6]), Number(m[5]) - 1, Number(m[4]))];
  if (at.some(Number.isNaN)) return null;
  const [from, to] = [Math.min(...at), Math.max(...at)];
  if (to - from > 125 * 86_400_000) return null;
  const days = new Map<string, number>();
  for (let t = from; t <= to; t += 86_400_000) {
    const d = new Date(t);
    const k = ym(d.getUTCFullYear(), d.getUTCMonth() + 1);
    days.set(k, (days.get(k) ?? 0) + 1);
  }
  const keys = [...days.keys()].sort();
  let best: string[] | null = null;
  let most = -1;
  for (let i = 0; i < keys.length; i++) {
    const [y, mo] = keys[i].split("-").map(Number);
    const pair = [keys[i], ym(y, mo + 1)];
    const n = (days.get(pair[0]) ?? 0) + (days.get(pair[1]) ?? 0);
    if (n > most) [best, most] = [pair, n];
  }
  return best;
}

/** The months a bill's own text names: "לחודש מאי - 2026", a one-month range, or a two-month bill's period. */
export function billPeriod(src: RentSource, text: string): string[] | null {
  const named = periodIn(text);
  if (named && named.length === src.months) return named;
  return src.months === 2 ? periodPair(text) : null;
}

export function rentMonthsFor(src: RentSource, billDate: string, subject: string, lineCells: { date: string; gross: number }[] = []): string[] {
  const named = billPeriod(src, subject);
  if (named) return named;
  const y = Number(billDate.slice(0, 4));
  const m = Number(billDate.slice(5, 7));
  if (src.months === 1) return [ym(y, m)];
  // Which months start a pair: neighbours with the same amount.
  const byMonth = new Map(lineCells.map((c) => [c.date.slice(0, 7), c.gross]));
  let odd = 0;
  let even = 0;
  for (const [k, v] of byMonth) {
    const [ky, km] = k.split("-").map(Number);
    const next = byMonth.get(ym(ky, km + 1));
    if (next != null && Math.abs(next - v) < 0.01 && km % 12 !== 0) {
      if (km % 2 === 1) odd++;
      else even++;
    }
  }
  const startsOdd = odd >= even;
  const back = (m % 2 === 1) === startsOdd ? 0 : 1;
  const start = m - back - (src.advance ? 0 : 2);
  return [ym(y, start), ym(y, start + 1)];
}

/** What the grid holds for a bill: its amount without VAT when the total includes it (VAT of the first month's year). */
export function rentNet(amount: number, withVat: boolean, month: string): number {
  return withVat ? Math.round(netOfVat(amount, Number(month.slice(0, 4))) * 100) / 100 : amount;
}

/**
 * A payment confirmation for a login-only bill from someone else (Milgam's
 * "אישור תשלום מי אביבים"): the bill itself came from the supplier, so this
 * one is left out — it would be the same months twice.
 */
export function isPaymentNotice(src: RentSource, r: { domain: string; subject: string }): boolean {
  return !!src.loginOnly && !src.sites.includes(r.domain) && /אישור\s+תשלום|payment\s+(confirmation|received)/i.test(r.subject);
}

/**
 * The months whose cells already hold this bill (2026-11-09: the sheet books
 * an electricity bill into an earlier pair than its own period — May 12's
 * bill is Jan–Feb's 383.08). The latest run of months, starting no later than
 * the bill, whose cells each hold their part within ₪1; null when none do.
 */
export function monthsHolding(cells: { date: string; gross: number }[], parts: number[], billDate: string): string[] | null {
  const at = new Map<string, number>();
  for (const c of cells) at.set(c.date.slice(0, 7), (at.get(c.date.slice(0, 7)) ?? 0) + c.gross);
  const starts = [...at.keys()].filter((k) => k <= billDate.slice(0, 7)).sort().reverse();
  for (const k of starts) {
    const [y, m] = k.split("-").map(Number);
    const months = parts.map((_, i) => ym(y, m + i));
    if (months.every((mm, i) => at.has(mm) && Math.abs(at.get(mm)! - parts[i]) <= 1)) return months;
  }
  return null;
}

/**
 * A one-month line paid for several months at once (2026-11-09: Idan Shani's
 * 98336 was ₪597 "for April" — 3 × the ₪199 fee, February–April): when the
 * amount is a whole number (2–12) of the line's usual month — its latest
 * booked cell up to that month — the months ending at the one the bill names.
 * Null when it's one month's worth, or no whole number of them.
 */
export function monthsPaid(net: number, cells: { date: string; gross: number; state?: string }[], month: string): string[] | null {
  const usual = cells
    .filter((c) => c.date.slice(0, 7) <= month && c.state !== "predicted" && c.gross > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.gross;
  if (!usual) return null;
  const k = Math.round(net / usual);
  if (k < 2 || k > 12 || Math.abs(net - k * usual) > 1) return null;
  const [y, m] = month.split("-").map(Number);
  return Array.from({ length: k }, (_, i) => ym(y, m - (k - 1) + i));
}

/** Split a bill over its months: equal parts, the last carries the rounding. */
export function splitBill(amount: number, months: number): number[] {
  const part = Math.round((amount / months) * 100) / 100;
  return Array.from({ length: months }, (_, i) => (i < months - 1 ? part : Math.round((amount - part * (months - 1)) * 100) / 100));
}
