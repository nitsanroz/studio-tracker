import { describe, expect, it } from "vitest";
import { fmtHours, fmtNis, lineHours, phaseLayout, phaseLines, totals, type EstimateGroup, type EstimateLine } from "./estimate";

let n = 0;
const line = (over: Partial<EstimateLine>): EstimateLine => ({
  id: `l${++n}`,
  estimateId: "e",
  phaseId: "p1",
  serviceItemId: null,
  name: "x",
  description: null,
  category: "other",
  kind: "hours",
  minHours: 0,
  maxHours: 0,
  percent: null,
  percentOf: null,
  optional: false,
  altGroup: null,
  chosen: true,
  position: 0,
  taskId: null,
  groupId: null,
  ...over,
});

describe("totals", () => {
  it("prices hours at the rate, always", () => {
    const t = totals([line({ minHours: 32, maxHours: 44 })], 350, 18, null);
    // The Unibeam doc said 8,400–14,000 for this; 350/h says otherwise.
    expect(t.subtotal).toEqual({ min: 11200, max: 15400 });
  });

  it("counts only the chosen line of a choose-one group", () => {
    const lines = [
      line({ minHours: 52, maxHours: 80, altGroup: "strategy", chosen: true }),
      line({ minHours: 16, maxHours: 32, altGroup: "strategy", chosen: false }),
    ];
    expect(totals(lines, 350, 18, null).totalHours).toEqual({ min: 52, max: 80 });
  });

  it("never counts two options of one group, even if both are flagged chosen", () => {
    const lines = [
      line({ minHours: 52, maxHours: 80, altGroup: "strategy", chosen: true, position: 1 }),
      line({ minHours: 16, maxHours: 32, altGroup: "strategy", chosen: true, position: 2 }),
    ];
    expect(totals(lines, 350, 18, null).totalHours).toEqual({ min: 52, max: 80 });
  });

  it("leaves optional extras out of the total", () => {
    const lines = [line({ minHours: 10, maxHours: 10 }), line({ minHours: 5, maxHours: 5, optional: true })];
    expect(totals(lines, 350, 18, null).totalHours).toEqual({ min: 10, max: 10 });
  });

  it("works out percentage lines from their category, across phases", () => {
    const home = line({ category: "website", minHours: 100, maxHours: 140, phaseId: "p1" });
    const inner = line({ category: "website", minHours: 20, maxHours: 30, phaseId: "p2" });
    const brand = line({ category: "brand", minHours: 100, maxHours: 100 });
    const mobile = line({ category: "website", kind: "percent", percent: 10, percentOf: "website", minHours: null, maxHours: null });
    const h = lineHours([home, inner, brand, mobile]);
    expect(h.get(mobile.id)).toEqual({ min: 12, max: 17 });
  });

  it("does not let two percentage lines compound", () => {
    const page = line({ category: "website", minHours: 100, maxHours: 100 });
    const a = line({ category: "website", kind: "percent", percent: 10, percentOf: "website" });
    const b = line({ category: "website", kind: "percent", percent: 10, percentOf: "website" });
    const h = lineHours([page, a, b]);
    expect(h.get(a.id)).toEqual({ min: 10, max: 10 });
    expect(h.get(b.id)).toEqual({ min: 10, max: 10 });
  });

  it("rounds a percentage line up to the half hour", () => {
    const page = line({ category: "website", minHours: 33, maxHours: 33 });
    const m = line({ category: "website", kind: "percent", percent: 10, percentOf: "website" });
    expect(lineHours([page, m]).get(m.id)).toEqual({ min: 3.5, max: 3.5 });
  });

  it("applies the discount before VAT", () => {
    const t = totals([line({ minHours: 100, maxHours: 100 })], 350, 18, 10);
    expect(t.subtotal.max).toBe(35000);
    expect(t.discount.max).toBe(3500);
    expect(t.net.max).toBe(31500);
    expect(t.vat.max).toBeCloseTo(5670);
    expect(t.gross.max).toBeCloseTo(37170);
  });

  it("subtotals each phase", () => {
    const t = totals(
      [line({ phaseId: "a", minHours: 10, maxHours: 20 }), line({ phaseId: "b", minHours: 5, maxHours: 5 })],
      350,
      18,
      null,
    );
    expect(t.phase.get("a")).toEqual({ min: 10, max: 20 });
    expect(t.phase.get("b")).toEqual({ min: 5, max: 5 });
  });
});

describe("format", () => {
  it("reads like the studio's documents", () => {
    expect(fmtHours({ min: 52, max: 80 })).toBe("52–80 hrs");
    expect(fmtHours({ min: 8, max: 8 })).toBe("8 hrs");
    expect(fmtNis({ min: 18200, max: 28000 })).toBe("18,200–28,000 NIS");
  });
});

describe("phaseLayout", () => {
  const g = (id: string, phaseId: string, position: number): EstimateGroup => ({ id, estimateId: "e", phaseId, name: id, position });
  it("puts groups first, in order, then the loose lines — the client page's order", () => {
    const groups = [g("gB", "p1", 2), g("gA", "p1", 1)];
    const lines = [
      line({ id: "loose1", position: 1 }),
      line({ id: "b1", groupId: "gB", position: 1 }),
      line({ id: "a2", groupId: "gA", position: 2 }),
      line({ id: "a1", groupId: "gA", position: 1 }),
    ];
    expect(phaseLines("p1", groups, lines).map((l) => l.id)).toEqual(["a1", "a2", "b1", "loose1"]);
  });
  it("renders a line whose group is in another phase as loose, never drops it", () => {
    const lay = phaseLayout("p1", [g("gX", "p2", 1)], [line({ id: "x", groupId: "gX" })]);
    expect(lay.groups).toEqual([]);
    expect(lay.loose.map((l) => l.id)).toEqual(["x"]);
  });
});
