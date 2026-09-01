import { parseISO, shiftDays, toISODate } from "./format";

/**
 * Works out the billing period that should follow the last one a client has.
 *
 * ⚠️ WHY THIS EXISTS: nothing ever created the next period. They are hand-added
 * rows in `client_billing_periods`, so when the last one ended, hours kept logging
 * fine and the **Total and week columns stayed correct while the period breakdown
 * silently lost them** — a period bucket only counts entries inside its own
 * `date_from`…`date_to`. The report looked right and was incomplete, which is the
 * worst failure shape for something a client is invoiced from.
 *
 * ⚠️ PURE ON PURPOSE — no clock, no database. The caller passes `today`, which is
 * what makes the month-end and invoice-day edge cases testable at all.
 */

export type PeriodBounds = { label: string; dateFrom: string; dateTo: string };

/** Same shape the store already holds, narrowed to what this needs. */
export type LastPeriod = { dateFrom: string; dateTo: string };

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Days in a month, so an invoice day of 31 does not fall off a 30-day month.
 * `new Date(y, m, 0)` is the last day of month `m`, 1-indexed.
 */
function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

/**
 * The first date on or after `from` that lands on `invoiceDay`.
 *
 * ⚠️ CLAMPED TO THE MONTH'S LENGTH. An invoice day of 31 in February must mean the
 * 28th (or 29th), not the 3rd of March — `new Date(2026, 1, 31)` silently rolls
 * over, and that rollover would shift every subsequent period by three days.
 */
export function nextInvoiceDate(from: string, invoiceDay: number): string {
  const start = parseISO(from);
  let y = start.getFullYear();
  let m = start.getMonth();
  for (let i = 0; i < 3; i++) {
    const day = Math.min(invoiceDay, daysInMonth(y, m));
    const candidate = new Date(y, m, day);
    if (toISODate(candidate) >= from) return toISODate(candidate);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  // Unreachable for any 1–31 day, but a wrong date beats a thrown error on a page
  // an admin is trying to use.
  return from;
}

/**
 * A month on from `from`, ending the day before the same day-of-month recurs.
 *
 * ⚠️ Anchored to `from`'s OWN day-of-month and clamped, so a period starting on
 * the 31st gives a sane end rather than skipping a month.
 */
function oneMonthFrom(from: string): string {
  const start = parseISO(from);
  let y = start.getFullYear();
  let m = start.getMonth() + 1;
  if (m > 11) {
    m = 0;
    y += 1;
  }
  const day = Math.min(start.getDate(), daysInMonth(y, m));
  return toISODate(shiftDays(new Date(y, m, day), -1));
}

/** `September 2026`, or `5/9 → 4/10` when the period straddles two months. */
export function periodLabel(dateFrom: string, dateTo: string): string {
  const a = parseISO(dateFrom);
  const b = parseISO(dateTo);
  // A period covering one whole calendar month is named after it — the common case
  // when the invoice day is the 1st.
  const wholeMonth =
    a.getDate() === 1 &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear() &&
    b.getDate() === daysInMonth(b.getFullYear(), b.getMonth());
  if (wholeMonth) return `${MONTH_NAMES[a.getMonth()]} ${a.getFullYear()}`;
  return `${a.getDate()}/${a.getMonth() + 1} → ${b.getDate()}/${b.getMonth() + 1}`;
}

/**
 * The next period after `last`, or `null` if none is due yet.
 *
 * ⚠️ RETURNS NULL UNTIL THE LAST PERIOD HAS ACTUALLY ENDED. Creating the next one
 * while the current is still running would put two open periods on a client and
 * split a week's hours across them.
 *
 * `invoiceDay` (1–31) aligns the new period to the client's invoicing cycle: it
 * runs from the day after `last.dateTo` to the day before the next invoice date.
 * Without one it simply runs a calendar month.
 */
export function nextPeriod(
  last: LastPeriod,
  invoiceDay: number | null | undefined,
  today: Date,
): PeriodBounds | null {
  const todayIso = toISODate(today);
  if (last.dateTo >= todayIso) return null;

  const dateFrom = toISODate(shiftDays(parseISO(last.dateTo), 1));
  // ⚠️ Guard against a period that ended so long ago the "next" one is also in the
  // past. One period at a time: the caller can run again tomorrow, and a silent
  // burst of six backfilled periods is not something to do to a client's report
  // without being asked.
  let dateTo: string;
  if (invoiceDay && invoiceDay >= 1 && invoiceDay <= 31) {
    const invoice = nextInvoiceDate(dateFrom, invoiceDay);
    // If the next invoice date IS the start, the cycle ends a month later.
    dateTo =
      invoice > dateFrom
        ? toISODate(shiftDays(parseISO(invoice), -1))
        : oneMonthFrom(dateFrom);
  } else {
    dateTo = oneMonthFrom(dateFrom);
  }
  if (dateTo < dateFrom) return null;
  return { label: periodLabel(dateFrom, dateTo), dateFrom, dateTo };
}

/**
 * What to STORE for a typed invoice day: `""` clears it, 1–31 stores that number,
 * and anything else returns null meaning "refuse, leave the field as it was".
 *
 * ⚠️⚠️ REFUSED RATHER THAN COERCED, and the field it guards is the reason.
 * `Number("")` is 0 and `parseInt("30 days")` is 30 — either would put a day nobody
 * chose into the value the ROLLOVER aligns every new billing period to, and a wrong
 * period boundary moves hours between invoices without anything looking broken.
 *
 * ⚠️ 1–31, not 1–28: `nextInvoiceDate` clamps a 31st into a short month, which is
 * what a client billed on the 31st actually wants.
 *
 * ⚠️ It writes a BARE NUMBER ("20", not "20th") — Nitsan made the field numeric on
 * 2026-09-01. `parseInvoiceDay` below still reads the old ordinals, because the
 * stored values stay as they are until each one is edited or normalised by hand.
 */
export function invoiceDayToStore(raw: string): string | null {
  const v = raw.trim();
  if (v === "") return "";
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 31) return null;
  return String(n);
}

