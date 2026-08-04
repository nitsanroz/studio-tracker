// Date/bucket arithmetic for the home page's period selector and charts.
//
// Extracted from dashboard.tsx so it can be tested without rendering the app.
// Every function that needs the current date takes `now` as its last argument,
// defaulting to `new Date()` — same pattern as `presetRange` in date-ranges.ts.
// That default is the only reason these were untestable before, and the working
// log records two boundary bugs here that were caught by eye rather than by a
// test: the `<` vs `<=` on the period end, and the last-bucket projection.

import { addDays, startOfWeek, toISODate } from "./format";

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
      const start = addDays(startOfWeek(now), offset * 7);
      return { start, end: addDays(start, 6) };
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
    const candidate = addDays(prev.start, daysBetween(sel.start, today));
    if (candidate < prevEnd) prevEnd = candidate;
  }
  return { from: toISODate(prev.start), to: toISODate(prevEnd) };
}

/** Period-adaptive time buckets: day (≤31d range), else month (≤24), else year. */
export function bucketize(dates: string[], hasRange: boolean) {
  const byDay = hasRange && new Set(dates).size <= 31;
  const byMonth = !byDay && new Set(dates.map((d) => d.slice(0, 7))).size <= 24;
  const keyFor = (date: string) => (byDay ? date : byMonth ? date.slice(0, 7) : date.slice(0, 4));
  const labelFor = (key: string) =>
    byDay
      ? key.slice(8).replace(/^0/, "") + "/" + key.slice(5, 7).replace(/^0/, "")
      : byMonth
        ? MONTH_SHORT[Number(key.slice(5, 7)) - 1]
        : key;
  const unit: "day" | "month" | "year" = byDay ? "day" : byMonth ? "month" : "year";
  return { keyFor, labelFor, unit };
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
    return elapsed > 0 && elapsed < total ? total / elapsed : null;
  }
  if (lastKey !== String(now.getFullYear())) return null;
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const elapsed = daysBetween(jan1, now) + 1;
  const total = daysBetween(jan1, new Date(now.getFullYear(), 11, 31)) + 1;
  return elapsed > 0 && elapsed < total ? total / elapsed : null;
}
