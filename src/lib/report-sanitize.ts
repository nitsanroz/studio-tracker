import type { ReportSnapshot } from "./types";

/**
 * Strip everything the admin marked hidden BEFORE it reaches the browser.
 * Hidden tasks and hidden period/week columns are physically removed (arrays
 * reindexed together); hidden estimate/total values are nulled. The client
 * therefore never receives hidden data in any form — not in the DOM, not in
 * the JSON payload, not in localStorage.
 *
 * Column keys (see report-table.tsx `columnKey`): "estimate", "total",
 * `p:{i}` for payment periods, `w:{i}` for week columns. Only estimate/total
 * are returned as still-hidden (they are leading columns kept in the array but
 * with their values removed); period/week columns are dropped outright.
 *
 * `totalMinutes` deliberately still spans ALL periods, including hidden ones,
 * so `total − Σ(visible periods)` does give a hidden column's value back. That
 * is fine and intended: **hiding is a focus tool, not confidentiality.** An
 * admin hides a finished period or a completed task so the client reads the
 * current one, and the summary is still meant to be the true total delivered.
 * A v1.0.1 change briefly re-derived the total from the visible columns; Nitsan
 * corrected the premise — don't reinstate it without asking him.
 *
 * Lives in lib/ rather than beside the page so it can be unit-tested; see
 * report-sanitize.test.ts.
 */
export function sanitizeSnapshot(
  snap: ReportSnapshot,
  hiddenColumns: string[],
  hiddenTaskIds: string[],
): { snapshot: ReportSnapshot; leadingHidden: string[]; periodTotals: number[] } {
  const hc = new Set(hiddenColumns);
  const ht = new Set(hiddenTaskIds);
  const hideEstimate = hc.has("estimate");
  const hideTotal = hc.has("total");
  const useWeeks = !!snap.weeks?.length;

  const periodKeep = snap.periods.map((_, i) => !hc.has(`p:${i}`));
  const weekKeep = useWeeks ? snap.weeks!.map((_, i) => !hc.has(`w:${i}`)) : [];

  /**
   * The TRUE hours in each surviving period — summed over EVERY task, including
   * the ones hidden below.
   *
   * ⚠️ THE SUMMARY TILES USED TO BE DERIVED FROM THE SURVIVING ROWS, WHICH MADE
   * HIDING A TASK CHANGE THE CLIENT'S NUMBERS. That contradicted the rule this
   * file is built on — hiding is a focus tool, not confidentiality, which is
   * exactly why `totalMinutes` still spans hidden PERIODS — and it broke in the
   * expensive direction: a 40h cap with 36h logged and one finished 12h task
   * hidden read "this period 24h · Remaining 16h" when 4h of cap was left, on
   * the page the studio invoices against. Nitsan's call, 2026-08-24: the tiles
   * show real totals.
   *
   * ⚠️ Computed HERE, before the rows are filtered, because after that the
   * hidden hours are gone and cannot be recovered. Sent alongside the snapshot
   * rather than inside it: it is a summary, not a row anybody can unfold.
   *
   * ⚠️ And yes, this means a hidden task's hours are visible in aggregate
   * (period total minus the rows shown). That is the accepted trade recorded in
   * v1.0.2 and re-affirmed here — anything that must not be seen belongs in the
   * hidden lists, which are stripped server-side, not in a focus filter.
   */
  const periodTotals = snap.periods
    .map((_, i) =>
      snap.sections.reduce(
        (sum, sec) => sum + sec.tasks.reduce((n, t) => n + (t.periodMinutes[i] ?? 0), 0),
        0,
      ),
    )
    .filter((_, i) => periodKeep[i]);

  const sections = snap.sections
    .map((sec) => ({
      name: sec.name,
      tasks: sec.tasks
        .filter((t) => !ht.has(t.id))
        .map((t) => ({
          id: t.id,
          title: t.title,
          estimateHours: hideEstimate ? null : t.estimateHours,
          // spans every period, hidden ones included — see the note above
          totalMinutes: hideTotal ? 0 : t.totalMinutes,
          periodMinutes: t.periodMinutes.filter((_, i) => periodKeep[i]),
          ...(t.weekMinutes
            ? { weekMinutes: useWeeks ? t.weekMinutes.filter((_, i) => weekKeep[i]) : t.weekMinutes }
            : {}),
        })),
    }))
    .filter((sec) => sec.tasks.length > 0);

  /**
   * ⚠️ BUILT FIELD BY FIELD, NOT SPREAD, and that is deliberate.
   *
   * This was `{ ...snap, … }` with each period passed through whole, so every key
   * in the stored jsonb reached the client. `link.snapshot` is a `jsonb` column
   * CAST to `ReportSnapshot` — the cast asserts a shape rather than checking one —
   * so TypeScript could not see what was actually in there, and the doc above
   * promised the client "never receives hidden data in any form" for a payload
   * this function did not build.
   *
   * No live leak: every version of `buildReportSnapshot` back to v0.92 allow-listed
   * its own output. The hazard was the future one — any field later added to a
   * snapshot or a period (an internal note, a rate, an assignee, a period's `paid`
   * flag) would have become client-visible the moment it was published, with no
   * code change on this path and no type error to catch it. The task mapping above
   * was already an allow-list; these two levels now match it.
   *
   * `invoices` is deliberately NOT carried: the type declares it, nothing writes
   * it and nothing renders it. If it is ever implemented it gets added here on
   * purpose, which is the whole point of a list you have to opt into.
   */
  const snapshot: ReportSnapshot = {
    clientName: snap.clientName,
    clientColor: snap.clientColor,
    generatedAt: snap.generatedAt,
    periods: snap.periods
      .filter((_, i) => periodKeep[i])
      .map((p) => ({
        label: p.label,
        from: p.from,
        to: p.to,
        hourCap: p.hourCap,
        advanceHours: p.advanceHours,
      })),
    ...(useWeeks
      ? {
          weeks: snap.weeks!
            .filter((_, i) => weekKeep[i])
            .map((w) => ({ label: w.label, from: w.from, to: w.to })),
        }
      : {}),
    sections,
  };

  const leadingHidden = [
    ...(hideEstimate ? ["estimate"] : []),
    ...(hideTotal ? ["total"] : []),
  ];
  return { snapshot, leadingHidden, periodTotals };
}