/**
 * Reads a day-of-month out of the client's free-text "Invoice day".
 *
 * ⚠️⚠️ THE FIELD ALREADY EXISTED AND IS FREE TEXT — `clients.invoice_note` from
 * migration 0010, edited on the Client Reports panel as "Invoice day" with the
 * placeholder "e.g. 15th". Nitsan meant THAT field ("= invoice day"), so this
 * parses it rather than introducing a second, numeric one: two fields for one
 * concept is how they drift apart. Real values today: "20th", "1st", "20th".
 *
 * ⚠️ ANYTHING IT CANNOT READ RETURNS NULL, and null means "just run a calendar
 * month" — never a guess. "end of month", "on delivery" or a typo must not quietly
 * produce a period boundary nobody chose.
 *
 * ⚠️ Deliberately strict about RANGE: a bare number outside 1–31 is not a day of
 * the month, so "2026" or "45" is refused rather than clamped.
 */
export function parseInvoiceDay(note: string | null | undefined): number | null {
  if (!note) return null;
  /**
   * ⚠️⚠️ A NUMBER IN RANGE IS NOT ENOUGH — IT MUST LOOK LIKE A DAY OF THE MONTH.
   * This field was a FREE-TEXT NOTE from migration 0010 until v1.42.0 gave it
   * meaning, so it can hold anything anyone has ever typed about invoicing. A bare
   * range check reads **"Net 30"** and **"30 days from invoice"** as the 30th and
   * silently re-aligns every future billing period on that client, with nothing in
   * the UI reporting that a day was inferred from payment terms.
   *
   * So a value is a day only when the digits are the WHOLE value ("5", "28") or
   * carry an ordinal suffix ("20th", "1st of the month"). Everything else is
   * `null`, which means a plain calendar month — the documented fallback.
   *
   * ⚠️ The suffix must be checked WITHOUT a leading `\b`: in "20th" there is no
   * word boundary between the `0` and the `t`, which is the bug that made an
   * earlier `\b(\d{1,2})\b` read nothing at all from the real data.
   */
  const trimmed = note.trim();
  const m = trimmed.match(/(\d+)/);
  if (!m) return null;
  const digits = m[1];
  const isWholeValue = trimmed === digits;
  // Anchored at the matched run rather than built from it: a pattern interpolated
  // from `digits` cannot be read on its own, and it would also match an ordinal on
  // some OTHER occurrence of the same digits later in the note.
  const hasOrdinalSuffix = /^\d+(?:st|nd|rd|th)\b/i.test(trimmed.slice(m.index));
  if (!isWholeValue && !hasOrdinalSuffix) return null;
  const n = Number(digits);
  if (!Number.isInteger(n) || n < 1 || n > 31) return null;
  return n;
}
