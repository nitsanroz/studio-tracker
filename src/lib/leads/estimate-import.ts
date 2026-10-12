// Import an estimate worked out in a Claude conversation (Nitsan, 2026-10-12):
// "add option to add new estimate that i did on claude … instead of building item
// by item in the tracker".
//
// ⚠️ NO AI IN THE TRACKER, BY CHOICE. Nitsan picked "structured paste" over having
// the app call the Anthropic API (no running cost, the same call he made for the
// Leads Phase 3 work). So the tracker hands out a PROMPT that asks Claude to answer
// in one fixed JSON shape, and this module reads that answer exactly. Everything
// here is pure — no Supabase, no React — so the reader is unit-tested and the
// modal only renders its verdict.
//
// The reader is deliberately forgiving about the WRAPPING (a ```json fence, a line
// of prose before or after) and about small spelling differences in values
// ("Website", "12-16", [12, 16]), but never guesses at structure: a missing item
// name or an item with no hours is reported, not invented.

import { CATEGORIES, totals, type Category, type EstimateLine, type Range, type ServiceItem } from "./estimate";

export interface ImportedItem {
  name: string;
  description: string | null;
  category: Category;
  kind: "hours" | "percent";
  minHours: number | null;
  maxHours: number | null;
  percent: number | null;
  percentOf: Category | null;
  optional: boolean;
  /** The "choose one" group name, or null. */
  chooseOne: string | null;
  chosen: boolean;
}

export interface ImportedGroup {
  name: string;
  items: ImportedItem[];
}

export interface ImportedPhase {
  name: string;
  description: string | null;
  timeframe: string | null;
  groups: ImportedGroup[];
  items: ImportedItem[];
}

export interface ImportedEstimate {
  intro: string | null;
  closing: string | null;
  discountPercent: number | null;
  phases: ImportedPhase[];
}

export interface ImportResult {
  estimate: ImportedEstimate | null;
  /** Problems that stop the import. */
  errors: string[];
  /** Things the reader fixed or skipped — shown so nothing changes silently. */
  warnings: string[];
}

const CATEGORY_VALUES = new Set<string>(CATEGORIES.map((c) => c.value));
const CATEGORY_ALIASES: Record<string, Category> = {
  branding: "brand",
  identity: "brand",
  logo: "brand",
  web: "website",
  site: "website",
  presentation: "deck",
  decks: "deck",
  slides: "deck",
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function category(v: unknown, where: string, warnings: string[]): Category {
  const raw = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!raw) return "other";
  if (CATEGORY_VALUES.has(raw)) return raw as Category;
  if (CATEGORY_ALIASES[raw]) return CATEGORY_ALIASES[raw];
  warnings.push(`${where}: unknown category "${String(v)}" — filed under Other.`);
  return "other";
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** Hours as {min,max} from any of: minHours/maxHours, hours: 12, hours: [12, 16], hours: "12-16". */
function hoursOf(o: Record<string, unknown>): { min: number; max: number } | null {
  let min = num(o.minHours ?? o.min_hours ?? o.min);
  let max = num(o.maxHours ?? o.max_hours ?? o.max);
  const h = o.hours;
  if (min === null && max === null && h !== undefined) {
    if (Array.isArray(h)) {
      min = num(h[0]);
      max = num(h[1] ?? h[0]);
    } else if (typeof h === "string" && /[-–—]/.test(h)) {
      const [a, b] = h.split(/[-–—]/);
      min = num(a);
      max = num(b);
    } else {
      min = max = num(h);
    }
  }
  if (min === null && max === null) return null;
  return { min: min ?? max!, max: max ?? min! };
}

function item(raw: unknown, where: string, errors: string[], warnings: string[]): ImportedItem | null {
  if (!raw || typeof raw !== "object") {
    errors.push(`${where}: an item is not an object.`);
    return null;
  }
  const o = raw as Record<string, unknown>;
  const name = text(o.name ?? o.title);
  if (!name) {
    warnings.push(`${where}: an item with no name was skipped.`);
    return null;
  }
  const at = `${where} → “${name}”`;
  const cat = category(o.category, at, warnings);
  const pct = num(o.percent);
  if (pct !== null) {
    if (pct <= 0) {
      errors.push(`${at}: the percentage must be above 0.`);
      return null;
    }
    return {
      name,
      description: text(o.description),
      category: cat,
      kind: "percent",
      minHours: null,
      maxHours: null,
      percent: pct,
      percentOf: category(o.percentOf ?? o.percent_of ?? "website", at, warnings),
      optional: o.optional === true,
      chooseOne: text(o.chooseOne ?? o.choose_one),
      chosen: o.chosen === true,
    };
  }
  const h = hoursOf(o);
  if (!h) {
    errors.push(`${at}: no hours (give minHours and maxHours).`);
    return null;
  }
  let { min, max } = h;
  if (min < 0 || max < 0) {
    errors.push(`${at}: hours can't be negative.`);
    return null;
  }
  if (min > max) {
    [min, max] = [max, min];
    warnings.push(`${at}: min was above max — swapped to ${min}–${max}.`);
  }
  return {
    name,
    description: text(o.description),
    category: cat,
    kind: "hours",
    minHours: min,
    maxHours: max,
    percent: null,
    percentOf: null,
    optional: o.optional === true,
    chooseOne: text(o.chooseOne ?? o.choose_one),
    chosen: o.chosen === true,
  };
}

function items(raw: unknown, where: string, errors: string[], warnings: string[]): ImportedItem[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push(`${where}: "items" must be a list.`);
    return [];
  }
  return raw.flatMap((r) => item(r, where, errors, warnings) ?? []);
}

