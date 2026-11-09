import type { PublishedEstimate } from "./estimates-data";

// The client's own choices on a published offer (`/estimate/[token]`): which
// optional items they tick and which option they pick in each "choose one"
// group, and the totals those choices come to. Pure, browser-side, NOT SAVED —
// the snapshot stays exactly what the studio published.
//
// The rules mirror `totals()` in estimate.ts: an optional line counts only when
// ticked; in a "choose one" group exactly the picked line counts (keyed by the
// group's NAME across the whole offer, as `groupWinners` keys it); every other
// line counts. Money = hours × rate, less the discount %.
//
// ⚠️ PERCENTAGE LINES ARE RE-WORKED ("Mobile +10% of website"): a client who
// ticks an extra website page expects mobile to grow (Nitsan, 2026-11-09). As in
// `lineHours()`, a percentage line is that percent of the COUNTED hours lines of
// its category across the whole offer, rounded up to the half hour, and never
// part of another's base. This needs each line's `category` / `percent`, which
// snapshots carry only since 2026-11-09 — an older snapshot keeps the hours it
// was published with.

type Range = { min: number; max: number };
type Phase = PublishedEstimate["phases"][number];
type Line = Phase["lines"][number];

export interface OfferSelection {
  /** Keys (`phase:line`) of the optional lines the client ticked. */
  optional: Set<string>;
  /** "Choose one" group name → key of the picked line. */
  picks: Map<string, string>;
}

export const lineKey = (phase: number, line: number) => `${phase}:${line}`;

const zero = (): Range => ({ min: 0, max: 0 });
const add = (a: Range, b: Range): Range => ({ min: a.min + b.min, max: a.max + b.max });

/** What the studio published: nothing optional ticked, each group's first chosen line picked. */
export function defaultSelection(s: PublishedEstimate): OfferSelection {
  const picks = new Map<string, string>();
  s.phases.forEach((p, pi) =>
    p.lines.forEach((l, li) => {
      if (l.altGroup && !l.optional && l.chosen && !picks.has(l.altGroup)) picks.set(l.altGroup, lineKey(pi, li));
    }),
  );
  return { optional: new Set(), picks };
}

export function lineCounts(l: Line, key: string, sel: OfferSelection): boolean {
  if (l.optional) return sel.optional.has(key);
  if (l.altGroup) return sel.picks.get(l.altGroup) === key;
  return true;
}

export function isDefault(s: PublishedEstimate, sel: OfferSelection): boolean {
  if (sel.optional.size > 0) return false;
  const d = defaultSelection(s).picks;
  if (d.size !== sel.picks.size) return false;
  for (const [g, k] of d) if (sel.picks.get(g) !== k) return false;
  return true;
}

/** Each line's hours under these choices, by `lineKey` — the snapshot's, except re-worked percentage lines. */
export function lineHoursFor(s: PublishedEstimate, sel: OfferSelection): Map<string, Range> {
  const base = new Map<string, Range>();
  s.phases.forEach((p, pi) =>
    p.lines.forEach((l, li) => {
      if (l.percent || !l.category || !lineCounts(l, lineKey(pi, li), sel)) return;
      base.set(l.category, add(base.get(l.category) ?? zero(), l.hours));
    }),
  );
  const out = new Map<string, Range>();
  s.phases.forEach((p, pi) =>
    p.lines.forEach((l, li) => {
      if (!l.percent) return out.set(lineKey(pi, li), l.hours);
      const b = base.get(l.percent.of) ?? zero();
      const r = (h: number) => Math.ceil(((h * l.percent!.percent) / 100) * 2) / 2;
      out.set(lineKey(pi, li), { min: r(b.min), max: r(b.max) });
    }),
  );
  return out;
}

export interface OfferTotals {
  /** Each line's hours, by `lineKey` (percentage lines re-worked). */
  line: Map<string, Range>;
  /** Counted hours per phase, by phase index. */
  phase: Range[];
  /** Counted hours per subject group, by phase index then group index. */
  group: Range[][];
  totalHours: Range;
  subtotal: Range;
  discount: Range;
  net: Range;
  /** True when the client's choices differ from what was published. */
  changed: boolean;
}

export function offerTotals(s: PublishedEstimate, sel: OfferSelection): OfferTotals {
  const phase = s.phases.map(() => zero());
  const group = s.phases.map((p) => (p.groups ?? []).map(() => zero()));
  const line = lineHoursFor(s, sel);
  let totalHours = zero();
  s.phases.forEach((p, pi) =>
    p.lines.forEach((l, li) => {
      const key = lineKey(pi, li);
      if (!lineCounts(l, key, sel)) return;
      const h = line.get(key) ?? l.hours;
      totalHours = add(totalHours, h);
      phase[pi] = add(phase[pi], h);
      if (l.group != null && group[pi][l.group]) group[pi][l.group] = add(group[pi][l.group], h);
    }),
  );
  const changed = !isDefault(s, sel);
  // Unchanged: show the published figures to the shekel, whatever rounding made them.
  if (!changed) return { line, phase, group, totalHours: s.totalHours, subtotal: s.subtotal, discount: s.discount, net: s.net, changed };
  const subtotal = { min: totalHours.min * s.rate, max: totalHours.max * s.rate };
  const d = (s.discountPercent ?? 0) / 100;
  const discount = { min: subtotal.min * d, max: subtotal.max * d };
  return { line, phase, group, totalHours, subtotal, discount, net: { min: subtotal.min - discount.min, max: subtotal.max - discount.max }, changed };
}
