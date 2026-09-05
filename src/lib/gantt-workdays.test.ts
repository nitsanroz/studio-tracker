import { describe, expect, it } from "vitest";
import {
  addWorkDays,
  isWorkDay,
  parseISO,
  snapToWorkDay,
  toISO,
  workDaysBetween,
} from "./gantt";

// The Gantt's scheduling arithmetic. `chartWindow` and the date helpers are
// covered in chart-window.test.ts; this is the working-day calendar, which is
// what actually moves a bar when a task is dragged.
//
// The studio's weekend is FRIDAY and SATURDAY, and `off` carries whole-studio
// days off from the weekly plan. In 2026: 2 Jul is a Thursday, 3 Jul Friday,
// 4 Jul Saturday, 5 Jul Sunday.

const d = (iso: string) => parseISO(iso);
const NONE = new Set<string>();

describe("isWorkDay", () => {
  it("treats Friday and Saturday as the weekend", () => {
    expect(isWorkDay(d("2026-07-03"), NONE)).toBe(false); // Fri
    expect(isWorkDay(d("2026-07-04"), NONE)).toBe(false); // Sat
  });

  it("treats Sunday to Thursday as working days", () => {
    for (const iso of ["2026-07-05", "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-02"]) {
      expect(isWorkDay(d(iso), NONE)).toBe(true);
    }
  });

  it("honours a studio day off on a weekday", () => {
    expect(isWorkDay(d("2026-07-06"), new Set(["2026-07-06"]))).toBe(false);
  });
});

describe("snapToWorkDay", () => {
  it("moves forward off the weekend", () => {
    expect(toISO(snapToWorkDay(d("2026-07-03"), 1, NONE))).toBe("2026-07-05"); // Fri → Sun
  });

  it("moves backward off the weekend", () => {
    expect(toISO(snapToWorkDay(d("2026-07-04"), -1, NONE))).toBe("2026-07-02"); // Sat → Thu
  });

  it("leaves a working day alone", () => {
    expect(toISO(snapToWorkDay(d("2026-07-06"), 1, NONE))).toBe("2026-07-06");
  });

  it("steps over a holiday adjacent to the weekend", () => {
    // Sun 5 Jul off → next working day is Mon 6 Jul.
    expect(toISO(snapToWorkDay(d("2026-07-03"), 1, new Set(["2026-07-05"])))).toBe("2026-07-06");
  });

  it("gives up rather than spinning on an impossible calendar", () => {
    // The 30-iteration guard exists so a bad `off` set cannot hang the UI.
    const everyDayOff = new Set<string>();
    for (let i = 0; i < 60; i++) everyDayOff.add(toISO(new Date(2026, 6, 1 + i)));
    const out = snapToWorkDay(d("2026-07-01"), 1, everyDayOff);
    expect(out).toBeInstanceOf(Date);
  });
});

describe("addWorkDays", () => {
  it("returns the day itself for n=0, snapped forward", () => {
    expect(toISO(addWorkDays(d("2026-07-06"), 0, NONE))).toBe("2026-07-06");
    expect(toISO(addWorkDays(d("2026-07-03"), 0, NONE))).toBe("2026-07-05"); // Fri → Sun
  });

  it("skips the weekend when counting forward", () => {
    // Thu 2 Jul + 1 working day = Sun 5 Jul, not Fri 3 Jul.
    expect(toISO(addWorkDays(d("2026-07-02"), 1, NONE))).toBe("2026-07-05");
  });

  it("counts a full working week as five days", () => {
    // Sun 5 Jul + 5 working days = Sun 12 Jul.
    expect(toISO(addWorkDays(d("2026-07-05"), 5, NONE))).toBe("2026-07-12");
  });

  it("skips a holiday as well as the weekend", () => {
    expect(toISO(addWorkDays(d("2026-07-05"), 1, new Set(["2026-07-06"])))).toBe("2026-07-07");
  });
});

describe("workDaysBetween", () => {
  it("is 1 for a single working day", () => {
    expect(workDaysBetween(d("2026-07-06"), d("2026-07-06"), NONE)).toBe(1);
  });

  it("counts inclusively and skips the weekend", () => {
    // Thu 2 Jul → Sun 5 Jul spans Thu + Sun = 2 working days.
    expect(workDaysBetween(d("2026-07-02"), d("2026-07-05"), NONE)).toBe(2);
  });

  it("counts a Sunday-to-Thursday week as five", () => {
    expect(workDaysBetween(d("2026-07-05"), d("2026-07-09"), NONE)).toBe(5);
  });

  it("subtracts a studio day off", () => {
    expect(workDaysBetween(d("2026-07-05"), d("2026-07-09"), new Set(["2026-07-07"]))).toBe(4);
  });

  it("never returns 0, even across a bare weekend", () => {
    // A bar has to occupy at least one day or it would render zero-width.
    expect(workDaysBetween(d("2026-07-03"), d("2026-07-04"), NONE)).toBe(1);
  });
});
