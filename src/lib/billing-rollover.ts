import { shiftDays, toISODate } from "./format";

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

/** `YYYY-MM-DD` → a LOCAL date at midnight, matching `parseISO` elsewhere. */
function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

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
  const start = parse(from);
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
  const start = parse(from);
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
  const a = parse(dateFrom);
  const b = parse(dateTo);
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

  const dateFrom = toISODate(shiftDays(parse(last.dateTo), 1));
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
        ? toISODate(shiftDays(parse(invoice), -1))
        : oneMonthFrom(dateFrom);
  } else {
    dateTo = oneMonthFrom(dateFrom);
  }
  if (dateTo < dateFrom) return null;
  return { label: periodLabel(dateFrom, dateTo), dateFrom, dateTo };
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
   * The first RUN OF DIGITS, however long, then range-checked.
   *
   * ⚠️ NOT `\b(\d{1,2})\b`, which was my first attempt and silently read NOTHING
   * from the real data: in "20th" there is no word boundary between the `0` and the
   * `t`, so the match failed on every ordinal — which is every value in use.
   * ⚠️ Matching the whole run is also what makes "2026" safe: it parses as 2026 and
   * fails the range check, where a 1–2 digit match would have taken "20" from it.
   */
  const m = note.trim().match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > 31) return null;
  return n;
}
