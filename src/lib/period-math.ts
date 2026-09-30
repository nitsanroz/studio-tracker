// Date/bucket arithmetic for the home page's period selector and charts.
//
// Extracted from the home page (now `components/dashboard/`) so it can be tested
// without rendering the app.
// Every function that needs the current date takes `now` as its last argument,
// defaulting to `new Date()` — same pattern as `presetRange` in date-ranges.ts.
// That default is the only reason these were untestable before, and the working
// log records two boundary bugs here that were caught by eye rather than by a
// test: the `<` vs `<=` on the period end, and the last-bucket projection.

import { parseISO, shiftDays, startOfWeek, toISODate } from "./format";

export const HOME_RANGES = ["This week", "This month", "This year", "All time"] as const;
export type HomeRange = (typeof HOME_RANGES)[number];

/**
 * Quarters exist for the team page only, which had its own inline quarter maths
 * before this. Deliberately NOT added to HOME_RANGES: that array drives the
 * admin home's pill row, so appending to it grows a control nobody asked to grow.
 */
export const TEAM_RANGES = [
  "This week",
  "This month",
  "This quarter",
  "This year",
  "All time",
] as const;
export type PeriodKey = HomeRange | "This quarter";

/** Reports steps through periods too, but "All time" would pull every entry ever. */
export const REPORT_RANGES = ["This week", "This month", "This year"] as const;

export const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** whole calendar days from a → b (both floored to local midnight) */
export function daysBetween(a: Date, b: Date): number {
  const ms =
    new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() -
    new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  return Math.round(ms / 86_400_000);
}

/** Full calendar bounds of a period, `offset` steps from the current one
 *  (0 = current, −1 = previous, …). null for "All time". */
export function periodBounds(
  rangeKey: PeriodKey,
  offset: number,
  now: Date = new Date(),
): { start: Date; end: Date } | null {
  switch (rangeKey) {
    case "This week": {
      const start = shiftDays(startOfWeek(now), offset * 7);
      return { start, end: shiftDays(start, 6) };
    }
    case "This month":
      return {
        start: new Date(now.getFullYear(), now.getMonth() + offset, 1),
        end: new Date(now.getFullYear(), now.getMonth() + offset + 1, 0),
      };
    case "This quarter": {
      // month arithmetic normalises overflow, so offset −1 from Q1 lands on the
      // previous year's Q4 without any special-casing
      const q = Math.floor(now.getMonth() / 3) + offset;
      return {
        start: new Date(now.getFullYear(), q * 3, 1),
        end: new Date(now.getFullYear(), q * 3 + 3, 0),
      };
    }
    case "This year":
      return {
        start: new Date(now.getFullYear() + offset, 0, 1),
        end: new Date(now.getFullYear() + offset, 11, 31),
      };
    default:
      return null; // All time
  }
}

/** Human label for the selected period, e.g. "This month", "Last week", "March", "2025". */
export function rangeLabel(rangeKey: PeriodKey, offset: number, now: Date = new Date()): string {
  if (rangeKey === "All time") return "All time";
  if (offset === 0) return rangeKey;
  if (offset === -1)
    return rangeKey === "This week"
      ? "Last week"
      : rangeKey === "This month"
        ? "Last month"
        : rangeKey === "This quarter"
          ? "Last quarter"
          : "Last year";
  const b = periodBounds(rangeKey, offset, now)!;
  if (rangeKey === "This week") {
    return `${b.start.getDate()}/${b.start.getMonth() + 1}–${b.end.getDate()}/${b.end.getMonth() + 1}`;
  }
  if (rangeKey === "This month") {
    const m = MONTH_SHORT[b.start.getMonth()];
    return b.start.getFullYear() === now.getFullYear() ? m : `${m} ${b.start.getFullYear()}`;
  }
  if (rangeKey === "This quarter") {
    const q = `Q${Math.floor(b.start.getMonth() / 3) + 1}`;
    return b.start.getFullYear() === now.getFullYear() ? q : `${q} ${b.start.getFullYear()}`;
  }
  return String(b.start.getFullYear());
}

