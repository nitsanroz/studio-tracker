import { describe, expect, it } from "vitest";
import { tickTooltip } from "./gantt";

/**
 * The ruler's own label is a bare day number — and at a month boundary it is the
 * month's name printed where that number should be — so the weekday is the one
 * thing a reader cannot get off the chart.
 */
describe("tickTooltip", () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00`);

  /**
   * ⚠️ The WEEKDAY ALONE at day zoom. The day number is directly under the
   * pointer and the month runs along the same row, so repeating either spends a
   * wider chip on something already on screen.
   */
  it("names the weekday and nothing else at day zoom", () => {
    expect(tickTooltip(d("2026-09-14"), "day", 1)).toBe("Monday");
    expect(tickTooltip(d("2026-09-13"), "day", 1)).toBe("Sunday");
  });

  // The studio week is Sun–Thu, so "is that a Friday?" is the question this
  // answers most often.
  it("names a weekend day as plainly as any other", () => {
    expect(tickTooltip(d("2026-09-18"), "day", 1)).toBe("Friday");
    expect(tickTooltip(d("2026-09-19"), "day", 1)).toBe("Saturday");
  });

  /**
   * ⚠️ A week tick covers SEVEN days, so naming only the first one's weekday
   * would be a true statement about a date the reader is not pointing at.
   */
  it("describes the whole span at week zoom", () => {
    expect(tickTooltip(d("2026-09-13"), "week", 7)).toBe("Sun 13 Sep – Sat 19 Sep 2026");
  });

  it("crosses a month inside one week tick", () => {
    expect(tickTooltip(d("2026-08-30"), "week", 7)).toBe("Sun 30 Aug – Sat 5 Sep 2026");
  });

  // The last tick of a chart can be cut short by the window's end.
  it("follows a short span rather than assuming seven days", () => {
    expect(tickTooltip(d("2026-09-13"), "week", 3)).toBe("Sun 13 Sep – Tue 15 Sep 2026");
  });

  it("names the month in full at month zoom", () => {
    expect(tickTooltip(d("2026-09-01"), "month", 30)).toBe("September 2026");
    expect(tickTooltip(d("2027-01-01"), "month", 31)).toBe("January 2027");
  });

  /**
   * ⚠️ Israel's clocks go back on 25 Oct 2026, so the span's end is derived with
   * the calendar-based `shiftDays` — ms arithmetic lands an hour short and names
   * the wrong day. Same trap v1.23.0 deleted from the app.
   */
  it("survives the clocks change", () => {
    expect(tickTooltip(d("2026-10-25"), "week", 7)).toBe("Sun 25 Oct – Sat 31 Oct 2026");
    expect(tickTooltip(d("2026-10-25"), "day", 1)).toBe("Sunday");
  });

  it("reads the year off the END of a span that crosses one", () => {
    expect(tickTooltip(d("2026-12-27"), "week", 7)).toBe("Sun 27 Dec – Sat 2 Jan 2027");
  });
});
