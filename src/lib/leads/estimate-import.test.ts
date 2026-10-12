import { describe, expect, it } from "vitest";
import { buildImportPrompt, extractJson, importTotals, parseImport } from "./estimate-import";
import type { ServiceItem } from "./estimate";

const reply = (obj: unknown, before = "Here's the estimate:", after = "Let me know!") =>
  `${before}\n\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n\n${after}`;

describe("extractJson", () => {
  it("takes the fenced block out of a chatty reply", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```\nThanks')).toBe('{"a":1}');
  });
  it("finds a bare object with prose around it", () => {
    expect(extractJson('Here: {"a":{"b":2}} done')).toBe('{"a":{"b":2}}');
  });
  it("returns null when there is no object", () => {
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("parseImport", () => {
  it("reads a full estimate with groups, options and a percentage line", () => {
    const r = parseImport(
      reply({
        intro: "Hi",
        discountPercent: 5,
        phases: [
          {
            name: "Brand Identity",
            timeframe: "3–4 weeks",
            groups: [{ name: "Logo", items: [{ name: "Logo design", category: "brand", minHours: 30, maxHours: 40 }] }],
            items: [
              { name: "Direction A", category: "brand", hours: [10, 12], chooseOne: "Direction" },
              { name: "Direction B", category: "brand", hours: "14-18", chooseOne: "Direction", chosen: true },
            ],
          },
          {
            name: "Website",
            items: [
              { name: "Homepage", category: "Website", minHours: 20, maxHours: 30 },
              { name: "QA", category: "website", percent: 10, percentOf: "website" },
              { name: "Webflow", category: "website", hours: 40, optional: true },
            ],
          },
        ],
      }),
    );
    expect(r.errors).toEqual([]);
    const e = r.estimate!;
    expect(e.discountPercent).toBe(5);
    expect(e.phases[0].timeframe).toBe("3–4 weeks");
    expect(e.phases[0].groups[0].items[0]).toMatchObject({ minHours: 30, maxHours: 40 });
    const [a, b] = e.phases[0].items;
    expect(a).toMatchObject({ minHours: 10, maxHours: 12, chosen: false });
    expect(b).toMatchObject({ minHours: 14, maxHours: 18, chosen: true });
    const [home, qa, wf] = e.phases[1].items;
    expect(home.category).toBe("website"); // case-insensitive
    expect(qa).toMatchObject({ kind: "percent", percent: 10, percentOf: "website" });
    expect(wf).toMatchObject({ minHours: 40, maxHours: 40, optional: true, chosen: true });
  });

  it("marks the FIRST option chosen when none is, and only one when several are", () => {
    const none = parseImport(reply({ phases: [{ name: "S", items: [
      { name: "A", hours: 1, chooseOne: "G" }, { name: "B", hours: 2, chooseOne: "G" }] }] }));
    expect(none.estimate!.phases[0].items.map((i) => i.chosen)).toEqual([true, false]);
    const both = parseImport(reply({ phases: [{ name: "S", items: [
      { name: "A", hours: 1, chooseOne: "G", chosen: true }, { name: "B", hours: 2, chooseOne: "G", chosen: true }] }] }));
    expect(both.estimate!.phases[0].items.map((i) => i.chosen)).toEqual([true, false]);
  });

  it("refuses an item with no hours rather than inventing them", () => {
    const r = parseImport(reply({ phases: [{ name: "S", items: [{ name: "Mystery" }] }] }));
    expect(r.estimate).toBeNull();
    expect(r.errors[0]).toMatch(/Mystery.*no hours/);
  });

  it("swaps an inverted range and says so", () => {
    const r = parseImport(reply({ phases: [{ name: "S", items: [{ name: "X", minHours: 9, maxHours: 4 }] }] }));
    expect(r.estimate!.phases[0].items[0]).toMatchObject({ minHours: 4, maxHours: 9 });
    expect(r.warnings.join(" ")).toMatch(/swapped/);
  });

  it("files an unknown category under Other with a warning, and maps common aliases", () => {
    const r = parseImport(reply({ phases: [{ name: "S", items: [
      { name: "X", category: "illustration", hours: 2 }, { name: "Y", category: "slides", hours: 2 }] }] }));
    expect(r.estimate!.phases[0].items.map((i) => i.category)).toEqual(["other", "deck"]);
    expect(r.warnings.join(" ")).toMatch(/illustration/);
  });

  it("reports invalid JSON, an empty paste, and an estimate with no sections", () => {
    expect(parseImport("").errors[0]).toMatch(/Nothing pasted/);
    expect(parseImport('```json\n{"phases": [}\n```').errors[0]).toMatch(/valid JSON/);
    expect(parseImport(reply({ intro: "hi" })).errors[0]).toMatch(/phases/);
  });

  it("skips a nameless item but keeps going", () => {
    const r = parseImport(reply({ phases: [{ name: "S", items: [{ hours: 3 }, { name: "Real", hours: 3 }] }] }));
    expect(r.estimate!.phases[0].items.map((i) => i.name)).toEqual(["Real"]);
    expect(r.warnings.join(" ")).toMatch(/no name/);
  });
});

describe("importTotals", () => {
  it("leaves optional and unchosen items out and adds percent lines, like the editor", () => {
    const r = parseImport(reply({ phases: [{ name: "S", items: [
      { name: "Home", category: "website", hours: [10, 20] },
      { name: "QA", category: "website", percent: 10, percentOf: "website" },
      { name: "Extra", category: "website", hours: 100, optional: true },
      { name: "Alt A", category: "brand", hours: 5, chooseOne: "G" },
      { name: "Alt B", category: "brand", hours: 50, chooseOne: "G" },
    ] }] }));
    const t = importTotals(r.estimate!, 350, 18);
    // 10–20 + QA 10% (1–2, rounded up to the half hour) + Alt A 5
    expect(t.totalHours.min).toBeGreaterThanOrEqual(16);
    expect(t.totalHours.max).toBeLessThanOrEqual(27.5);
    expect(t.totalHours.max).toBeLessThan(100);
  });
});

describe("buildImportPrompt", () => {
  const lib: ServiceItem[] = [
    { id: "1", name: "Homepage", category: "website", kind: "hours", minHours: 24, maxHours: 40, percent: null, percentOf: null, description: null, position: 1, active: true },
    { id: "2", name: "QA", category: "website", kind: "percent", minHours: null, maxHours: null, percent: 10, percentOf: "website", description: null, position: 2, active: true },
    { id: "3", name: "Retired", category: "other", kind: "hours", minHours: 1, maxHours: 2, percent: null, percentOf: null, description: null, position: 3, active: false },
  ];
  it("names the company, the rate and the active library items only", () => {
    const p = buildImportPrompt("Acme", lib, 350);
    expect(p).toContain("Acme");
    expect(p).toContain("350 NIS/h");
    expect(p).toContain("Homepage [website] 24–40 h");
    expect(p).toContain("QA [website] = 10% of website hours");
    expect(p).not.toContain("Retired");
  });
});
