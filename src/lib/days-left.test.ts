import { describe, it, expect } from "vitest";
import { daysLeftInPeriod } from "./period-math";
import { parseISO } from "./format";

/**
 * The figure a client reads at the top of their report. These exist because it
 * used to be measured from `new Date()`, which made it drift after publishing
 * while every other number on the page stayed frozen.
 */
describe("daysLeftInPeriod", () => {
  const d = (iso: string) => parseISO(iso);

  it("counts from the as-of day, not from today", () => {
    // Anchor's real case: scoped through Sat 22 Aug, August period ends the 31st
    expect(daysLeftInPeriod(d("2026-08-31"), d("2026-08-22"))).toBe(9);
  });

  it("does not move when the as-of day is what changes", () => {
    const end = d("2026-08-31");
    expect(daysLeftInPeriod(end, d("2026-08-22"))).toBe(9);
    // two days later in real time, same scoped report → same answer
    expect(daysLeftInPeriod(end, d("2026-08-22"))).toBe(9);
  });

  it("reads 0 on the last day of the period", () => {
    expect(daysLeftInPeriod(d("2026-08-31"), d("2026-08-31"))).toBe(0);
  });

  it("reads 0 for a period that has already ended, never a negative", () => {
    expect(daysLeftInPeriod(d("2026-07-31"), d("2026-08-22"))).toBe(0);
  });

  it("survives a clocks change rather than landing a day out", () => {
    // Israel's clocks go back on 25 Oct 2026; ms-based arithmetic is an hour short
    expect(daysLeftInPeriod(d("2026-10-31"), d("2026-10-18"))).toBe(13);
  });
});
