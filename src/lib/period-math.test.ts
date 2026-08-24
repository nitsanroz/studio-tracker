import { describe, expect, it } from "vitest";
import { toISODate } from "./format";
import { presetRange } from "./date-ranges";
import {
  bucketProjection,
  bucketize,
  comparablePrevRange,
  daysBetween,
  periodBounds,
  periodRange,
  rangeLabel,
} from "./period-math";

// These are the numbers the admin home reads its KPI deltas and chart
// projections from, so the cases below are mostly boundaries: the first and
// last day of a period, a leap year, a year boundary, and the two bugs the
// working log records (the `<=` on the period end, and day buckets never
// projecting).
//
// Every function takes `now` explicitly, so nothing here depends on the day the
// suite happens to run. Month is 0-indexed in `new Date(y, m, d)`.

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("daysBetween", () => {
  it("counts whole calendar days, ignoring the time of day", () => {
    expect(daysBetween(at(2026, 7, 1), at(2026, 7, 31))).toBe(30);
    expect(daysBetween(new Date(2026, 6, 1, 23, 59), new Date(2026, 6, 2, 0, 1))).toBe(1);
  });

  it("is signed and zero for the same day", () => {
    expect(daysBetween(at(2026, 7, 10), at(2026, 7, 10))).toBe(0);
    expect(daysBetween(at(2026, 7, 10), at(2026, 7, 3))).toBe(-7);
  });

  it("crosses a DST change without drifting", () => {
    // Israel moves the clock in late March; a naive ms/86.4e6 would give 30.96.
    expect(daysBetween(at(2026, 3, 20), at(2026, 4, 19))).toBe(30);
  });
});

describe("periodBounds", () => {
  it("returns null for All time", () => {
    expect(periodBounds("All time", 0, at(2026, 7, 30))).toBeNull();
  });

  it("weeks start on Sunday (Israeli work week)", () => {
    // 2026-07-30 is a Thursday; that week runs Sun 26 Jul → Sat 1 Aug.
    const b = periodBounds("This week", 0, at(2026, 7, 30))!;
    expect(b.start.getDay()).toBe(0);
    expect([b.start.getDate(), b.end.getDate()]).toEqual([26, 1]);
  });

  it("steps a whole month back, not 30 days", () => {
    const b = periodBounds("This month", -1, at(2026, 7, 30))!;
    expect([b.start.getMonth(), b.start.getDate()]).toEqual([5, 1]); // 1 Jun
    expect(b.end.getDate()).toBe(30); // June has 30
  });

  it("lands on the real last day of a short month", () => {
    expect(periodBounds("This month", 0, at(2026, 2, 10))!.end.getDate()).toBe(28);
    expect(periodBounds("This month", 0, at(2024, 2, 10))!.end.getDate()).toBe(29); // leap
  });

  it("rolls the year when stepping back past January", () => {
    const b = periodBounds("This month", -1, at(2026, 1, 15))!;
    expect([b.start.getFullYear(), b.start.getMonth()]).toEqual([2025, 11]); // Dec 2025
  });

  it("covers a full calendar year", () => {
    const b = periodBounds("This year", -7, at(2026, 7, 30))!;
    expect(b.start.getFullYear()).toBe(2019);
    expect([b.start.getMonth(), b.start.getDate()]).toEqual([0, 1]);
    expect([b.end.getMonth(), b.end.getDate()]).toEqual([11, 31]);
  });
});

describe("rangeLabel", () => {
  it("names the current and previous period in words", () => {
    const now = at(2026, 7, 30);
    expect(rangeLabel("This month", 0, now)).toBe("This month");
    expect(rangeLabel("This month", -1, now)).toBe("Last month");
    expect(rangeLabel("This week", -1, now)).toBe("Last week");
    expect(rangeLabel("This year", -1, now)).toBe("Last year");
    expect(rangeLabel("All time", -3, now)).toBe("All time");
  });

  it("drops the year for months in the current year but keeps it otherwise", () => {
    const now = at(2026, 7, 30);
    expect(rangeLabel("This month", -3, now)).toBe("Apr");
    expect(rangeLabel("This month", -8, now)).toBe("Nov 2025");
  });

  it("labels a past year by its number", () => {
    expect(rangeLabel("This year", -7, at(2026, 7, 30))).toBe("2019");
  });
});

