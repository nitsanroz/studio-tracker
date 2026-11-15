import { describe, expect, it } from "vitest";
import { trendsOf, type AmountRow } from "./trends";

const row = (year: number, month: number, name: string, amount: number, predicted = false): AmountRow => ({ year, month, name, amount, predicted });

// Made-up people and amounts.
const ROWS: AmountRow[] = [
  // 2025: two people, all year for one, half for the other
  ...Array.from({ length: 12 }, (_, i) => row(2025, i + 1, "Ada", 100)),
  ...Array.from({ length: 6 }, (_, i) => row(2025, i + 1, "Ben", 50)),
  // 2026: Ada got a raise, Ben left, Cy joined in March; April is a forecast
  row(2026, 1, "Ada", 120),
  row(2026, 2, "Ada", 120),
  row(2026, 3, "Ada", 120),
  row(2026, 3, "Cy", 80),
  row(2026, 4, "Ada", 120, true),
  row(2026, 4, "Cy", 80, true),
];

describe("trendsOf", () => {
  const t = trendsOf(ROWS, 2026, 3);

  it("sums each month and sets it against the same month last year", () => {
    expect(t.months).toHaveLength(12);
    expect(t.months[0]).toEqual({ month: 1, amount: 120, lastYear: 150, predicted: false });
    expect(t.months[2]).toEqual({ month: 3, amount: 200, lastYear: 150, predicted: false });
    expect(t.months[3]).toEqual({ month: 4, amount: 200, lastYear: 150, predicted: true });
    // an empty month is not a forecast, and last year still shows
    expect(t.months[6]).toEqual({ month: 7, amount: 0, lastYear: 100, predicted: false });
  });

  it("compares only the months it was asked to", () => {
    expect(t.through).toBe(3);
    expect(t.soFar).toBe(440);
    expect(t.lastYearSoFar).toBe(450);
    expect(t.change).toBeCloseTo(-10 / 450);
    expect(t.average).toBeCloseTo(440 / 3);
    expect(t.peak).toEqual({ month: 3, amount: 200 });
  });

  it("lays the years side by side, this one marked partial", () => {
    expect(t.years).toEqual([
      { year: 2025, amount: 1500, partial: false },
      { year: 2026, amount: 440, partial: true },
    ]);
    expect(trendsOf(ROWS, 2025, 12).years).toEqual([{ year: 2025, amount: 1500, partial: false }]);
  });

  it("ranks who the money goes to, with shares of the compared months", () => {
    expect(t.people).toEqual([
      { name: "Ada", amount: 360, share: 360 / 440 },
      { name: "Cy", amount: 80, share: 80 / 440 },
    ]);
    expect(t.others).toEqual({ count: 0, amount: 0, share: 0 });
    expect(t.headcount).toEqual({ now: 2, lastYear: 2 });
  });

  it("groups everyone past the fifth", () => {
    const many = ["A", "B", "C", "D", "E", "F", "G"].map((n, i) => row(2026, 1, n, 70 - i * 10));
    const m = trendsOf(many, 2026, 12);
    expect(m.people.map((p) => p.name)).toEqual(["A", "B", "C", "D", "E"]);
    expect(m.others).toEqual({ count: 2, amount: 30, share: 30 / 280 });
  });

  it("names what moved most against last year, and why", () => {
    expect(t.movers).toEqual([
      { name: "Ben", change: -150, kind: "gone" },
      { name: "Cy", change: 80, kind: "new" },
      { name: "Ada", change: 60, kind: "up" },
    ]);
  });

  it("has nothing to compare with when last year is empty", () => {
    const alone = trendsOf(ROWS.filter((r) => r.year === 2026), 2026, 3);
    expect(alone.lastYearSoFar).toBeNull();
    expect(alone.change).toBeNull();
    expect(alone.months[0].lastYear).toBeNull();
    expect(alone.movers).toEqual([]);
    expect(alone.headcount.lastYear).toBeNull();
  });

  it("is all zeros, not NaN, for an empty year", () => {
    const empty = trendsOf([], 2026, 5);
    expect(empty.soFar).toBe(0);
    expect(empty.average).toBe(0);
    expect(empty.peak).toBeNull();
    expect(empty.people).toEqual([]);
    expect(empty.years).toEqual([]);
  });
});
