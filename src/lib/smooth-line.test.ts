import { describe, expect, it } from "vitest";
import { areaPath, smoothPath } from "./smooth-line";

/** every y the path's control points and ends reach */
const ys = (d: string) =>
  [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));

describe("smoothPath", () => {
  it("draws nothing, a point, or a straight segment for short inputs", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 0, y: 5 }])).toBe("M0,5");
    expect(smoothPath([{ x: 0, y: 5 }, { x: 10, y: 1 }])).toBe("M0,5 L10,1");
  });

  it("never swings past the points it joins (a zero month stays on the axis)", () => {
    const pts = [
      { x: 0, y: 100 },
      { x: 10, y: 0 },
      { x: 20, y: 100 },
      { x: 30, y: 100 },
      { x: 40, y: 20 },
    ];
    const all = ys(smoothPath(pts));
    expect(Math.min(...all)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...all)).toBeLessThanOrEqual(100);
  });

  it("closes the area down to the baseline", () => {
    const d = areaPath([{ x: 0, y: 10 }, { x: 10, y: 4 }, { x: 20, y: 8 }], 50);
    expect(d.endsWith("L20,50 L0,50 Z")).toBe(true);
    expect(areaPath([{ x: 0, y: 1 }], 50)).toBe("");
  });
});