describe("comparablePrevRange", () => {
  it("is null for All time", () => {
    expect(comparablePrevRange("All time", 0, at(2026, 7, 30))).toBeNull();
  });

  it("clips the previous period to the same elapsed portion", () => {
    // 15 Jul → compare against 1–15 Jun, not the whole of June.
    expect(comparablePrevRange("This month", 0, at(2026, 7, 15))).toEqual({
      from: "2026-06-01",
      to: "2026-06-15",
    });
  });

  it("still clips on the LAST day of the period", () => {
    // The bug this replaced: `today < sel.end` meant that on 31 Jul the
    // comparison silently reverted to the whole of June, reading as a collapse.
    // June is shorter than July, so the clip lands on its real last day.
    expect(comparablePrevRange("This month", 0, at(2026, 7, 31))).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    });
  });

  it("compares a finished period in full", () => {
    // Selecting June while it is August: June is over, so use all of May.
    expect(comparablePrevRange("This month", -2, at(2026, 8, 10))).toEqual({
      from: "2026-05-01",
      to: "2026-05-31",
    });
  });

  it("clips a part-week to the same number of days", () => {
    // Thu 30 Jul is day 5 of its week → previous week Sun 19 to Thu 23.
    expect(comparablePrevRange("This week", 0, at(2026, 7, 30))).toEqual({
      from: "2026-07-19",
      to: "2026-07-23",
    });
  });

  it("never runs past the end of the previous period", () => {
    // A 31-day month compared from its 31st against a 30-day month.
    const r = comparablePrevRange("This month", 0, at(2026, 5, 31))!;
    expect(r.to).toBe("2026-04-30");
  });
});

describe("bucketize", () => {
  it("buckets by day for a short range", () => {
    const dates = ["2026-07-01", "2026-07-02", "2026-07-03"];
    const b = bucketize(dates, true);
    expect(b.unit).toBe("day");
    expect(b.keyFor("2026-07-09")).toBe("2026-07-09");
    expect(b.labelFor("2026-07-09")).toBe("9/7");
  });

  it("buckets by month once past 31 distinct days", () => {
    const dates = Array.from({ length: 40 }, (_, i) => `2026-0${i < 20 ? 6 : 7}-${String((i % 28) + 1).padStart(2, "0")}`);
    const b = bucketize(dates, true);
    expect(b.unit).toBe("month");
    expect(b.keyFor("2026-07-09")).toBe("2026-07");
    expect(b.labelFor("2026-07")).toBe("Jul");
  });

  it("buckets by year once past 24 distinct months", () => {
    const dates: string[] = [];
    for (let y = 2016; y <= 2026; y++) for (let m = 1; m <= 12; m++) dates.push(`${y}-${String(m).padStart(2, "0")}-01`);
    const b = bucketize(dates, true);
    expect(b.unit).toBe("year");
    expect(b.keyFor("2019-07-09")).toBe("2019");
    expect(b.labelFor("2019")).toBe("2019");
  });

  it("never buckets by day without a bounded range (All time)", () => {
    // hasRange=false is "All time": a handful of distinct dates must still not
    // collapse to day buckets, or the axis would claim a range it doesn't have.
    expect(bucketize(["2026-07-01", "2026-07-02"], false).unit).not.toBe("day");
  });
});

