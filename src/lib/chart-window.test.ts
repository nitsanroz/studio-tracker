import { describe, expect, it } from "vitest";
import { chartWindow, daysBetween, parseISO, toISO } from "./gantt";

/**
 * ⚠️ The window was duplicated in the studio chart and the client's shared one,
 * and the copies drifted: v1.12.1 taught the PUBLIC one that milestone dates
 * widen it, and the studio's own never learned. A mark outside the tasks' span
 * was then drawn past the edge of a scroller whose width IS the window —
 * unreachable at any zoom, on the chart where marks are created.
 */
const d = (iso: string) => parseISO(iso);
const today = d("2026-08-24");

describe("chartWindow", () => {
  it("pads a week either side of the extremes", () => {
    const w = chartWindow([d("2026-08-10"), d("2026-08-20")], today, "day");
    expect(toISO(w.from)).toBe("2026-08-03"); // 10 Aug − 7
  });

  it("is widened by a milestone beyond the last task", () => {
    const tasksOnly = chartWindow([d("2026-08-10"), d("2026-08-20")], today, "day");
    const withMark = chartWindow(
      [d("2026-08-10"), d("2026-08-20"), d("2026-11-30")],
      today,
      "day",
    );
    expect(withMark.totalDays).toBeGreaterThan(tasksOnly.totalDays);
    // and the mark is inside the window rather than past its edge
    const offset = daysBetween(withMark.from, d("2026-11-30"));
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThanOrEqual(withMark.totalDays);
  });

  it("is widened by a milestone BEFORE the first task", () => {
    const w = chartWindow([d("2026-08-10"), d("2026-08-20"), d("2026-05-01")], today, "day");
    expect(daysBetween(w.from, d("2026-05-01"))).toBeGreaterThanOrEqual(0);
  });

  it("always contains today, even with no dates at all", () => {
    const w = chartWindow([], today, "day");
    const offset = daysBetween(w.from, today);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThanOrEqual(w.totalDays);
  });

  it("starts on a Sunday at week and month zoom, so columns line up", () => {
    for (const zoom of ["week", "month"] as const) {
      expect(chartWindow([d("2026-08-12")], today, zoom).from.getDay()).toBe(0);
    }
  });

  it("does not snap at day zoom", () => {
    // 5 Aug 2026 is a Wednesday; −7 lands on the Wednesday before
    expect(toISO(chartWindow([d("2026-08-12")], today, "day").from)).toBe("2026-08-05");
  });

  it("floors a short span so two nearby tasks don't make a four-column chart", () => {
    const w = chartWindow([d("2026-08-20"), d("2026-08-23")], today, "day");
    expect(w.totalDays).toBeGreaterThanOrEqual(91);
    expect(chartWindow([d("2026-08-20")], today, "month").totalDays).toBeGreaterThanOrEqual(365);
  });
});
