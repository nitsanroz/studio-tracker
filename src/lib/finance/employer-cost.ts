// Reading Michpal's monthly employer-cost report (תמחיר חודשי / כל העובדים)
// into what each employee cost the studio that month — the figure finance
// books as their salary (finance_salaries.gross_amount).
//
// Pure, no imports: scripts/import-employer-cost.mjs runs it under plain Node.
//
// The report's total-cost column prints with its leading digits missing
// (".34" for ₪36,880.34), so the total is added up from the cost columns
// (payments, pension, study fund, severance, other, National Insurance and
// employer's tax, less any reduction) and checked against the cents that do
// print. A row whose cents disagree is returned with `checked: false`.

import type { TextItem } from "./payslip";

export interface EmployerCostRow {
  /** Michpal's employee number ("0006"). */
  number: string;
  /** The name as printed (Hebrew, family name first). */
  name: string;
  /** תשלומים: the gross paid — the payslip's סה"כ תשלומים. */
  payments: number;
  /** Everything the employer paid on top (pension, fund, severance, NI…). */
  employerCosts: number;
  /** payments + employerCosts − reductions: what they cost the studio. */
  total: number;
  /** The total's printed cents agree with the sum. */
  checked: boolean;
}

const NUMBER = /^-?[\d,]*\.?\d+$/;
const amount = (s: string) => (NUMBER.test(s.trim()) ? Number(s.trim().replace(/,/g, "")) : null);

/** The report's columns by their headers' x (right to left on the page). */
interface Columns {
  payments: number;
  /** The reduction column (הפחתה) — subtracted. */
  reduction: number | null;
  /** Left of this is the total-cost column, which prints only its cents. */
  totalEdge: number;
}

function columnsOf(items: TextItem[]): Columns | null {
  const find = (word: string) => items.find((i) => i.s.trim() === word);
  const payments = find("תשלומים");
  const pension = find("תגמולי");
  if (!payments || !pension) return null;
  const reduction = find("הפחתה");
  // The total column sits left of the reduction one, or well left of the rest.
  const totalEdge = reduction ? reduction.x - 30 : 110;
  return { payments: payments.x, reduction: reduction?.x ?? null, totalEdge };
}

export function parseEmployerCost(items: TextItem[]): EmployerCostRow[] {
  const cols = columnsOf(items);
  if (!cols) return [];
  // Each employee starts at their 4-digit number on the far right; their
  // figures sit on that line and the one just below it.
  const anchors = items
    .filter((i) => /^\d{4}$/.test(i.s.trim()) && i.x > cols.payments + 60)
    .sort((a, b) => b.y - a.y);
  // A department subtotal or the company total ends the block above it —
  // whichever is NEAREST below each employee, so a second department's last
  // employee doesn't sweep the totals rows under it into their figures.
  const totalsYs = items.filter((i) => /^(סך|סה"כ)$/.test(i.s.trim()) && i.x > cols.payments + 60).map((i) => i.y);
  const rows: EmployerCostRow[] = [];
  anchors.forEach((a, k) => {
    const top = a.y + 3;
    const bottom = 3 + Math.max(anchors[k + 1]?.y ?? -Infinity, ...totalsYs.filter((y) => y < a.y));
    const mine = items.filter((i) => i.y <= top && i.y > bottom && i !== a);
    const name = mine
      .filter((i) => i.x > cols.payments + 40 && amount(i.s) == null)
      .sort((p, q) => q.x - p.x)
      .map((i) => i.s.trim())
      .join(" ");
    let payments: number | null = null;
    let employerCosts = 0;
    let cents: string | null = null;
    for (const i of mine) {
      if (i.x <= cols.totalEdge) {
        const m = i.s.match(/\.(\d{2})/);
        if (m) cents = m[1];
        continue;
      }
      const v = amount(i.s);
      if (v == null || i.x > cols.payments + 40) continue;
      if (Math.abs(i.x - cols.payments) <= 20) payments = v;
      else if (cols.reduction != null && Math.abs(i.x - cols.reduction) <= 15) employerCosts -= v;
      else employerCosts += v;
    }
    if (payments == null) return;
    const total = Math.round((payments + employerCosts) * 100) / 100;
    rows.push({
      number: a.s.trim(),
      name,
      payments,
      employerCosts: Math.round(employerCosts * 100) / 100,
      total,
      checked: cents != null && total.toFixed(2).endsWith(`.${cents}`),
    });
  });
  return rows;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Sep_2026.pdf", "May_2025_corrected.pdf", "Aug_2024.pdf.pdf" → its month. */
export function reportPeriod(fileName: string, fallbackYear: number | null): { year: number; month: number } | null {
  const words = fileName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const month = words.map((w) => (w.length >= 3 ? MONTHS.indexOf(w.slice(0, 3)) : -1)).find((i) => i >= 0);
  const year = Number(words.find((w) => /^20\d\d$/.test(w))) || fallbackYear;
  if (month == null || !year) return null;
  return { year, month: month + 1 };
}
