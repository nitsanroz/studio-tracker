import { formatFeedDate, startOfWeek, toISODate } from "./format";
import type {
  BillingPeriod,
  Client,
  EntrySum,
  ReportSnapshot,
  Section,
  Task,
} from "./types";

/** "yyyy-mm-dd" → a local Date, without the UTC shift `new Date(iso)` applies. */
function fromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Shift a date by whole CALENDAR days.
 *
 * ⚠️ NOT `format.ts`'s `addDays`, WHICH IS MILLISECOND-BASED AND WEDGED THIS PAGE.
 * `getTime() + days * DAY_MS` is an hour short whenever the span crosses a clocks-
 * back transition (Israel, late October), so `addDays(sunday, 6)` lands at 23:00 on
 * FRIDAY and `toISODate` reports the wrong day. This walk re-derives its cursor from
 * that string each turn, so it produced the same Friday forever: an infinite loop
 * that froze the whole tab — but only for a client whose hours span a DST change,
 * which is why Anchor was fine, DualBird and Blazepod were not, and August-only
 * unit tests passed.
 */
function shiftDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/**
 * Sun–Sat week buckets covering the given entries; only weeks that HAVE hours.
 *
 * `after` (exclusive) starts the walk on the day following it, so a run appended
 * to a hand-edited column list cannot overlap the column it follows. Only the
 * FIRST bucket can be partial that way; every later one lands on Sun–Sat again,
 * because the cursor moves to the day after a week's end.
 */
export function buildWeeks(
  entries: EntrySum[],
  after?: string,
): { label: string; from: string; to: string }[] {
  const pool = after ? entries.filter((e) => e.date > after) : entries;
  if (pool.length === 0) return [];
  const dates = pool.map((e) => e.date).sort();
  const last = dates[dates.length - 1];
  const weeks: { label: string; from: string; to: string }[] = [];
  const hasHours = (from: string, to: string) =>
    pool.some((e) => e.date >= from && e.date <= to);
  const short = (iso: string) => formatFeedDate(iso).split(" ").slice(0, 2).join(" ");

  let from = after
    ? toISODate(shiftDays(fromISO(after), 1))
    : toISODate(startOfWeek(fromISO(dates[0])));
  while (from <= last) {
    const to = toISODate(shiftDays(startOfWeek(fromISO(from)), 6));
    if (hasHours(from, to)) weeks.push({ label: `${short(from)} – ${short(to)}`, from, to });
    from = toISODate(shiftDays(fromISO(to), 1));
  }
  return weeks;
}

/**
 * Freeze a client's approved hours into a snapshot for publishing.
 * Only billable tasks appear (keys/internal tasks are non-billable by
 * convention), and only if they have logged hours or an estimate.
 */
export function buildReportSnapshot(
  client: Client,
  sections: Section[],
  tasks: Task[],
  entrySums: EntrySum[],
  periods: BillingPeriod[],
  /** admin-edited column ranges; falls back to auto week buckets */
  customWeeks?: { label: string; from: string; to: string }[] | null,
): ReportSnapshot {
  const clientTasks = tasks.filter((t) => t.clientId === client.id && t.billable && !t.pending);
  const taskIds = new Set(clientTasks.map((t) => t.id));

  const totalByTask = new Map<string, number>();
  const periodByTask = new Map<string, number[]>();
  const weekByTask = new Map<string, number[]>();
  const sorted = [...periods].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  const clientEntries = entrySums.filter((e) => taskIds.has(e.taskId));
  /**
   * ⚠️ A HAND-EDITED COLUMN LIST IS AN OVERRIDE, NOT A FREEZE, and it used to be
   * a freeze. `handleEditColumnDates` snapshots the whole rendered list into
   * `report_links.custom_weeks`, so the first time anyone nudged one column's
   * dates the report's timeline stopped at that day — for good. DualBird had 55
   * stored columns ending in July while August already held 33h, and there was
   * no way to add a column, so the work was simply unreportable.
   * Now the stored list keeps its edits and the weeks after its last column are
   * appended automatically, which also means the next date edit persists them.
   */
  const weeks = customWeeks?.length
    ? [
        ...customWeeks,
        ...buildWeeks(
          clientEntries,
          customWeeks.reduce((max, w) => (w.to > max ? w.to : max), customWeeks[0].to),
        ),
      ]
    : buildWeeks(clientEntries);

  for (const e of clientEntries) {
    totalByTask.set(e.taskId, (totalByTask.get(e.taskId) ?? 0) + e.minutes);
    let arr = periodByTask.get(e.taskId);
    if (!arr) periodByTask.set(e.taskId, (arr = sorted.map(() => 0)));
    sorted.forEach((p, i) => {
      if (e.date >= p.dateFrom && e.date <= p.dateTo) arr![i] += e.minutes;
    });
    let warr = weekByTask.get(e.taskId);
    if (!warr) weekByTask.set(e.taskId, (warr = weeks.map(() => 0)));
    weeks.forEach((w, i) => {
      if (e.date >= w.from && e.date <= w.to) warr![i] += e.minutes;
    });
  }

  const clientSections = sections
    .filter((s) => s.clientId === client.id)
    .sort((a, b) => a.position - b.position);

  const bySection = new Map<string | null, Task[]>();
  for (const t of clientTasks) {
    const key = t.sectionId ?? null;
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key)!.push(t);
  }

  const sectionBlocks: ReportSnapshot["sections"] = [];
  const pushBlock = (name: string, list: Task[]) => {
    const rows = list
      .filter((t) => (totalByTask.get(t.id) ?? 0) > 0 || t.estimateHours != null)
      .sort((a, b) => a.position - b.position)
      .map((t) => ({
        id: t.id,
        title: t.title,
        estimateHours: t.estimateHours,
        totalMinutes: totalByTask.get(t.id) ?? 0,
        periodMinutes: periodByTask.get(t.id) ?? sorted.map(() => 0),
        weekMinutes: weekByTask.get(t.id) ?? weeks.map(() => 0),
      }));
    if (rows.length > 0) sectionBlocks.push({ name, tasks: rows });
  };

  for (const s of clientSections) pushBlock(s.name, bySection.get(s.id) ?? []);
  pushBlock("Other", bySection.get(null) ?? []);

  return {
    clientName: client.name,
    clientColor: client.color,
    generatedAt: new Date().toISOString(),
    periods: sorted.map((p) => ({
      label: p.label,
      from: p.dateFrom,
      to: p.dateTo,
      hourCap: p.hourCap,
      advanceHours: p.advanceHours,
    })),
    weeks,
    sections: sectionBlocks,
  };
}