/** The JSON object inside a reply: a ```json fence if there is one, else first "{" to last "}". */
export function extractJson(input: string): string | null {
  const fence = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : input;
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  return a >= 0 && b > a ? body.slice(a, b + 1) : null;
}

export function parseImport(input: string): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input.trim()) return { estimate: null, errors: ["Nothing pasted yet."], warnings };
  const json = extractJson(input);
  if (!json) return { estimate: null, errors: ["No estimate found — the reply should contain one JSON object."], warnings };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return {
      estimate: null,
      errors: [`The estimate isn't valid JSON (${e instanceof Error ? e.message : "parse error"}). Ask Claude to send it again as plain JSON.`],
      warnings,
    };
  }
  const root = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const rawPhases = root.phases ?? root.sections;
  if (!Array.isArray(rawPhases) || rawPhases.length === 0) {
    return { estimate: null, errors: ['No sections — the estimate needs a "phases" list.'], warnings };
  }
  const phases: ImportedPhase[] = rawPhases.map((rp, i) => {
    const p = (rp && typeof rp === "object" ? rp : {}) as Record<string, unknown>;
    let name = text(p.name ?? p.title);
    if (!name) {
      name = `Phase ${i + 1}`;
      warnings.push(`Section ${i + 1} had no name — called “${name}”.`);
    }
    const groups: ImportedGroup[] = [];
    if (p.groups !== undefined) {
      if (!Array.isArray(p.groups)) errors.push(`${name}: "groups" must be a list.`);
      else
        for (const rg of p.groups) {
          const g = (rg && typeof rg === "object" ? rg : {}) as Record<string, unknown>;
          const gname = text(g.name) ?? "Group";
          const gi = items(g.items, `${name} → ${gname}`, errors, warnings);
          if (gi.length) groups.push({ name: gname, items: gi });
          else warnings.push(`${name} → ${gname}: an empty group was skipped.`);
        }
    }
    return {
      name,
      description: text(p.description),
      timeframe: text(p.timeframe),
      groups,
      items: items(p.items, name, errors, warnings),
    };
  });
  // At most one chosen per "choose one" group, the first one if none is marked —
  // the editor derives the winner the same way (groupWinners), this just keeps the
  // stored flags honest.
  const all = phases.flatMap((p) => [...p.groups.flatMap((g) => g.items), ...p.items]);
  const winner = new Map<string, ImportedItem>();
  for (const it of all) if (it.chooseOne && it.chosen && !winner.has(it.chooseOne)) winner.set(it.chooseOne, it);
  for (const it of all) if (it.chooseOne && !winner.has(it.chooseOne)) winner.set(it.chooseOne, it);
  // A line outside any group keeps the column default (chosen = true, 0045).
  for (const it of all) it.chosen = it.chooseOne ? winner.get(it.chooseOne) === it : true;
  if (all.length === 0) errors.push("No items with hours were found in any section.");
  const discount = num(root.discountPercent ?? root.discount_percent);
  if (discount !== null && (discount < 0 || discount >= 100)) warnings.push(`Discount ${discount}% ignored — it must be 0–99.`);
  return {
    estimate: errors.length
      ? null
      : {
          intro: text(root.intro),
          closing: text(root.closing),
          discountPercent: discount !== null && discount > 0 && discount < 100 ? discount : null,
          phases,
        },
    errors,
    warnings,
  };
}

