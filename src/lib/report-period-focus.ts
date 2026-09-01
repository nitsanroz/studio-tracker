/**
 * Which payment period a report table is scoped to — "current", "previous", or one
 * the reader picked out of the list.
 *
 * ⚠️⚠️ THIS EXISTS BECAUSE THREE PLACES HAVE TO AGREE ON WHAT "CURRENT" MEANS AND
 * ONLY ONE OF THEM RENDERS THE TABLE. The editor's pills, the client link's pills
 * and `ReportTable`'s own green Period column all resolve it; when the rule lived
 * inside the table (a `reduce` over `to`) the two pages had no way to light the
 * right pill without re-deriving it, and a re-derivation that drifts would light
 * "Current period" while the table shows another one.
 *
 * ⚠️ CURRENT IS THE LATEST PERIOD BY END DATE, NOT THE ONE TODAY FALLS INSIDE.
 * A published report is frozen: a "today" rule would make the same link total a
 * different period next month with nobody republishing it. Carried over verbatim
 * from the `latestIndex` this replaces — the semantics are not being changed here,
 * only named and shared.
 */

/** The bit of a period this module needs. Both `ReportSnapshot["periods"]` and a raw row fit. */
export type PeriodLike = { from: string; to: string };

/**
 * Period indices ordered newest-END first.
 *
 * ⚠️ Sorted rather than assumed: `snapshot.periods` arrives in `from` order and the
 * two agree for ordinary consecutive periods — but a period edited to end early, or
 * one nested inside another (which the divider editor can produce), breaks the
 * agreement, and "previous" is exactly where that shows up.
 * ⚠️ `>`/`<` on YYYY-MM-DD rather than `localeCompare`: they agree on this format,
 * and the tie-break on `from` keeps the order stable for two periods ending the same
 * day instead of leaving it to the sort's implementation.
 */
function byEndDesc(periods: PeriodLike[]): number[] {
  return periods
    .map((_, i) => i)
    .sort((a, b) => {
      if (periods[a].to !== periods[b].to) return periods[a].to > periods[b].to ? -1 : 1;
      if (periods[a].from !== periods[b].from) return periods[a].from > periods[b].from ? -1 : 1;
      return a - b;
    });
}

/** Index of the period with the latest end date, or -1 when there are none. */
export function currentPeriodIndex(periods: PeriodLike[]): number {
  return byEndDesc(periods)[0] ?? -1;
}

/**
 * Index of the period ending just before the current one, or -1 when there is no
 * such period — which is the ordinary case for a client with a single period, and
 * why the callers disable the pill rather than showing an empty table.
 */
export function previousPeriodIndex(periods: PeriodLike[]): number {
  return byEndDesc(periods)[1] ?? -1;
}

/**
 * Resolve a PUBLISHED period selection back to an index in the periods array being
 * rendered.
 *
 * ⚠️⚠️ A SELECTION IS PUBLISHED AS THE PERIOD'S `from` DATE AND NOT AS ITS INDEX,
 * AND THE REASON IS `sanitizeSnapshot`: hiding a period (`p:{i}` in `hiddenColumns`)
 * physically REMOVES it from the client's copy, so index 3 in the editor can be a
 * different period — or out of range — in the payload the client receives. An index
 * would have silently scoped the client's table to the wrong period, showing real
 * hours under the wrong heading, which is worse than showing none.
 *
 * Returns null for "no selection" (show every period) and also when the named period
 * is not in this array at all — the studio hid the very period it had focused, and
 * falling back to the whole table is the honest reading of that.
 */
export function periodIndexFromDate(
  periods: PeriodLike[],
  from: string | null | undefined,
): number | null {
  if (!from) return null;
  const i = periods.findIndex((p) => p.from === from);
  return i < 0 ? null : i;
}
