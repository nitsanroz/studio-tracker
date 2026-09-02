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
 * Sun–Sat week buckets, cut at every billing-period boundary.
 *
 * A bucket is emitted when it HAS HOURS or when it falls inside one of `cover` —
 * the billing periods.
 *
 * ⚠️⚠️ EVERY DAY OF A DEFINED PERIOD GETS A COLUMN, EVEN WITH NOTHING LOGGED IN
 * IT, and that is Nitsan's rule: *"make sure all days and weeks are created inside
 * a biling period and nothing is missing, dont allow days to be missed only allow
 * skipping days or months in the defined billing periods"*. Until this, a bucket
 * needed hours to exist at all — so a quiet week in the middle of a period simply
 * was not there, and Baseline's report read as though a week of the month had gone
 * missing. A skipped stretch is now only ever something the STUDIO chose by not
 * defining a period over it; inside a period the calendar is continuous.
 * ⚠️ A zero column is information, not noise: on a report a client reads, "we
 * logged nothing that week" and "that week is not in this report" are completely
 * different claims, and the old behaviour could not tell them apart.
 *
 * ⚠️ Days with hours but NO period still get their column — that is what keeps
 * years of pre-period history visible, and it is why this is a union rather than
 * "the periods decide everything".
 *
 * `cuts` are dates a column may not span INTO — see `periodCuts`. A week holding
 * one is split there, so no column ever straddles a billing-period boundary.
 *
 * ⚠️ THESE ARE THE ONLY COLUMNS A REPORT HAS. There used to be a per-client
 * hand-edited list on top (`report_links.custom_weeks`) and it is gone: once the
 * periods cut the weeks, an override was a second way to say the same thing — one
 * that could disagree with the periods, double-count an overlap, or freeze a
 * client's timeline on the day somebody nudged a date. Move a period boundary to
 * move a column break.
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
  cuts: string[] = [],
  /** spans every day of which must have a column — the billing periods */
  cover: { from: string; to: string }[] = [],
): { label: string; from: string; to: string }[] {
  const dates = entries.map((e) => e.date).sort();
  const spans = [...cover].sort((a, b) => a.from.localeCompare(b.from));
  const firstDay = [dates[0], spans[0]?.from].filter(Boolean).sort()[0];
  /**
   * ⚠️ The walk ends at the later of the last logged day and the last period's
   * end. A period that runs into the future therefore gets its remaining weeks as
   * empty columns — which is the point: they are days the client is being billed
   * for. `buildReportSnapshot`'s `through` cut-off is what trims them back when a
   * report is scoped, and it is applied to `cover` before this is called.
   */
  const lastDay = [dates[dates.length - 1], spans[spans.length - 1]?.to]
    .filter(Boolean)
    .sort()
    .pop();
  if (!firstDay || !lastDay) return [];
  const last = lastDay;
  const weeks: { label: string; from: string; to: string }[] = [];

  let cur = startOfWeek(parseISO(firstDay));
  // `dates` is sorted and `from` only moves forward, so one pointer answers "does
  // this week hold hours?" for every bucket in a single pass. It used to be a
  // `pool.some(...)` rescan per week — 238 columns × several thousand entries.
  let i = 0;
  const sortedCuts = [...cuts].sort();
  while (toISODate(cur) <= last) {
    const from = toISODate(cur);
    // `startOfWeek` matters after a period cut, which drops the cursor mid-week;
    // otherwise `cur` is already a Sunday by construction.
    const weekEnd = toISODate(shiftDays(startOfWeek(cur), 6));
    /**
     * ⚠️⚠️ A COLUMN STOPS AT A BILLING-PERIOD BOUNDARY. A period that ends
     * mid-week used to leave one week column belonging to two periods at once —
     * so the columns on screen could not add up to the period total beneath them
     * (Visitt's January: 204h of visible columns against a 216.5h period), and
     * the green Period column had to be computed by DATE to stay honest (v1.44.0).
     * Splitting the bucket means the arithmetic agrees on both axes.
     * ⚠️ The cursor then continues INSIDE the same week, so two cuts in one week
     * produce three columns rather than swallowing the second.
     */
    const cut = sortedCuts.find((c) => c > from && c <= weekEnd);
    const to = cut ? toISODate(shiftDays(parseISO(cut), -1)) : weekEnd;
    while (i < dates.length && dates[i] < from) i++;
    const hasHours = i < dates.length && dates[i] <= to;
    // `to` never crosses a period boundary (the cut above), so an overlap here
    // means the whole bucket sits inside that period.
    const inPeriod = spans.some((p) => p.from <= to && p.to >= from);
    if (hasHours || inPeriod) {
      weeks.push({ label: shortRangeLabel(from, to), from, to });
    }
    cur = shiftDays(parseISO(to), 1);
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
 * The dates a week column may not run INTO: every period's first day, and the day
 * after every period's last.
 *
 * ⚠️ BOTH ENDS, because periods need not be contiguous. Anchor's August ends 19/8
 * while September starts 21/8, so 20 Aug belongs to no period at all — cutting
 * only at each `dateFrom` would leave that orphan day inside the column before it.
 */
export function periodCuts(periods: BillingPeriod[]): string[] {
  const cuts = new Set<string>();
  for (const p of periods) {
    cuts.add(p.dateFrom);
    cuts.add(toISODate(shiftDays(parseISO(p.dateTo), 1)));
  }
  return [...cuts].sort();
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
  /**
   * Inclusive cut-off: hours logged AFTER this date are left out of the report
   * entirely.
   *
   * ⚠️⚠️ IT IS APPLIED IN ONE PLACE — the `clientEntries` filter below — AND THAT
   * IS THE WHOLE POINT. Every figure in a report descends from that list: the week
   * columns (`buildWeeks` reads it), each row's Total, the per-period totals, and
   * the `periodTotals` the client's header figure is built from. Filter it once and
   * they all agree; filter anywhere downstream and the report contradicts itself.
   *
   * ⚠️ WHY THIS EXISTS, so nobody "simplifies" it into a hidden column: a weekly
   * report is a summary of the week that ENDED. Nitsan published Anchor's on the
   * Sunday afternoon, after colleagues had already logged hours into the new week,
   * and hiding that column (`hidden_columns`) removed it from the table while
   * leaving those 8h inside the row totals and the header figure — so the page
   * disagreed with itself: 62.5h in the header against 54.5h in the Period column.
   * Hiding is a focus tool; scoping is arithmetic, and only this can do it.
   *
   * ⚠️ Stored-week columns that begin after the cut-off are dropped too, or a
   * hand-edited list would leave an empty trailing column with no hours in it.
   */
  through?: string | null,
): ReportSnapshot {
  const clientTasks = tasks.filter((t) => t.clientId === client.id && t.billable && !t.pending);
  const taskIds = new Set(clientTasks.map((t) => t.id));

  const totalByTask = new Map<string, number>();
  const periodByTask = new Map<string, number[]>();
  const weekByTask = new Map<string, number[]>();
  const sorted = [...periods].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  const clientEntries = entrySums.filter(
    (e) => taskIds.has(e.taskId) && (!through || e.date <= through),
  );
  /**
   * ⚠️ Sun–Sat weeks, cut at every billing-period boundary, and nothing else —
   * see `buildWeeks` for why the hand-edited override was removed.
   *
   * ⚠️ The periods are ALSO what fills the calendar in: every day of a defined
   * period gets a column whether or not anything was logged in it. Clipped to the
   * cut-off first, or a report scoped to last Saturday would still carry empty
   * columns for the rest of the period — the thing `through` exists to keep out.
   */
  const cover = sorted
    .map((p) => ({ from: p.dateFrom, to: through && p.dateTo > through ? through : p.dateTo }))
    .filter((p) => p.from <= p.to);
  const weeks = buildWeeks(clientEntries, periodCuts(sorted), cover);

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