/** Totals for the review step, computed with the editor's own `totals()` so the preview can't disagree with it. */
export function importTotals(est: ImportedEstimate, rate: number, vatPercent: number) {
  const lines: EstimateLine[] = [];
  let n = 0;
  // Sections are keyed by POSITION ("0", "1", …), not name — two sections may share a name.
  for (const [pi, p] of est.phases.entries())
    for (const it of [...p.groups.flatMap((g) => g.items), ...p.items])
      lines.push({
        id: `i${n}`,
        estimateId: "import",
        phaseId: String(pi),
        serviceItemId: null,
        name: it.name,
        description: it.description,
        category: it.category,
        kind: it.kind,
        minHours: it.minHours,
        maxHours: it.maxHours,
        percent: it.percent,
        percentOf: it.percentOf,
        optional: it.optional,
        altGroup: it.chooseOne,
        chosen: it.chosen,
        position: n++,
        taskId: null,
        groupId: null,
      });
  return totals(lines, rate, vatPercent, est.discountPercent ?? 0);
}

export type { Range };

/**
 * The prompt Nitsan pastes at the end of a Claude conversation. It names the
 * studio's library and rate so Claude reuses the studio's own items and sizes,
 * and it pins the exact JSON shape `parseImport` reads.
 */
export function buildImportPrompt(company: string, library: ServiceItem[], rate: number): string {
  const lib = library
    .filter((i) => i.active)
    .map((i) =>
      i.kind === "percent"
        ? `- ${i.name} [${i.category}] = ${i.percent}% of ${i.percentOf} hours`
        : `- ${i.name} [${i.category}] ${i.minHours ?? 0}–${i.maxHours ?? 0} h`,
    )
    .join("\n");
  return `Turn the scope we discussed for ${company} into an estimate for the Studio&more tracker.

Answer with ONE JSON object only, inside a \`\`\`json code block, in exactly this shape:

{
  "intro": "Client-facing opening paragraph (optional)",
  "closing": "Client-facing closing line (optional)",
  "discountPercent": 0,
  "phases": [
    {
      "name": "Section name, e.g. Brand Identity",
      "description": "Client-facing description (optional)",
      "timeframe": "e.g. 3–4 weeks (optional)",
      "groups": [
        { "name": "Subject inside the section (optional)", "items": [ /* items, same shape as below */ ] }
      ],
      "items": [
        {
          "name": "Item name",
          "description": "Client-facing description (optional)",
          "category": "strategy | brand | deck | website | other",
          "minHours": 12,
          "maxHours": 16,
          "optional": false,
          "chooseOne": null
        }
      ]
    }
  ]
}

Rules:
- Hours are a range in hours (minHours ≤ maxHours). Never write money — the tracker prices everything at ${rate} NIS/h.
- "optional": true for extras the client may add, not counted in the total.
- Alternatives the client picks between share the same "chooseOne" name (e.g. "Logo direction"); mark the recommended one with "chosen": true.
- A percentage item has "percent" and "percentOf" (a category) instead of hours, e.g. { "name": "QA", "category": "website", "percent": 10, "percentOf": "website" }.
- "groups" is optional — use it only when a section has distinct subjects.
- Prefer the studio's standard items below (same names) and stay near their sizes unless we agreed otherwise:
${lib || "- (no library items yet)"}`;
}
