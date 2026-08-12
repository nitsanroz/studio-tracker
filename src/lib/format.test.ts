import { describe, expect, it } from "vitest";
import { formatDate } from "./format";

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
