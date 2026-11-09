import { describe, expect, it } from "vitest";
import type { PublishedEstimate } from "./estimates-data";
import { defaultSelection, isDefault, lineKey, offerTotals, type OfferSelection } from "./offer-selection";

type Line = PublishedEstimate["phases"][number]["lines"][number];
const L = (name: string, min: number, max: number, extra: Partial<Line> = {}): Line => ({
  name,
  description: null,
  hours: { min, max },
  optional: false,
  altGroup: null,
  chosen: true,
  group: null,
  ...extra,
});

const S: PublishedEstimate = {
  company: "Test",
  version: 1,
  rate: 100,
  vatPercent: 18,
  discountPercent: 10,
  discountNote: null,
  intro: null,
  timeline: null,
  closing: null,
  phases: [
    {
      name: "One",
      description: null,
      hours: { min: 15, max: 20 },
      groups: [{ name: "G", hours: { min: 10, max: 12 } }],
      lines: [
        L("a", 5, 8),
        L("two", 10, 12, { altGroup: "Rounds", chosen: true, group: 0 }),
        L("three", 20, 24, { altGroup: "Rounds", chosen: false, group: 0 }),
      ],
    },
    { name: "Extras", description: null, hours: { min: 0, max: 0 }, lines: [L("x", 4, 6, { optional: true })] },
  ],
  totalHours: { min: 15, max: 20 },
  subtotal: { min: 1500, max: 2000 },
  discount: { min: 150, max: 200 },
  net: { min: 1350, max: 1800 },
  publishedAt: "2026-11-09T00:00:00.000Z",
};

const clone = (sel: OfferSelection): OfferSelection => ({ optional: new Set(sel.optional), picks: new Map(sel.picks) });

describe("offer selection", () => {
  it("starts as published: no optional ticked, the chosen option picked, snapshot figures", () => {
    const sel = defaultSelection(S);
    expect(sel.picks.get("Rounds")).toBe(lineKey(0, 1));
    const t = offerTotals(S, sel);
    expect(t.changed).toBe(false);
    expect(t.net).toEqual(S.net);
    expect(t.phase).toEqual([{ min: 15, max: 20 }, { min: 0, max: 0 }]);
    expect(t.group[0][0]).toEqual({ min: 10, max: 12 });
  });

  it("ticking an optional line adds its hours and money, less the discount", () => {
    const sel = clone(defaultSelection(S));
    sel.optional.add(lineKey(1, 0));
    const t = offerTotals(S, sel);
    expect(t.changed).toBe(true);
    expect(t.totalHours).toEqual({ min: 19, max: 26 });
    expect(t.net).toEqual({ min: 1710, max: 2340 });
    expect(t.phase[1]).toEqual({ min: 4, max: 6 });
  });

  it("picking the other option swaps it in — exactly one per group", () => {
    const sel = clone(defaultSelection(S));
    sel.picks.set("Rounds", lineKey(0, 2));
    const t = offerTotals(S, sel);
    expect(t.totalHours).toEqual({ min: 25, max: 32 });
    expect(t.group[0][0]).toEqual({ min: 20, max: 24 });
    expect(isDefault(S, sel)).toBe(false);
    sel.picks.set("Rounds", lineKey(0, 1));
    expect(isDefault(S, sel)).toBe(true);
  });

  it("re-works a percentage line from the counted lines of its category", () => {
    const web: PublishedEstimate = {
      ...S,
      phases: [
        {
          name: "Web",
          description: null,
          hours: { min: 22, max: 33 },
          lines: [
            L("pages", 20, 30, { category: "website" }),
            L("extra page", 10, 10, { category: "website", optional: true }),
            L("mobile", 2, 3, { category: "website", percent: { of: "website", percent: 10 } }),
          ],
        },
      ],
    };
    const sel = clone(defaultSelection(web));
    expect(offerTotals(web, sel).line.get(lineKey(0, 2))).toEqual({ min: 2, max: 3 });
    sel.optional.add(lineKey(0, 1));
    const t = offerTotals(web, sel);
    expect(t.line.get(lineKey(0, 2))).toEqual({ min: 3, max: 4 });
    expect(t.totalHours).toEqual({ min: 33, max: 44 });
  });

  it("an old snapshot without categories keeps its frozen hours", () => {
    const sel = clone(defaultSelection(S));
    expect(offerTotals(S, sel).line.get(lineKey(0, 0))).toEqual({ min: 5, max: 8 });
  });
});
