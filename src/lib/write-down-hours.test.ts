import { describe, expect, it } from "vitest";
import { formatHoursDecimal } from "./format";
import { parseWriteDown } from "./write-down-hours";

describe("parseWriteDown", () => {
  it("reads hours as whole minutes", () => {
    expect(parseWriteDown("1.6", 600)).toEqual({ minutes: 96, problem: null });
    expect(parseWriteDown(" 2 ", 600)).toEqual({ minutes: 120, problem: null });
  });

  // ⚠️ The money rule: a figure off a whole minute is refused, never rounded.
  it("still refuses a figure that isn't a whole number of minutes", () => {
    expect(parseWriteDown("1.61", 600).problem).toBe("minute"); // 96.6m
    expect(parseWriteDown("0.33", 600).problem).toBe("minute"); // typed, not the pre-fill
  });

  it("doesn't mistake floating-point noise for a fraction", () => {
    // 4.1 * 60 === 245.99999999999997 in JavaScript
    for (const [h, m] of [["4.1", 246], ["2.05", 123], ["8.2", 492], ["8.3", 498], ["8.05", 483]] as const) {
      expect(parseWriteDown(h, 600)).toEqual({ minutes: m, problem: null });
    }
  });

  it("takes the untouched pre-fill as the entry's exact minutes", () => {
    // every entry length the field can open on, from 1 minute to 10 hours
    for (let m = 1; m <= 600; m++) {
      const text = formatHoursDecimal(m);
      expect(parseWriteDown(text, m, { text, minutes: m })).toEqual({ minutes: m, problem: null });
    }
  });

  it("refuses more than the ceiling, and non-positive input", () => {
    expect(parseWriteDown("2", 90).problem).toBe("over");
    expect(parseWriteDown("0", 90).problem).toBe("positive");
    expect(parseWriteDown("-1", 90).problem).toBe("positive");
    expect(parseWriteDown("abc", 90).problem).toBe("positive");
  });

  it("an empty field is neither valid nor a problem", () => {
    expect(parseWriteDown("  ", 90)).toEqual({ minutes: null, problem: null });
  });
});
