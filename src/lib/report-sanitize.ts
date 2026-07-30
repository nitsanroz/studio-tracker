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
): { snapshot: ReportSnapshot; leadingHidden: string[] } {
  const hc = new Set(hiddenColumns);
  const ht = new Set(hiddenTaskIds);
  const hideEstimate = hc.has("estimate");
  const hideTotal = hc.has("total");
  const useWeeks = !!snap.weeks?.length;

  const periodKeep = snap.periods.map((_, i) => !hc.has(`p:${i}`));
  const weekKeep = useWeeks ? snap.weeks!.map((_, i) => !hc.has(`w:${i}`)) : [];

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

  const snapshot: ReportSnapshot = {
    ...snap,
    periods: snap.periods.filter((_, i) => periodKeep[i]),
    ...(useWeeks ? { weeks: snap.weeks!.filter((_, i) => weekKeep[i]) } : {}),
    sections,
  };

  const leadingHidden = [
    ...(hideEstimate ? ["estimate"] : []),
    ...(hideTotal ? ["total"] : []),
  ];
  return { snapshot, leadingHidden };
}
