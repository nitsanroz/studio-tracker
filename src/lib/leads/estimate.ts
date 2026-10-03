// Estimate arithmetic — pure, so the editor, the public page and the offer it
// becomes can never disagree about a number.
//
// ⚠️ ₪ IS ALWAYS HOURS × RATE, NEVER TYPED. The Unibeam scope doc (Sep 2026)
// priced a 32–44h deck at 8,400–14,000 ₪ — 263–318 ₪/h on a 350 ₪/h rate —
// because the money was typed beside the hours. Here there is no field to type
// it into.

export type Category = "strategy" | "brand" | "deck" | "website" | "other";

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: "strategy", label: "Strategy" },
  { value: "brand", label: "Brand" },
  { value: "deck", label: "Deck" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
];

export interface ServiceItem {
  id: string;
  name: string;
  category: Category;
  kind: "hours" | "percent";
  minHours: number | null;
  maxHours: number | null;
  percent: number | null;
  percentOf: Category | null;
  description: string | null;
  position: number;
  active: boolean;
}

export interface EstimateLine {
  id: string;
  estimateId: string;
  phaseId: string | null;
  serviceItemId: string | null;
  name: string;
  description: string | null;
  category: Category;
  kind: "hours" | "percent";
  minHours: number | null;
  maxHours: number | null;
  percent: number | null;
  percentOf: Category | null;
  optional: boolean;
  altGroup: string | null;
  chosen: boolean;
  position: number;
  taskId: string | null;
}

export interface EstimatePhase {
  id: string;
  estimateId: string;
  name: string;
  description: string | null;
  position: number;
}

export type EstimateStatus = "draft" | "in_review" | "approved";

export interface Estimate {
  id: string;
  leadId: string;
  version: number;
  status: EstimateStatus;
  rate: number;
  vatPercent: number;
  discountPercent: number | null;
  discountNote: string | null;
  intro: string | null;
  timeline: string | null;
  closing: string | null;
  changeNote: string | null;
  offerId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  shareToken: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface Range {
  min: number;
  max: number;
}

const zero = (): Range => ({ min: 0, max: 0 });
const add = (a: Range, b: Range): Range => ({ min: a.min + b.min, max: a.max + b.max });

/**
 * The one line that counts in each "choose one" group: the first chosen line
 * by position, or none if nothing is chosen.
 *
 * ⚠️ AT MOST ONE PER GROUP, WHATEVER THE STORED FLAGS SAY. Testing found a
 * group with two lines both marked chosen (joining a group used to set it) —
 * the total then counted the workshop AND the alignment session. Deriving the
 * winner here means a stray flag can never put two options in a total.
 */
export function groupWinners(lines: EstimateLine[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of [...lines].sort((a, b) => a.position - b.position)) {
    if (l.altGroup && l.chosen && !out.has(l.altGroup)) out.set(l.altGroup, l.id);
  }
  return out;
}

/**
 * Does this line count toward totals? Optional extras never do; in a
 * "choose one" group only that group's winner does.
 */
export function counts(l: EstimateLine, winners?: Map<string, string>): boolean {
  if (l.optional) return false;
  if (l.altGroup) return winners ? winners.get(l.altGroup) === l.id : l.chosen;
  return true;
}

/**
 * Hours for every line, percentage lines resolved.
 *
 * ⚠️ A PERCENTAGE LINE IS A PERCENT OF THE COUNTED HOURS-LINES IN ITS
 * CATEGORY, ACROSS THE WHOLE ESTIMATE — "Mobile +10% of website" means every
 * website page wherever it sits, not just the ones in the same phase. And a
 * percentage line never counts toward another's base, or two of them would
 * compound.
 */
export function lineHours(lines: EstimateLine[]): Map<string, Range> {
  const winners = groupWinners(lines);
  const base = new Map<Category, Range>();
  for (const l of lines) {
    if (l.kind !== "hours" || !counts(l, winners)) continue;
    base.set(l.category, add(base.get(l.category) ?? zero(), { min: l.minHours ?? 0, max: l.maxHours ?? 0 }));
  }
  const out = new Map<string, Range>();
  for (const l of lines) {
    if (l.kind === "hours") {
      out.set(l.id, { min: l.minHours ?? 0, max: l.maxHours ?? 0 });
    } else {
      const b = l.percentOf ? (base.get(l.percentOf) ?? zero()) : zero();
      const p = (l.percent ?? 0) / 100;
      // Rounded up to the half hour: an estimate quoting 51.6 hours reads as
      // false precision, and rounding down would under-price the work.
      const r = (h: number) => Math.ceil(h * p * 2) / 2;
      out.set(l.id, { min: r(b.min), max: r(b.max) });
    }
  }
  return out;
}

export interface Totals {
  hours: Map<string, Range>;
  phase: Map<string, Range>;
  /** Hours in the total (counted lines only). */
  totalHours: Range;
  /** ₪ before discount and VAT. */
  subtotal: Range;
  discount: Range;
  /** ₪ after discount, before VAT — the figure the studio quotes "+ VAT". */
  net: Range;
  vat: Range;
  gross: Range;
}

export function totals(
  lines: EstimateLine[],
  rate: number,
  vatPercent: number,
  discountPercent: number | null,
): Totals {
  const hours = lineHours(lines);
  const winners = groupWinners(lines);
  const phase = new Map<string, Range>();
  let totalHours = zero();
  for (const l of lines) {
    if (!counts(l, winners)) continue;
    const h = hours.get(l.id) ?? zero();
    totalHours = add(totalHours, h);
    const key = l.phaseId ?? "";
    phase.set(key, add(phase.get(key) ?? zero(), h));
  }
  const money = (r: Range): Range => ({ min: r.min * rate, max: r.max * rate });
  const subtotal = money(totalHours);
  const d = (discountPercent ?? 0) / 100;
  const discount = { min: subtotal.min * d, max: subtotal.max * d };
  const net = { min: subtotal.min - discount.min, max: subtotal.max - discount.max };
  const v = vatPercent / 100;
  const vat = { min: net.min * v, max: net.max * v };
  return { hours, phase, totalHours, subtotal, discount, net, vat, gross: add(net, vat) };
}

const N = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const W = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "52–80 hrs", or "52 hrs" when the range is a point. */
export const fmtHours = (r: Range) => (r.min === r.max ? `${N.format(r.min)} hrs` : `${N.format(r.min)}–${N.format(r.max)} hrs`);
/** "22,400–33,600 NIS" — the studio writes NIS on client documents. */
export const fmtNis = (r: Range) =>
  r.min === r.max ? `${W.format(Math.round(r.min))} NIS` : `${W.format(Math.round(r.min))}–${W.format(Math.round(r.max))} NIS`;
