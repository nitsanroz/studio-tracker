import { describe, expect, it } from "vitest";
import { formatDate, greetingFor } from "./format";

describe("greetingFor", () => {
  const at = (h: number) => greetingFor(new Date(2026, 7, 17, h, 30));

  it("names the three parts of the day", () => {
    expect(at(9)).toBe("Good morning");
    expect(at(14)).toBe("Good afternoon");
    expect(at(20)).toBe("Good evening");
  });

  // The boundaries are the whole reason this is one function rather than two
  // inline copies: noon is afternoon, 18:00 is evening, and midnight is morning
  // (nobody in the studio is greeted at 00:30, but "Good evening" for the small
  // hours would still be wrong).
  it("puts each boundary on the later greeting", () => {
    expect(at(0)).toBe("Good morning");
    expect(at(11)).toBe("Good morning");
    expect(at(12)).toBe("Good afternoon");
    expect(at(17)).toBe("Good afternoon");
    expect(at(18)).toBe("Good evening");
    expect(at(23)).toBe("Good evening");
  });
});

describe("formatDate", () => {
  it("formats a plain date", () => {
    expect(formatDate("2026-08-11")).toBe("11/8/26");
    expect(formatDate("2025-01-05")).toBe("5/1/25");
  });

  // ⚠️ Every `created_at` column holds a full TIMESTAMP, not a date. Splitting
  // on "-" without slicing first made the day `11T17:48:52.724326+00:00`, so
  // `Number()` returned NaN and the intake queue printed every submission as
  // "NaN/8/26" — for months, on the pending cards, before anyone noticed.
  it("accepts a full ISO timestamp", () => {
    expect(formatDate("2026-08-11T17:48:52.724326+00:00")).toBe("11/8/26");
    expect(formatDate("2026-08-11T00:00:00Z")).toBe("11/8/26");
  });
});
