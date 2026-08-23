import { describe, expect, it } from "vitest";
import { buildWeeks } from "./report-snapshot";
import type { EntrySum } from "./types";

const e = (date: string, minutes = 60): EntrySum =>
  ({ taskId: "t", userId: "u", date, minutes }) as EntrySum;

describe("buildWeeks", () => {
  it("covers only the weeks that have hours", () => {
    // 2026-08-02 is a Sunday; skip a week, then log again
    const weeks = buildWeeks([e("2026-08-03"), e("2026-08-19")]);
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2026-08-02..2026-08-08",
      "2026-08-16..2026-08-22",
    ]);
  });

  it("returns nothing when there are no entries", () => {
    expect(buildWeeks([])).toEqual([]);
  });

  /**
   * The regression this exists for: a hand-edited column list used to REPLACE the
   * automatic weeks outright, so a report's timeline froze on the day someone
   * first nudged a column's dates. DualBird had stored columns ending 2026-07-31
   * while August already held hours, and no column could hold them.
   */
  it("appends the weeks after a hand-edited list, never overlapping it", () => {
    const entries = [e("2026-07-20"), e("2026-08-03"), e("2026-08-19")];
    const weeks = buildWeeks(entries, "2026-07-31");
    // 1 Aug 2026 is a Saturday, so the tail of that week is 1 Aug alone — and it
    // holds no hours, so it is correctly absent: the "only weeks with hours" rule
    // applies to a partial bucket exactly as it does to a full one.
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2026-08-02..2026-08-08",
      "2026-08-16..2026-08-22",
    ]);
    for (const w of weeks) expect(w.from > "2026-07-31").toBe(true);
  });

  it("keeps a partial first bucket when it does have hours", () => {
    // an hour ON 1 Aug, the Saturday that closes the week the boundary sits in
    const weeks = buildWeeks([e("2026-08-01"), e("2026-08-03")], "2026-07-31");
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2026-08-01..2026-08-01",
      "2026-08-02..2026-08-08",
    ]);
  });

  it("realigns to Sun–Sat after a partial first bucket", () => {
    // 2026-08-05 is a Wednesday, so the first bucket runs Thu–Sat
    const weeks = buildWeeks([e("2026-08-07"), e("2026-08-11")], "2026-08-05");
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2026-08-06..2026-08-08",
      "2026-08-09..2026-08-15",
    ]);
  });

  it("adds nothing when every hour is already covered", () => {
    expect(buildWeeks([e("2026-07-20")], "2026-07-31")).toEqual([]);
  });
});

/**
 * The regression that froze the client-reports tab for any client whose hours span
 * a clocks-back transition. `format.ts`'s `addDays` is millisecond-based, so
 * `addDays(sunday, 6)` across Israel's late-October change lands at 23:00 on the
 * FRIDAY; a walk that re-derives its cursor from that date string never advances.
 * Anchor (August only) was fine, DualBird and Blazepod hung, and August-only tests
 * like the ones above passed — hence these, which straddle the boundary.
 */
describe("buildWeeks across a DST change", () => {
  it("terminates and keeps walking forward through late October", () => {
    // Israel moved clocks back on 2025-10-26 (a Sunday)
    const entries = [
      e("2025-10-20"),
      e("2025-10-27"),
      e("2025-11-03"),
    ];
    const weeks = buildWeeks(entries);
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2025-10-19..2025-10-25",
      "2025-10-26..2025-11-01",
      "2025-11-02..2025-11-08",
    ]);
  });

  it("spans a whole year without stalling", () => {
    const weeks = buildWeeks([e("2025-05-26"), e("2026-08-20")]);
    expect(weeks.length).toBe(2); // only the two weeks that hold hours
    expect(weeks[0].from).toBe("2025-05-25");
    expect(weeks[1].to).toBe("2026-08-22");
  });

  it("appends past a hand-edited list across the boundary", () => {
    const weeks = buildWeeks([e("2025-10-27"), e("2025-11-03")], "2025-10-25");
    expect(weeks.map((w) => `${w.from}..${w.to}`)).toEqual([
      "2025-10-26..2025-11-01",
      "2025-11-02..2025-11-08",
    ]);
  });
});
