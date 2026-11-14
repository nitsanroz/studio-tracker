import { describe, expect, it } from "vitest";
import { filingCycleStart, isFiled } from "./filing";

describe("filing marks", () => {
  it("start over on the 25th", () => {
    expect(filingCycleStart(new Date(2026, 9, 6))).toEqual(new Date(2026, 8, 25));
    expect(filingCycleStart(new Date(2026, 9, 25))).toEqual(new Date(2026, 9, 25));
    expect(filingCycleStart(new Date(2026, 0, 3))).toEqual(new Date(2025, 11, 25));
  });

  it("count only marks made since the last 25th", () => {
    const oct6 = new Date(2026, 9, 6);
    expect(isFiled(new Date(2026, 9, 2).toISOString(), oct6)).toBe(true);
    expect(isFiled(new Date(2026, 8, 24).toISOString(), oct6)).toBe(false);
    expect(isFiled(new Date(2026, 9, 2).toISOString(), new Date(2026, 9, 25))).toBe(false);
    expect(isFiled(null, oct6)).toBe(false);
  });
});