/** `periodBounds` as ISO strings, which is the shape every page's filter wants. */
export function periodRange(
  rangeKey: PeriodKey,
  offset: number,
  now: Date = new Date(),
): { from: string; to: string } | null {
  const b = periodBounds(rangeKey, offset, now);
  return b ? { from: toISODate(b.start), to: toISODate(b.end) } : null;
}

/**
 * The comparable previous range for the "vs last period" delta. When the
 * selected period is still ongoing (partial), the previous range is truncated
 * to the SAME elapsed portion — e.g. this month up to the 15th compares against
 * last month up to the 15th, not the whole of last month.
 */
export function comparablePrevRange(
  rangeKey: PeriodKey,
  offset: number,
  now: Date = new Date(),
): { from: string; to: string } | null {
  const sel = periodBounds(rangeKey, offset, now);
  const prev = periodBounds(rangeKey, offset - 1, now);
  if (!sel || !prev) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let prevEnd = prev.end;
  // `<=` on the end: on the last day of the period it is still running, and
  // comparing a part-day against a whole previous period reads as a collapse
  const ongoing = today >= sel.start && today <= sel.end;
  if (ongoing) {
    const candidate = shiftDays(prev.start, daysBetween(sel.start, today));
    if (candidate < prevEnd) prevEnd = candidate;
  }
  return { from: toISODate(prev.start), to: toISODate(prevEnd) };
}

/** Period-adaptive time buckets: day (≤31d SPAN), else month (≤24), else year. */
export function bucketize(dates: string[], hasRange: boolean) {
  /**
   * ⚠️ THE SPAN THE DATES COVER, NOT HOW MANY OF THEM THERE ARE. This counted
   * `new Set(dates).size`, i.e. only the days that HAVE hours — so a 90-day range
   * worked on 12 scattered days took the day branch and drew 12 evenly spaced
   * bars across three months. Adjacent bars could be a day apart or five weeks
   * apart with nothing showing the gap, so the axis was not linear in time and
   * the trend read off it was not real.
   */
  const span =
    dates.length === 0
      ? 0
      : daysBetween(parseISO(dates.reduce((a, b) => (b < a ? b : a))),
                    parseISO(dates.reduce((a, b) => (b > a ? b : a)))) + 1;
  const byDay = hasRange && span > 0 && span <= 31;
  const byMonth = !byDay && new Set(dates.map((d) => d.slice(0, 7))).size <= 24;
  // Up to 24 months is up to THREE calendar years, and a bare "Jan" twice on one
  // axis names nothing — the chart has no per-point tooltip to fall back on. Same
  // reasoning, and the same fix, as the month chart on the client-reports page.
  const multiYear = new Set(dates.map((d) => d.slice(0, 4))).size > 1;
  const keyFor = (date: string) => (byDay ? date : byMonth ? date.slice(0, 7) : date.slice(0, 4));
  const labelFor = (key: string) =>
    byDay
      ? key.slice(8).replace(/^0/, "") + "/" + key.slice(5, 7).replace(/^0/, "")
      : byMonth
        ? MONTH_SHORT[Number(key.slice(5, 7)) - 1] + (multiYear ? ` ${key.slice(2, 4)}` : "")
        : key;
  const unit: "day" | "month" | "year" = byDay ? "day" : byMonth ? "month" : "year";
  return { keyFor, labelFor, unit };
}

/**
 * A period must be at least a FIFTH gone before its bucket is projected.
 *
 * ⚠️ THE ONLY GUARD USED TO BE `elapsed > 0`, WHICH LET DAY ONE THROUGH. On the 1st
 * of a month that made the factor the month's length — a normal 27h day drew August
 * at 837h against a real ~600h month, and a heavy 40h day drew 1240h. Because the
 * chart scales to its largest value, one meaningless bar squashed every real one
 * beside it. On 1 January the year factor was 365.
 *
 * A fifth caps the factor at 5, so the bar can still be read against completed
 * periods without inventing most of it. The cost is honest and deliberate: for the
 * first ~6 days of a month, and until mid-March for a year, there is no projection
 * and the bucket is drawn as the partial thing it is. A visibly short bar is a
 * better lie than a confident wrong one.
 */
const MIN_ELAPSED_FRACTION = 0.2;

