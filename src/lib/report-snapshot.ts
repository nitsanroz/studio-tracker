import { parseISO, shortRangeLabel, shiftDays, startOfWeek, toISODate } from "./format";
import type {
  BillingPeriod,
  Client,
  EntrySum,
  ReportSnapshot,
  Section,
  Task,
} from "./types";

/**
 * Sun–Sat week buckets covering the given entries; only weeks that HAVE hours.
 *
 * `after` (exclusive) starts the walk on the day following it, so a run appended
 * to a hand-edited column list cannot overlap the column it follows. Only the
 * FIRST bucket can be partial that way; every later one lands on Sun–Sat again,
 * because the cursor moves to the day after a week's end.
 *
 * ⚠️ THE CURSOR IS A `Date`, ADVANCED WITH THE CALENDAR-BASED `shiftDays`, AND IS
 * NEVER RE-DERIVED FROM A STRING. The version that froze this page for two hours
 * did the round trip every turn using the ms-based `addDays`, which is an hour
 * short across a clocks-back transition: `addDays(sunday, 6)` landed at 23:00 on
 * the FRIDAY, `to + 1` gave Saturday, and the next turn recomputed the same
 * Friday — so the walk never advanced. Only a client whose hours span late
 * October hit it, which is why Anchor was fine and DualBird and Blazepod hung.
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

  let cur = after ? shiftDays(parseISO(after), 1) : startOfWeek(parseISO(dates[0]));
  // `dates` is sorted and `from` only moves forward, so one pointer answers "does
  // this week hold hours?" for every bucket in a single pass. It used to be a
  // `pool.some(...)` rescan per week — 238 columns × several thousand entries.
  let i = 0;
  while (toISODate(cur) <= last) {
    const from = toISODate(cur);
    // `startOfWeek` matters only on the first turn, when `after` can drop the
    // cursor mid-week; from then on `cur` is already a Sunday by construction.
    const end = shiftDays(startOfWeek(cur), 6);
    const to = toISODate(end);
    while (i < dates.length && dates[i] < from) i++;
    if (i < dates.length && dates[i] <= to) {
      weeks.push({ label: shortRangeLabel(from, to), from, to });
    }
    cur = shiftDays(end, 1);
    // ⚠️ The cursor MUST move forward. It is correct that it does — `shiftDays` is
    // calendar-based — but this loop once ran forever on a date-arithmetic bug and
    // froze the whole tab for two hours with no console error and an idle CPU. A
    // thrown error surfaces in an error boundary and names itself; a freeze cannot
    // be diagnosed from the outside at all.
    if (toISODate(cur) <= from) {
      throw new Error(`buildWeeks: cursor failed to advance past ${from}`);
    }
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
  // `reduce` rather than `at(-1)`, because a hand-edited list need not have stayed
  // chronological. `""` seeds it: every ISO date sorts above it.
  const lastStored = customWeeks?.length
    ? customWeeks.reduce((max, w) => (w.to > max ? w.to : max), "")
    : undefined;
  const weeks = [...(customWeeks ?? []), ...buildWeeks(clientEntries, lastStored)];

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
  // ⚠️ "Other" takes the null-section tasks AND any whose sectionId matched no
  // section of this client. Without that second part such a task is in no block at
  // all, so its hours are counted into `totalByTask` and then never rendered — the
  // report silently UNDER-reports billable work with no error. Both routes there
  // are currently closed (sections are `on delete set null`, and a cross-client
  // move carries a target section), so this is a guard against bad data, not a
  // known bug. Silent hour loss is worth one line to make impossible.
  const known = new Set(clientSections.map((s) => s.id));
  const orphans = [...bySection.entries()]
    .filter(([key]) => key !== null && !known.has(key))
    .flatMap(([, list]) => list);
  pushBlock("Other", [...(bySection.get(null) ?? []), ...orphans]);

  return {
    clientName: client.name,
    clientColor: client.color,
    generatedAt: new Date().toISOString(),
    periods: sorted.map((p) => ({
      label: p.label,
      from: p.dateFrom,
      to: p.dateTo,
      /**
       * ⚠️ THE CLIENT'S CAP WINS OVER THE PERIOD'S OWN.
       *
       * `client_billing_periods.hour_cap` has existed since 0007 and the app never
       * once wrote it — there was no editor, which is why the client report's cap
       * figure had never rendered for anybody. The cap is now per CLIENT
       * (`clients.hour_cap`, 0033) because it does not change month to month, so
       * that is the number a fresh snapshot freezes. The per-period column is
       * still read as a fallback so an old row that somehow carries one is not
       * silently dropped.
       */
      hourCap: client.hourCap ?? p.hourCap,
      advanceHours: p.advanceHours,
    })),
    weeks,
    sections: sectionBlocks,
  };
}