describe("quarters", () => {
  // The team page computed quarters inline before this moved here. The first
  // case asserts the new arithmetic against that old expression verbatim, so
  // the hours a member's card shows on "This quarter" cannot have moved.
  it("matches the team page's previous inline computation", () => {
    const now = at(2026, 8, 3);
    const q = Math.floor(now.getMonth() / 3);
    const old = {
      start: new Date(now.getFullYear(), q * 3, 1),
      end: new Date(now.getFullYear(), q * 3 + 3, 0),
    };
    const b = periodBounds("This quarter", 0, now)!;
    expect(b.start.getTime()).toBe(old.start.getTime());
    expect(b.end.getTime()).toBe(old.end.getTime());
    expect(periodRange("This quarter", 0, now)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("steps back across a year boundary", () => {
    // Q1 2026 minus one quarter is Q4 2025, not "month −3 of 2026".
    expect(periodRange("This quarter", -1, at(2026, 2, 10))).toEqual({
      from: "2025-10-01",
      to: "2025-12-31",
    });
    expect(periodRange("This quarter", -5, at(2026, 8, 3))).toEqual({
      from: "2025-04-01",
      to: "2025-06-30",
    });
    // Four quarters back is the same quarter, previous year.
    expect(periodRange("This quarter", -4, at(2026, 8, 3))).toEqual({
      from: "2025-07-01",
      to: "2025-09-30",
    });
  });

  it("labels quarters, with the year only when it isn't this one", () => {
    expect(rangeLabel("This quarter", 0, at(2026, 8, 3))).toBe("This quarter");
    expect(rangeLabel("This quarter", -1, at(2026, 8, 3))).toBe("Last quarter");
    expect(rangeLabel("This quarter", -2, at(2026, 8, 3))).toBe("Q1");
    expect(rangeLabel("This quarter", -3, at(2026, 8, 3))).toBe("Q4 2025");
  });

  it("clips the previous quarter to the same elapsed portion", () => {
    // Q3 2026 starts 1 Jul; on 3 Aug that's 33 days in, so the comparison
    // window is Q2 (1 Apr) plus 33 days.
    expect(comparablePrevRange("This quarter", 0, at(2026, 8, 3))).toEqual({
      from: "2026-04-01",
      to: "2026-05-04",
    });
  });

  it("periodRange is null for All time", () => {
    expect(periodRange("All time", 0, at(2026, 8, 3))).toBeNull();
  });
});

describe("bucketProjection", () => {
  it("never projects day buckets", () => {
    expect(bucketProjection("day", "2026-07-30", at(2026, 7, 30))).toBeNull();
  });

  it("scales a running month by its elapsed fraction", () => {
    // 15 of 31 days elapsed.
    expect(bucketProjection("month", "2026-07", at(2026, 7, 15))).toBeCloseTo(31 / 15);
  });

  it("does not project a completed month", () => {
    expect(bucketProjection("month", "2026-06", at(2026, 7, 15))).toBeNull();
    // ...including the current month once its last day has arrived.
    expect(bucketProjection("month", "2026-07", at(2026, 7, 31))).toBeNull();
  });

  it("scales a running year by elapsed days", () => {
    // 2026 is not a leap year: 1 Jul is day 182 of 365.
    expect(bucketProjection("year", "2026", at(2026, 7, 1))).toBeCloseTo(365 / 182);
  });

  it("accounts for the leap day in a running year", () => {
    expect(bucketProjection("year", "2024", at(2024, 7, 1))).toBeCloseTo(366 / 183);
  });

  it("does not project a past year or the last day of this one", () => {
    expect(bucketProjection("year", "2025", at(2026, 7, 1))).toBeNull();
    expect(bucketProjection("year", "2026", at(2026, 12, 31))).toBeNull();
  });
});

/**
 * ⚠️ THE REGRESSION: `periodBounds("This week")` used the ms-based `addDays`, so
 * across Israel's clocks-back Sunday (26 Oct 2025) `addDays(start, 6)` landed at
 * 23:00 on the FRIDAY. The week then ended 31 Oct instead of 1 Nov, and every
 * KPI, chart and comparison reading "this week" silently DROPPED Saturday's hours.
 * The suite pins TZ=Asia/Jerusalem; under TZ=UTC there is no transition to cross.
 */
describe("periodBounds across a clocks-back transition", () => {
  it("keeps the week Sun–Sat, so Saturday's hours are not dropped", () => {
    const b = periodBounds("This week", 0, at(2025, 10, 28))!;
    expect(toISODate(b.start)).toBe("2025-10-26");
    expect(toISODate(b.end)).toBe("2025-11-01"); // was 2025-10-31
    expect(daysBetween(b.start, b.end)).toBe(6);
  });

  it("still spans exactly 7 days when stepping back over the boundary", () => {
    for (const offset of [0, -1, -2, -3]) {
      const b = periodBounds("This week", offset, at(2025, 11, 5))!;
      expect(b.start.getDay()).toBe(0);
      expect(daysBetween(b.start, b.end)).toBe(6);
    }
  });
});

/**
 * ⚠️ `bucketProjection` had only `elapsed > 0`, so day one of a period projected it
 * by the period's whole length: 31x on the 1st of a month, 365x on 1 January. One
 * invented bar rescaled the chart and squashed every real one. A period must now be
 * a fifth gone, capping the factor at 5.
 */
describe("bucketProjection minimum elapsed", () => {
  it("does not project the first fifth of a month", () => {
    expect(bucketProjection("month", "2026-08", at(2026, 8, 1))).toBeNull();
    expect(bucketProjection("month", "2026-08", at(2026, 8, 6))).toBeNull(); // 6/31 < 0.2
  });

  it("projects once a fifth of the month has passed, capped at 5x", () => {
    const f = bucketProjection("month", "2026-08", at(2026, 8, 7))!; // 7/31
    expect(f).toBeCloseTo(31 / 7, 5);
    expect(f).toBeLessThanOrEqual(5);
  });

  it("does not project a year from January", () => {
    expect(bucketProjection("year", "2026", at(2026, 1, 1))).toBeNull();
    expect(bucketProjection("year", "2026", at(2026, 2, 1))).toBeNull();
  });

  it("projects a year once a fifth is gone, capped at 5x", () => {
    const f = bucketProjection("year", "2026", at(2026, 4, 1))!;
    expect(f).toBeLessThanOrEqual(5);
    expect(f).toBeGreaterThan(1);
  });

  it("still refuses a complete period and a day unit", () => {
    expect(bucketProjection("month", "2026-08", at(2026, 8, 31))).toBeNull();
    expect(bucketProjection("day", "2026-08-31", at(2026, 8, 20))).toBeNull();
  });
});

describe("bucketize", () => {
  const days = (from: string, count: number) =>
    Array.from({ length: count }, (_, i) => {
      const d = new Date(2026, 0, 1);
      d.setDate(d.getDate() + i);
      void from;
      return toISODate(d);
    });

  it("uses the SPAN, not the number of days with hours", () => {
    // 12 scattered days across ~3 months used to render as 12 day buckets
    const sparse = ["2026-01-05", "2026-01-20", "2026-02-03", "2026-03-28"];
    expect(bucketize(sparse, true).unit).toBe("month");
  });

  it("still buckets by day inside a month", () => {
    expect(bucketize(days("2026-01-01", 20), true).unit).toBe("day");
    expect(bucketize(days("2026-01-01", 31), true).unit).toBe("day");
    expect(bucketize(days("2026-01-01", 32), true).unit).toBe("month");
  });

  it("names the year on month labels when the span crosses one", () => {
    const one = bucketize(["2026-01-10", "2026-08-10", ...days("2026-01-01", 40)], false);
    expect(one.labelFor("2026-08")).toBe("Aug");
    const two = bucketize(["2025-08-10", "2026-08-10"], false);
    expect(two.labelFor("2025-08")).toBe("Aug 25");
    expect(two.labelFor("2026-08")).toBe("Aug 26");
  });

  it("handles no dates at all", () => {
    expect(() => bucketize([], true)).not.toThrow();
  });
});

describe("presetRange", () => {
  it("starts the week on Sunday, via the shared startOfWeek", () => {
    // 2026-08-26 is a Wednesday
    expect(presetRange("This week", at(2026, 8, 26))).toEqual({
      from: "2026-08-23",
      to: "2026-08-29",
    });
    expect(presetRange("Last week", at(2026, 8, 26))).toEqual({
      from: "2026-08-16",
      to: "2026-08-22",
    });
  });

  it("keeps the week whole across a clocks-back transition", () => {
    expect(presetRange("This week", at(2025, 10, 28))).toEqual({
      from: "2025-10-26",
      to: "2025-11-01",
    });
  });
});
