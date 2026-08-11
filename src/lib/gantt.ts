/**
 * The Gantt's pure geometry: dates, the working-day calendar, and the tick
 * scale. No React, no store, no auth.
 *
 * It lives here because there are now TWO charts drawing the same picture — the
 * editable one on the client page and the read-only one behind a share link —
 * and a client looking at a published plan has to see the same bars, on the
 * same days, as the person who scheduled them. Every one of these functions was
 * previously private to `client-timeline.tsx`; copying them would have been a
 * silent invitation for the two to drift a day apart.
 */

import { MONTH_NAMES_SHORT } from "./format";

export type Zoom = "day" | "week" | "month";

/** Pixels per DAY at each zoom — every position in the chart is computed in days. */
export const PX_PER_DAY: Record<Zoom, number> = { day: 26, week: 9, month: 3 };

export const ROW_H = 34;
/** 36, not 30: the bracket sits LOW in this row so the section's name has the
 *  space above it — see `SECTION_BAR_TOP` in the Timeline. */
export const SECTION_H = 36;
/**
 * A subject group's row (0027). Same height as a task's, because that is the
 * claim it makes: a group draws a BAR across its children's span, not a bracket
 * over them, so giving it a section's taller row would say it were a third kind
 * of heading rather than a gathered task.
 */
export const GROUP_H = ROW_H;
/**
 * Bar height. 27 in a 34px row, so a bar nearly fills its lane and the chart
 * reads as a stack of bands rather than as ribbons floating in white.
 */
export const BAR_H = 27;
/**
 * A group's bar is drawn as a STACK: the main bar with layers peeking out behind
 * its top edge, so it reads as several bars gathered rather than as one long
 * task. `GROUP_LAYERS` shims of `GROUP_LAYER_STEP` each, inset from both ends so
 * the stack tapers.
 */
export const GROUP_BAR_H = 19;
export const GROUP_LAYERS = 2;
export const GROUP_LAYER_STEP = 3;
export const GROUP_LAYER_INSET = 5;
/** Corner radius, ~1/4 of the height. A full pill stops a short bar reading as a span. */
export const BAR_R = 4;
/** A deadline diamond marks a point, so it can't scale with a span. */
export const DIAMOND = 11;
/** Below this a bar's label is one letter and an ellipsis — noise, not a label. */
export const BAR_LABEL_MIN_PX = 34;
/** Per-day weekend/holiday shading is drawn up to this zoom; at 3px/day it's noise. */
export const SHADE_MIN_PX_PER_DAY = 6;
/**
 * A section's summary bar. 3px flat, not a ratio of the task bar.
 *
 * It was `BAR_H * 0.3` — 6px against a 20px bar — which still read as a bar of
 * its own. A section is a bracket over its rows, and a bracket is a rule: at
 * 3px the tips do the talking and the line just joins them.
 */
export const SECTION_BAR_H = 3;
/** The section bracket's end tips: width, and depth from the top of its bar. */
export const TIP_W = 6;
export const TIP_H = SECTION_BAR_H + 4;
/** Below this the two tips meet and the span reads as a chevron. */
export const TIP_MIN_W = TIP_W * 2 + 2;
/** "Jan 2027" at 10px semibold plus the tick's px-1. A week tick is 63px. */
const YEAR_LABEL_MIN_PX = 56;

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** DST-safe: builds the date by parts rather than adding 86,400,000 ms. */
export function shiftDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

