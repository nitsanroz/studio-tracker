// The parts of the company facts that carry none of the studio’s own figures —
// a date, a threshold set by law, and the merge of stored facts over defaults.
// Safe for client code; the defaults themselves are in facts.ts (server only).

import type { CompanyFacts } from "./types";

/** The 19 January date for a dividend declared on 2025's profits. */
export const DIVIDEND_DUE = "2027-01";

/** The Arrangements Law's retained-earnings line. */
export const ARRANGEMENTS_LAW = 750_000;

/** Stored facts over the defaults — a field missing or the wrong type keeps its default. */
export function factsFrom(stored: unknown, defaults: CompanyFacts): CompanyFacts {
  const out = { ...defaults };
  if (!stored || typeof stored !== "object") return out;
  const s = stored as Record<string, unknown>;
  for (const k of Object.keys(defaults) as (keyof CompanyFacts)[]) {
    const v = s[k];
    const d = defaults[k];
    if (v === null && (k === "cashFloor" || k === "takeHomeFloor")) (out as Record<string, unknown>)[k] = null;
    else if (typeof v === "number" && Number.isFinite(v) && (typeof d === "number" || d === null)) (out as Record<string, unknown>)[k] = v;
    else if (typeof v === "string" && typeof d === "string") (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
