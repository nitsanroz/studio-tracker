// Every English string on the Scenarios page has a Hebrew line (he.ts):
// the t("…") calls in its files, the board's titles, the decision catalogue,
// the company-fact sources, the past marks' words. A string added in English
// without its Hebrew fails here, by name.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardFor } from "./board";
import { CATALOGUE } from "./decisions";
import { FACT_SOURCE } from "./facts";
import { HE } from "./he";
import { FUTURE_LABEL, type Baseline, type Member } from "./types";

const ROOT = join(__dirname, "../../../..");
const FILES = [
  "src/app/(app)/finance/(full)/scenarios/page.tsx",
  "src/components/finance/scenarios/advisor.tsx",
  "src/components/finance/scenarios/board.tsx",
  "src/components/finance/scenarios/futures.tsx",
  "src/components/finance/scenarios/hover.tsx",
  "src/components/finance/scenarios/pane.tsx",
  "src/components/finance/scenarios/results.tsx",
  "src/components/finance/scenarios/scenario-chart.tsx",
  "src/lib/finance/scenarios/board.ts",
  "src/lib/finance/scenarios/decisions.ts",
  "src/lib/finance/scenarios/starters.ts",
  "src/lib/finance/scenarios/tips.ts",
];

/** The literal strings a file hands to t()/tr(), and its `label: "…"` table entries. */
function stringsIn(file: string): string[] {
  const src = readFileSync(join(ROOT, file), "utf8");
  const out: string[] = [];
  const unquote = (s: string) => JSON.parse(`"${s}"`) as string;
  for (const m of src.matchAll(/\b(?:t|tr)\(\s*"((?:[^"\\]|\\.)*)"/g)) out.push(unquote(m[1]));
  if (/futures\.tsx$|results\.tsx$/.test(file)) for (const m of src.matchAll(/\blabel: "((?:[^"\\]|\\.)*)"/g)) out.push(unquote(m[1]));
  return out;
}

const member = (id: string, kind: Member["kind"], cost = 10_000, cap = 100): Member => ({
  id, name: id, initials: id, kind, monthlyCost: cost, capacity: cap, hours: cap, billable: cap, keys: 0, studio: 0,
  ...(kind === "freelancer" ? { price: { kind: "flat" as const, rate: 100, currency: "ILS" as const } } : {}),
});
const baseline = {
  start: "2026-11", basedOn: ["2026-08", "2026-09", "2026-10"], rate: 350, keysShare: 0.1, soldHours: 500, projectIncome: 0,
  team: [member("o", "owner"), member("s", "staff", 15_000, 0), member("d", "designer"), member("f", "freelancer")],
  otherPayroll: 0, office: 20_000, otherFixed: 6_000, ownerId: "o", ownerGross: 15_000, employerRatio: 2, ownerHours: 15, staffHours: 15,
  fx: { EUR: 4, USD: 3.4 }, references: [], actual: { revenue: 0, costs: 0, profit: 0, freelance: 0 }, profitSinceFacts: 0,
} satisfies Baseline;

function allEnglish(): string[] {
  const out = new Set<string>();
  for (const f of FILES) for (const s of stringsIn(f)) out.add(s);
  for (const meta of Object.values(CATALOGUE)) {
    out.add(meta.label);
    out.add(meta.blurb);
    if (meta.note) out.add(meta.note);
    for (const f of meta.fields) {
      out.add(f.label);
      if (f.hint) out.add(f.hint);
    }
  }
  for (const v of Object.values(FACT_SOURCE)) if (v) out.add(v);
  for (const v of Object.values(FUTURE_LABEL)) out.add(v);
  // The board as English builds it: what Hebrew must translate (subtitles with
  // figures are templates, checked through the files above).
  for (const g of boardFor(baseline)) {
    // A person's group: their name, and an info line filled from a template
    // (the template itself is checked through board.ts above).
    if (!g.id.startsWith("person:")) {
      out.add(g.title);
      out.add(g.info);
    }
    for (const i of g.items) {
      out.add(i.title);
      out.add(i.blurb);
      out.add(i.info);
    }
  }
  // Chosen in code, not literal t("…") calls (advisor.tsx).
  for (const s of ["low risk", "medium risk", "high risk", "accountant", "lawyer"]) out.add(s);
  return [...out].filter((s) => /[A-Za-z]/.test(s));
}

describe("Hebrew for the Scenarios page", () => {
  it("has a Hebrew line for every English string", () => {
    const missing = allEnglish().filter((s) => !(s in HE));
    expect(missing).toEqual([]);
  });

  it("keeps every {placeholder} in the Hebrew line", () => {
    const broken = Object.entries(HE).filter(([en, he]) => {
      const keys = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      return keys(en) !== keys(he);
    });
    expect(broken.map(([en]) => en)).toEqual([]);
  });
});