function scaleFrom(elapsed: number, total: number): number | null {
  if (elapsed <= 0 || elapsed >= total) return null;
  if (elapsed / total < MIN_ELAPSED_FRACTION) return null;
  return total / elapsed;
}

/**
 * How much to scale the LAST bucket by so it reads as a full period.
 *
 * Every bucket on these charts is a completed month or year except, usually, the
 * one on the right: comparing 12 logged days of July against the whole of June
 * makes the studio look like it fell off a cliff. So the running bucket is
 * projected at the rate logged so far and drawn dashed.
 *
 * Returns null when there's nothing to project — the bucket is already complete,
 * or the buckets are single days (a day is either over or it's today, and
 * scaling "today" by the hours left in the evening is noise, not a forecast).
 */
export function bucketProjection(
  unit: "day" | "month" | "year",
  lastKey: string,
  now: Date = new Date(),
): number | null {
  if (unit === "day") return null;
  if (unit === "month") {
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (lastKey !== cur) return null;
    const elapsed = now.getDate();
    const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return scaleFrom(elapsed, total);
  }
  if (lastKey !== String(now.getFullYear())) return null;
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const elapsed = daysBetween(jan1, now) + 1;
  const total = daysBetween(jan1, new Date(now.getFullYear(), 11, 31)) + 1;
  return scaleFrom(elapsed, total);
}

/**
 * How many days of a billing period the report on screen actually COVERS —
 * inclusive of both ends, and cut short by `asOf` when the report stops mid-period.
 *
 * ⚠️⚠️ THIS REPLACED "days left to period" IN v1.43.1, AND THE DIFFERENCE IS THE
 * POINT. Nitsan: *"change title of 'days left to period' to 'days in period' to
 * state how many days shown here (if its middle of month show only days of that
 * half not what defined in the period)"*. A client reading a report cut on the 10th
 * of a calendar-month period is looking at 10 days of work, not 30 — the figure now
 * describes the DATA IN FRONT OF THEM rather than the calendar the studio bills on.
 * That is also why it beats "days left": on a past period, days-left was always 0,
 * so the figure said nothing at all on every report but the newest.
 *
 * ⚠️⚠️ `asOf` IS NOT OPTIONAL AND MUST NOT BECOME `new Date()` BY DEFAULT. This
 * backs a figure on the CLIENT'S published report, where every other number comes
 * from a frozen snapshot. Measuring from the clock made the old version the one
 * figure that kept moving after publishing — a report scoped through Saturday read
 * "6 days left" on Sunday and "4 days left" on Tuesday against hours that had not
 * changed. Pass the report's cut-off (`report_links.through_date`), or its publish
 * day for links that predate that column.
 *
 * ⚠️ INCLUSIVE: a period of 1–31 August read in full is 31 days, not 30. The `+ 1`
 * is the difference between "days covered" and "days elapsed", and dropping it
 * makes a one-day period read 0.
 *
 * ⚠️ A period that has not started by `asOf` reads 0 rather than a negative count.
 *
 * ⚠️ Built on `daysBetween`, which floors both dates to local midnight and rounds
 * — never `(end - start) / 86_400_000`, which is an hour short across a clocks
 * change and lands on the wrong calendar day (the arithmetic v1.23.0 deleted).
 */
export function daysCoveredInPeriod(periodStart: Date, periodEnd: Date, asOf: Date): number {
  const last = asOf < periodEnd ? asOf : periodEnd;
  return Math.max(0, daysBetween(periodStart, last) + 1);
}

/**
 * The end of the last COMPLETE week (a Saturday), as an ISO date.
 *
 * ⚠️ Built on `startOfWeek` + `shiftDays`, never ms arithmetic — the trap v1.23.0
 * deleted from this app. `asOf` is a REQUIRED argument for the reason
 * `daysCoveredInPeriod` states: a default of `new Date()` is the bug.
 */
export function lastCompleteWeekEnd(asOf: Date): string {
  return toISODate(shiftDays(startOfWeek(asOf), -1));
}

