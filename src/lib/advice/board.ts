// What the &advice PAGE shows beyond the pane's view (/advice — Nitsan,
// 2026-11-15: "a page that shows everything laid out, with charts and metrics
// and every recommendation, split so it's easy to look at, dig into and
// follow"): the studio's three-month figures drawn as charts, and the store's
// history — what is snoozed or dismissed, what was resolved lately, and how
// many findings opened and closed each week.
//
// ⚠️ OWNER ONLY, like the pane: the board carries amounts (the average rate,
// what an hour costs). A PERSON's cost never goes in — business.ts keeps those
// to averages, and this takes none of its per-person money.
//
// Pure: run.ts hands it the metrics and the rows of the check it just ran.

import { parseISO, shiftDays, toISODate } from "@/lib/format";
import { TARGET_MARGIN } from "@/lib/hours-goal";
import type { BusinessMetrics } from "./business";
import type { AdviceRow } from "./merge";
import { BENCH } from "./playbook";

export interface BoardClient {
  name: string;
  hours: number;
  hoursShare: number;
  /** what the client's hours leave after the people who worked them; null when not known */
  leftShare: number | null;
  rateAgeMonths: number | null;
}

/** The studio's last three complete months, as the page's charts read them. */
export interface BoardFigures {
  /** "Aug–Oct" */
  label: string;
  margin: number;
  marginLastYear: number | null;
  targetMargin: number;
  shares: BusinessMetrics["shares"];
  sharesLastYear: BusinessMetrics["shares"] | null;
  /** ₪ an hour is sold for on average, and what an hour costs the studio */
  avgRate: number;
  hourCost: number;
  hourCostLastYear: number | null;
  hourlyShare: number;
  utilization: number | null;
  designers: number;
  ownerShare: number | null;
  topClient: number;
  topThree: number;
  clients: BoardClient[];
  /** clients beyond the ones listed, and their share together */
  otherClients: { count: number; hoursShare: number };
  freelancers: { name: string; hoursPerMonth: number }[];
  pipeline: BusinessMetrics["pipeline"];
  /** three ways to close the gap to the target; null when the target is met */
  gap: { rateUp: number; extraHoursPerMonth: number; costCut: number } | null;
  /** the rules of thumb the charts mark (playbook.ts) */
  bench: { utilizationLow: number; utilizationHigh: number; clientAmber: number; clientRed: number; peopleShare: number };
}

export interface BoardWeek {
  /** the Sunday the week starts on */
  start: string;
  opened: number;
  resolved: number;
}

export interface AdviceBoard {
  figures: BoardFigures | null;
  /** snoozed (with the date it returns) or dismissed, newest first */
  hidden: AdviceRow[];
  /** resolved by a check in the last 30 days — the automatic "done" — newest first */
  resolved: AdviceRow[];
  /** the last eight weeks, oldest first */
  weeks: BoardWeek[];
}

const CLIENTS_SHOWN = 8;
const WEEKS = 8;
const RESOLVED_DAYS = 30;

export function boardFigures(m: BusinessMetrics | null): BoardFigures | null {
  if (!m) return null;
  const listed = m.clients.slice(0, CLIENTS_SHOWN);
  const rest = m.clients.slice(CLIENTS_SHOWN);
  return {
    label: m.label,
    margin: m.margin,
    marginLastYear: m.marginLastYear,
    targetMargin: TARGET_MARGIN,
    shares: m.shares,
    sharesLastYear: m.sharesLastYear,
    avgRate: m.avgRate,
    hourCost: m.loadedHourCost,
    hourCostLastYear: m.loadedHourCostLastYear,
    hourlyShare: m.hourlyShare,
    utilization: m.utilization,
    designers: m.designers,
    ownerShare: m.ownerShare,
    topClient: m.topClient,
    topThree: m.topThree,
    clients: listed.map((c) => ({ name: c.name, hours: c.hours, hoursShare: c.hoursShare, leftShare: c.leftShare, rateAgeMonths: c.rateAgeMonths })),
    otherClients: { count: rest.length, hoursShare: rest.reduce((t, c) => t + c.hoursShare, 0) },
    // Hours only: what a freelancer is paid stays on the server.
    freelancers: m.freelancers.map((f) => ({ name: f.name, hoursPerMonth: f.hoursPerMonth })),
    pipeline: m.pipeline,
    gap: m.gap ? { rateUp: m.gap.rateUp, extraHoursPerMonth: m.gap.extraHoursPerMonth, costCut: m.gap.costCut } : null,
    bench: {
      utilizationLow: BENCH.utilizationLow,
      utilizationHigh: BENCH.utilizationHigh,
      clientAmber: BENCH.clientAmber,
      clientRed: BENCH.clientRed,
      peopleShare: BENCH.peopleShare,
    },
  };
}

/** The Sunday on or before `iso` — the studio's week starts there. */
function weekStart(iso: string): string {
  const d = parseISO(iso);
  return toISODate(shiftDays(d, -d.getDay()));
}

/** A stored timestamp as the studio's date. */
const dateOf = (stamp: string) => new Date(stamp).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

/** The store's history: what is hidden, what closed lately, and each week's opened and closed. */
export function boardHistory(rows: AdviceRow[], today: string): Pick<AdviceBoard, "hidden" | "resolved" | "weeks"> {
  const hidden = rows
    .filter((r) => !r.resolvedAt && (r.doneAt != null || (r.snoozedUntil != null && r.snoozedUntil > today)))
    .sort((a, b) => (b.doneAt ?? b.snoozedUntil ?? "").localeCompare(a.doneAt ?? a.snoozedUntil ?? ""));
  const since = toISODate(shiftDays(parseISO(today), -RESOLVED_DAYS));
  const resolved = rows
    .filter((r) => r.resolvedAt && dateOf(r.resolvedAt) >= since)
    .sort((a, b) => b.resolvedAt!.localeCompare(a.resolvedAt!));

  const first = weekStart(toISODate(shiftDays(parseISO(today), -7 * (WEEKS - 1))));
  const weeks: BoardWeek[] = Array.from({ length: WEEKS }, (_, i) => ({ start: toISODate(shiftDays(parseISO(first), 7 * i)), opened: 0, resolved: 0 }));
  const at = new Map(weeks.map((w) => [w.start, w]));
  for (const r of rows) {
    const opened = at.get(weekStart(dateOf(r.firstSeen)));
    if (opened) opened.opened += 1;
    const closed = r.resolvedAt ? at.get(weekStart(dateOf(r.resolvedAt))) : undefined;
    if (closed) closed.resolved += 1;
  }
  return { hidden, resolved, weeks };
}

export function boardOf(metrics: BusinessMetrics | null, rows: AdviceRow[], today: string): AdviceBoard {
  return { figures: boardFigures(metrics), ...boardHistory(rows, today) };
}
