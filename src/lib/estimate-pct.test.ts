import { describe, expect, it } from "vitest";
import { estimatePct, estimateTone } from "@/components/report-table";

/**
 * The chip beside an estimate on the client's report answers "how much of this is
 * gone?" — the question an estimate raises and the table never answered, since the
 * hours and the estimate sat in neighbouring columns and left the division to the
 * reader.
 */
const H = (h: number) => h * 60;

describe("estimatePct", () => {
  it("is the share of the estimate used, rounded", () => {
    expect(estimatePct(H(5), 10)).toBe(50);
    expect(estimatePct(H(10), 10)).toBe(100);
    expect(estimatePct(H(1), 3)).toBe(33);
  });

  it("goes past 100 rather than clamping — over budget is the thing worth seeing", () => {
    expect(estimatePct(H(15), 10)).toBe(150);
  });

  it("says nothing when there is no estimate", () => {
    expect(estimatePct(H(5), null)).toBeNull();
  });

  /** ⚠️ A 0h estimate would be a division by zero dressed up as insight. */
  it("says nothing for a zero or negative estimate", () => {
    expect(estimatePct(H(5), 0)).toBeNull();
    expect(estimatePct(H(5), -2)).toBeNull();
  });

  it("is 0 when nothing has been logged yet", () => {
    expect(estimatePct(0, 10)).toBe(0);
  });
});

/**
 * ⚠️ NOT the cap's amber-at-70 / red-at-90 scale. This first reused it and Nitsan
 * overruled: a task landing ON its estimate is a job done as planned, not a
 * warning, whereas a period at 90% of its cap is a warning by definition.
 */
describe("estimateTone", () => {
  it("is plain below 100%", () => {
    for (const pct of [0, 50, 70, 90, 99]) expect(estimateTone(pct)).toBe("");
  });

  it("is green at exactly 100%", () => {
    expect(estimateTone(100)).toBe("text-success");
  });

  it("is red above 100%", () => {
    expect(estimateTone(101)).toBe("text-danger");
    expect(estimateTone(250)).toBe("text-danger");
  });
});
