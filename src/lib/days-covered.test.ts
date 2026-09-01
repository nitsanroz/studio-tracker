import { describe, it, expect } from "vitest";
import { daysCoveredInPeriod } from "./period-math";
import { parseISO } from "./format";

/**
 * The figure a client reads at the top of their report. These exist because it
 * used to be measured from `new Date()`, which made it drift after publishing
 * while every other number on the page stayed frozen — and because it used to
 * count days LEFT, which was 0 on every period but the newest.
 */
describe("daysCoveredInPeriod", () => {
  const d = (iso: string) => parseISO(iso);

  it("counts the whole period when the report runs past its end", () => {
    // 1–31 August read in full: 31 days, INCLUSIVE of both ends.
    expect(daysCoveredInPeriod(d("2026-08-01"), d("2026-08-31"), d("2026-09-10"))).toBe(31);
  });

  it("stops at the cut-off when the report ends mid-period", () => {
    // Nitsan's case: a calendar-month period read on the 10th shows 10 days of
    // work, not the 30 the studio bills on.
    expect(daysCoveredInPeriod(d("2026-09-01"), d("2026-09-30"), d("2026-09-10"))).toBe(10);
  });

  it("is 1 on the period's first day, not 0", () => {
    expect(daysCoveredInPeriod(d("2026-09-01"), d("2026-09-30"), d("2026-09-01"))).toBe(1);
  });

  it("is 1 for a single-day period", () => {
    expect(daysCoveredInPeriod(d("2026-09-01"), d("2026-09-01"), d("2026-09-30"))).toBe(1);
  });

  it("is 0 for a period that has not started by the cut-off", () => {
    expect(daysCoveredInPeriod(d("2026-10-01"), d("2026-10-31"), d("2026-09-20"))).toBe(0);
  });

  it("counts a past period in full — the case 'days left' always read 0 for", () => {
    expect(daysCoveredInPeriod(d("2026-07-20"), d("2026-08-20"), d("2026-08-25"))).toBe(32);
  });

  /**
   * ⚠️ The clocks-change guard: built on `daysBetween`, which floors both dates to
   * local midnight, so a period spanning a DST boundary is not an hour short and
   * does not land on the wrong calendar day.
   */
  it("survives a clocks change", () => {
    // Europe/Jerusalem falls back on 25 Oct 2026; ms arithmetic reads 31 here.
    expect(daysCoveredInPeriod(d("2026-10-01"), d("2026-10-31"), d("2026-11-05"))).toBe(31);
  });

  it("ignores the time of day on the cut-off", () => {
    const asOf = new Date(2026, 8, 10, 23, 59);
    expect(daysCoveredInPeriod(d("2026-09-01"), d("2026-09-30"), asOf)).toBe(10);
  });
});