export function daysBetween(a: Date, b: Date): number {
  // Math.round absorbs the ±1h a DST boundary puts into the difference.
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "18 Aug", and for a range "18 – 24 Aug" / "28 Aug – 2 Sep". */
export function dateRangeLabel(start: Date, due: Date, hasStart: boolean): string {
  const day = (d: Date) => d.getDate();
  const mon = (d: Date) => MONTH_NAMES_SHORT[d.getMonth()];
  if (!hasStart) return `${day(due)} ${mon(due)}`;
  if (daysBetween(start, due) === 0) return `${day(start)} ${mon(start)}`;
  // Repeating the month twice inside one cell is noise when it's the same month.
  if (start.getMonth() === due.getMonth() && start.getFullYear() === due.getFullYear()) {
    return `${day(start)} – ${day(due)} ${mon(due)}`;
  }
  return `${day(start)} ${mon(start)} – ${day(due)} ${mon(due)}`;
}

/* ── working-day calendar ─────────────────────────────────────────────────
   `off` holds every yyyy-mm-dd the weekly plan marks as a whole-studio day
   off. Fri/Sat are the studio's weekend — restated here rather than imported
   from format.ts because this also has to answer for holidays. */

export function isWorkDay(d: Date, off: Set<string>): boolean {
  const day = d.getDay();
  if (day === 5 || day === 6) return false; // Friday, Saturday
  return !off.has(toISO(d));
}

/** Nearest working day at or after (dir=1) / at or before (dir=-1) `d`. */
export function snapToWorkDay(d: Date, dir: 1 | -1, off: Set<string>): Date {
  let out = d;
  // 30 is far more than any run of non-working days; it stops a bad `off` set
  // from spinning forever.
  for (let i = 0; i < 30 && !isWorkDay(out, off); i++) out = shiftDays(out, dir);
  return out;
}

/** `n` working days after `from` (n=0 → `from` itself, snapped forward). */
export function addWorkDays(from: Date, n: number, off: Set<string>): Date {
  let out = snapToWorkDay(from, 1, off);
  for (let i = 0; i < n; i++) out = snapToWorkDay(shiftDays(out, 1), 1, off);
  return out;
}

/** Working days from `a` to `b` inclusive; 1 when they're the same working day. */
export function workDaysBetween(a: Date, b: Date, off: Set<string>): number {
  let count = 0;
  const span = daysBetween(a, b);
  for (let i = 0; i <= span; i++) {
    if (isWorkDay(shiftDays(a, i), off)) count++;
  }
  return Math.max(1, count);
}

export interface Tick {
  left: number;
  width: number;
  label: string;
  /** the first tick of a new month (of a new YEAR at month zoom) */
  boundary: boolean;
  /** a Sunday, at day zoom only — the studio's week starts there */
  weekStart?: boolean;
}

/**
 * The calendar scale. There is no separate month band: the first tick that
 * falls INSIDE a month prints the month's name in place of its date, and the
 * year is stated once, where it changes, and only where it fits.
 */
export function ticksFor(
  from: Date,
  totalDays: number,
  zoom: Zoom,
  pxPerDay: number,
): { ticks: Tick[] } {
  const ticks: Tick[] = [];
  const step = zoom === "day" ? 1 : zoom === "week" ? 7 : 0; // 0 = calendar months

  if (step > 0) {
    let lastMonth = -1;
    let lastYear = -1;
    for (let d = 0; d < totalDays; d += step) {
      const date = shiftDays(from, d);
      const month = date.getMonth();
      const year = date.getFullYear();
      // The month is announced by the first tick that falls INSIDE it, not by
      // the 1st: at week zoom the ticks are Sundays and almost never land on it.
      const boundary = month !== lastMonth;
      // The year is stated once, where it CHANGES. Nothing else on this chart
      // carries it — the ticks are d/m and the Dates column drops the year too
      // — so a plan running into next January would otherwise never say which
      // January. Only where it fits: at day zoom a tick is 26px.
      const newYear = boundary && lastYear !== -1 && year !== lastYear;
      const width = Math.min(step, totalDays - d) * pxPerDay;
      lastMonth = month;
      lastYear = year;
      ticks.push({
        left: d * pxPerDay,
        width,
        label: boundary
          ? newYear && width >= YEAR_LABEL_MIN_PX
            ? `${MONTH_NAMES_SHORT[month]} ${year}`
            : MONTH_NAMES_SHORT[month]
          : zoom === "day"
            ? String(date.getDate())
            : `${date.getDate()}/${month + 1}`,
        boundary,
        weekStart: zoom === "day" && date.getDay() === 0,
      });
    }
  } else {
    let cursor = 0;
    let lastYear = -1;
    while (cursor < totalDays) {
      const date = shiftDays(from, cursor);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      const len = Math.min(daysBetween(date, monthEnd), totalDays - cursor);
      const year = date.getFullYear();
      // At this zoom every tick is already a month, so the boundary worth
      // marking is the YEAR — and the tick that opens one carries it.
      const boundary = year !== lastYear;
      lastYear = year;
      ticks.push({
        left: cursor * pxPerDay,
        width: len * pxPerDay,
        label: boundary
          ? `${MONTH_NAMES_SHORT[date.getMonth()]} ${year}`
          : MONTH_NAMES_SHORT[date.getMonth()],
        boundary,
      });
      cursor += len;
    }
  }
  return { ticks };
}
