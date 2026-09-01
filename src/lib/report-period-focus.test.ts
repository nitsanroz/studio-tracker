import { describe, expect, it } from "vitest";
import { currentPeriodIndex, previousPeriodIndex, periodIndexFromDate } from "./report-period-focus";

const P = (from: string, to: string) => ({ from, to });

describe("currentPeriodIndex", () => {
  it("is the latest period by END date", () => {
    const periods = [P("2026-06-01", "2026-06-30"), P("2026-07-01", "2026-07-31")];
    expect(currentPeriodIndex(periods)).toBe(1);
  });

  it("does NOT depend on where today falls — a frozen report must not drift", () => {
    // Every period is in the past; "current" is still the last one, not none.
    const periods = [P("2024-01-01", "2024-01-31"), P("2024-02-01", "2024-02-29")];
    expect(currentPeriodIndex(periods)).toBe(1);
  });

  it("ignores array order and reads the dates", () => {
    const periods = [P("2026-08-01", "2026-08-31"), P("2026-07-01", "2026-07-31")];
    expect(currentPeriodIndex(periods)).toBe(0);
  });

  it("is -1 with no periods", () => {
    expect(currentPeriodIndex([])).toBe(-1);
  });
});

describe("previousPeriodIndex", () => {
  it("is the period ending just before the current one", () => {
    const periods = [
      P("2026-06-01", "2026-06-30"),
      P("2026-07-01", "2026-07-31"),
      P("2026-08-01", "2026-08-31"),
    ];
    expect(previousPeriodIndex(periods)).toBe(1);
  });

  it("reads end dates rather than position — a period ending early is not 'previous'", () => {
    // Index 1 STARTS later but ENDS first: it is the previous period, not index 0.
    const periods = [P("2026-07-01", "2026-07-31"), P("2026-07-10", "2026-07-15")];
    expect(currentPeriodIndex(periods)).toBe(0);
    expect(previousPeriodIndex(periods)).toBe(1);
  });

  it("is -1 for a client with a single period", () => {
    expect(previousPeriodIndex([P("2026-08-01", "2026-08-31")])).toBe(-1);
  });

  it("is -1 with no periods", () => {
    expect(previousPeriodIndex([])).toBe(-1);
  });

  it("breaks a shared end date on start date, stably", () => {
    const periods = [P("2026-08-10", "2026-08-31"), P("2026-08-01", "2026-08-31")];
    expect(currentPeriodIndex(periods)).toBe(0);
    expect(previousPeriodIndex(periods)).toBe(1);
  });
});

describe("periodIndexFromDate", () => {
  const periods = [
    P("2026-06-01", "2026-06-30"),
    P("2026-07-01", "2026-07-31"),
    P("2026-08-01", "2026-08-31"),
  ];

  it("finds the period by its start date", () => {
    expect(periodIndexFromDate(periods, "2026-07-01")).toBe(1);
  });

  it("is null for no selection", () => {
    expect(periodIndexFromDate(periods, null)).toBeNull();
    expect(periodIndexFromDate(periods, undefined)).toBeNull();
    expect(periodIndexFromDate(periods, "")).toBeNull();
  });

  /**
   * ⚠️ The case the date identity exists for: the client's copy has had a period
   * stripped by `sanitizeSnapshot`, so the same period sits at a DIFFERENT index.
   */
  it("survives a period being removed from the client's copy", () => {
    const sanitized = [periods[0], periods[2]];
    expect(periodIndexFromDate(periods, "2026-08-01")).toBe(2);
    expect(periodIndexFromDate(sanitized, "2026-08-01")).toBe(1);
  });

  it("is null when the focused period was hidden altogether", () => {
    const sanitized = [periods[0], periods[1]];
    expect(periodIndexFromDate(sanitized, "2026-08-01")).toBeNull();
  });
});
