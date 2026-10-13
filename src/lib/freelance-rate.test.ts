import { describe, expect, it } from "vitest";
import { billFor, rateFor, type RateTerms } from "./freelance-rate";

// AB's terms, and the two months his sheet billed with them.
const ab: RateTerms = { currency: "EUR", rateHigh: 55, rateLow: 45, hoursLow: 50, hoursHigh: 150 };

describe("freelance rate", () => {
  it("matches the months AB's sheet billed", () => {
    expect(rateFor(139, ab)).toBe(46.1);
    expect(billFor(139, ab)).toBe(6407.9);
    expect(rateFor(113, ab)).toBe(48.7);
    expect(billFor(113, ab)).toBe(5503.1);
  });

  it("holds the top rate up to the low mark and the bottom rate past the high one", () => {
    expect(rateFor(10, ab)).toBe(55);
    expect(rateFor(50, ab)).toBe(55);
    expect(rateFor(150, ab)).toBe(45);
    expect(rateFor(215, ab)).toBe(45);
    expect(billFor(0, ab)).toBe(0);
  });
});
