import { describe, expect, it } from "vitest";
import { billFor, rateFor, type RateTerms } from "./freelance-rate";

// ⚠️ Mirrors studio-tracker's freelance-rate tests. AB's terms, and two months his sheet billed.
const ab: RateTerms = { rateHigh: 55, rateLow: 45, hoursLow: 50, hoursHigh: 150 };

describe("freelance rate", () => {
  it("matches the months AB's sheet billed", () => {
    expect(rateFor(139, ab)).toBe(46.1);
    expect(billFor(139, ab)).toBe(6407.9);
    expect(billFor(113, ab)).toBe(5503.1);
  });
  it("holds the top rate up to the low mark and the bottom rate past the high one", () => {
    expect(rateFor(50, ab)).toBe(55);
    expect(rateFor(215, ab)).toBe(45);
  });
});
