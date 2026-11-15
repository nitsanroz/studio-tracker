// What the Scenarios advisor is sent (people by initials only) and what of
// its answer is kept (decisions that resolve to the team).

import { describe, expect, it } from "vitest";
import { acceptAdvice, adviceInput, advisePrompt, briefOf, refsOf, type Advice } from "./advise-prompt";
import type { Decision } from "./decisions";
import { DEFAULT_FACTS } from "./facts";
import { runScenario } from "./engine";
import { defaultDemand, futuresFrom } from "./starters";
import type { Baseline, Member } from "./types";

const m = (id: string, name: string, kind: Member["kind"], cost: number, cap = 0): Member => ({
  id, name, initials: name.split(" ").map((w) => w[0]).join(""), kind, monthlyCost: cost, capacity: cap, hours: cap, billable: cap, keys: 0, studio: 0,
});

const baseline: Baseline = {
  start: "2026-11",
  basedOn: ["2026-08", "2026-09", "2026-10"],
  rate: 350,
  keysShare: 0.1,
  soldHours: 500,
  projectIncome: 0,
  team: [m("o", "Dana Owner", "owner", 30_000), m("a", "Avi Cohen", "designer", 20_000, 120), m("f", "Fay Lance", "freelancer", 5_000)],
  otherPayroll: 0,
  office: 20_000,
  otherFixed: 6_000,
  ownerId: "o",
  ownerGross: 15_000,
  employerRatio: 2,
  ownerHours: 30,
  staffHours: 0,
  fx: { EUR: 4, USD: 3.4 },
  references: [{ label: "Last 3 months", hours: 500 }],
  actual: { revenue: 180_000, costs: 160_000, profit: 20_000, freelance: 10_000 },
  profitSinceFacts: 0,
};

describe("advisor input", () => {
  it("names people by initials and ref, never by name", () => {
    const refs = refsOf(baseline.team);
    const ds: Decision[] = [
      { id: "1", type: "person_leave", personId: "a", from: "2026-12" },
      { id: "2", type: "freelancer_add", name: "Melissa Brown", from: "2027-01", rate: 35, currency: "USD", capacity: 90 },
    ];
    const r = runScenario(baseline, ds, futuresFrom(defaultDemand(baseline)), DEFAULT_FACTS);
    const input = adviceInput("advise", baseline, DEFAULT_FACTS, 300_000, futuresFrom(defaultDemand(baseline)), [briefOf("Without Avi Cohen, Fay stays", ds, r, baseline.team, refs)], refs);
    const text = advisePrompt(input);
    expect(text).not.toContain("Avi");
    expect(text).not.toContain("Dana");
    expect(text).not.toContain("Fay");
    expect(text).not.toContain("Melissa");
    expect(text).toContain("AC (P2)");
    expect(text).toContain('"ref": "P2"');
  });

  it("swaps a nickname it was handed, and knows none of its own", () => {
    const refs = refsOf(baseline.team);
    const r = runScenario(baseline, [], futuresFrom(defaultDemand(baseline)), DEFAULT_FACTS);
    // nickname → first name in the tracker, lower case (the server's list, made up here)
    expect(briefOf("Without Avko", [], r, baseline.team, refs, { avko: "avi" }).name).toBe("Without AC (P2)");
    // with no list — a page that isn't the owner's — the word is left as written
    expect(briefOf("Without Avko", [], r, baseline.team, refs).name).toBe("Without Avko");
  });
});

describe("accepting advice", () => {
  const blank = { name: "", label: "", pct: 0, amount: 0, rate: 0, currency: "ILS", capacity: 0, hours: 0, months: 0, paidWritedowns: false, discount: 0, alsoSaves: 0, writeoff: 0, equipmentSale: 0, movingCost: 0, toolCost: 0 };
  const raw: Advice = {
    bottomLine: "Give notice.",
    recommendations: [
      { title: "B", why: "", score: 4, perMonth: 1000, risk: "low", when: "now" },
      { title: "A", why: "", score: 14, perMonth: 0, risk: "high", when: "now" },
    ],
    triggers: [],
    questions: ["Can F take more hours?", ""],
    checkWith: [],
    tryThis: [
      {
        name: "Lean",
        why: "",
        decisions: [
          { ...blank, type: "person_leave", from: "2027-01", personRef: "P2" },
          { ...blank, type: "person_leave", from: "2027-01", personRef: "P9" },
          { ...blank, type: "nonsense", from: "2027-01", personRef: "" },
          { ...blank, type: "office_end", from: "2026-11", personRef: "", months: 4 },
        ],
      },
    ],
  };

  it("keeps decisions that resolve to the team, drops the rest; scores sorted and capped", () => {
    const a = acceptAdvice(raw, baseline.team, refsOf(baseline.team));
    expect(a.recommendations.map((r) => r.score)).toEqual([10, 4]);
    expect(a.questions).toEqual(["Can F take more hours?"]);
    const ds = a.tryThis[0].resolved;
    expect(ds.map((d) => d.type)).toEqual(["person_leave", "office_end"]);
    expect(ds[0].personId).toBe("a");
    expect(ds[1].months).toBe(4);
  });
});