/**
 * Has a remembered report cut-off fallen behind the week being reported?
 *
 * ⚠️⚠️ THIS EXISTS BECAUSE A REMEMBERED DATE DECAYS SILENTLY. `client-reports`
 * adopts `report_links.through_date` so a client billed to the 20th keeps that
 * cut-off across republishes — but the ordinary case is the Sunday weekly
 * summary, where the cut-off must ADVANCE. Anchor sat at 22 Aug while the week
 * ending 29 Aug was about to be published, and every figure in that report would
 * have agreed with every other while omitting the week it claimed to cover.
 *
 * ⚠️ It reports, it does not correct. `max(stored, thisWeek)` would drag a
 * deliberate 20th-of-the-month cut-off forward and break the case the memory
 * exists for, so the UI shows the difference and offers one click instead.
 */
export function cutoffIsStale(through: string | null | undefined, asOf: Date): boolean {
  if (!through) return false; // blank means "everything", which is never stale
  return through < lastCompleteWeekEnd(asOf);
}

/**
 * How much of a period a person was part of the studio, 0–1 — the denominator
 * for "average hours per member".
 *
 * A designer who joined on the 20th, or left on the 10th, did not have a whole
 * month to log hours in, and dividing the studio's total by a head count that
 * treats them as a full member understates everybody else (Nitsan, 2026-09-30:
 * "would expect to include only part of the month if the start/end date of a
 * designer falls in that month").
 *
 * ⚠️⚠️ THE DECLARED DATES CANNOT BE TRUSTED ON THEIR OWN, and the real data is
 * why. Measured 2026-09-30: of 49 archived profiles, **47 have no end date and
 * 21 of the 25 with an account have no start date** — the end dates are being
 * filled in by hand later (0020). So a rule that read only `start_date` and
 * `end_date` would treat nearly every former member as present for the whole
 * period. The window is therefore built from what is DECLARED where it exists
 * and from what was LOGGED where it does not:
 *
 *   • start — the declared start, else the period's start for someone still
 *     here, else their first entry in the period.
 *   • end — the declared end, else the period's end for someone still here,
 *     else their last entry in the period.
 *   • and the window is always WIDENED to cover every entry they logged, so a
 *     start date that is wrong in the future cannot leave hours in the total
 *     with no time in the denominator.
 *
 * ⚠️ The last-entry fallback is a LOWER BOUND on when somebody left — a former
 * member who logged nothing in their final fortnight reads as having left a
 * fortnight earlier. That biases the average slightly up, is bounded by how
 * often people log, and disappears the day their end date is entered.
 *
 * ⚠️ The period is cut at `asOf`: mid-month, everybody has had fifteen days to
 * log, not thirty, and a designer who left on the 10th was there for 10 of those
 * 15 rather than 10 of 30. Without the cut the current period would flatter
 * every departure.
 *
 * ⚠️ Calendar days, not working days. The studio week is Sun–Thu, so the two
 * agree closely over anything longer than a week, and a start date on a Friday
 * should not be a special case.
 *
 * Returns 1 when there is no period to prorate over (All time, or a period that
 * has not begun) — the caller passes no `from`/`to` for All time.
 */
export function presenceFraction(o: {
  from: string;
  to: string;
  /** Today. Required: a default of `new Date()` is the bug (see `daysCoveredInPeriod`). */
  asOf: string;
  startDate: string | null;
  endDate: string | null;
  /** Their earliest / latest entry INSIDE the period, or null if they logged nothing in it. */
  firstEntry: string | null;
  lastEntry: string | null;
  /** Still a current member — an open-ended window rather than one bounded by activity. */
  active: boolean;
}): number {
  const periodEnd = o.to < o.asOf ? o.to : o.asOf;
  if (periodEnd < o.from) return 1;
  const periodDays = daysBetween(parseISO(o.from), parseISO(periodEnd)) + 1;

  let start = o.startDate ?? (o.active ? o.from : (o.firstEntry ?? o.from));
  let end = o.endDate ?? (o.active ? periodEnd : (o.lastEntry ?? periodEnd));
  if (o.firstEntry && o.firstEntry < start) start = o.firstEntry;
  if (o.lastEntry && o.lastEntry > end) end = o.lastEntry;

  if (start < o.from) start = o.from;
  if (end > periodEnd) end = periodEnd;
  if (end < start) return 0;

  const days = daysBetween(parseISO(start), parseISO(end)) + 1;
  return Math.min(1, days / periodDays);
}
