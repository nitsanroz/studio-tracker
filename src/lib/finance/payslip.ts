// Reading a Michpal (מיכפל) payslip PDF's text into the few numbers the apps
// use: gross pay, and the vacation and sick-day accounts. The PDF itself never
// leaves the owner's Mac — scripts/import-payslips.mjs reads it there and
// stores only these numbers.
//
// Pure, no imports: the import script runs under plain Node, outside Next.
//
// The text comes as positioned items (pdf.js getTextContent). Michpal writes
// each label as separate words in logical order and the figure to the label's
// LEFT (the page reads right to left). The month line prints with digits
// missing, so the month comes from the file's name, not from the slip.

/** One piece of text on the page: x from the left, y from the bottom. */
export interface TextItem {
  x: number;
  y: number;
  s: string;
}

export interface DayAccount {
  /** Balance carried from last month. */
  previous: number | null;
  accrued: number | null;
  used: number | null;
  /** Balance after this month — what's left to take. */
  balance: number | null;
}

export interface Payslip {
  /** משכורת (code 001), its rate (תעריף): the full-time monthly salary. */
  salaryRate: number | null;
  /** Its quantity (כמות): the job share for a monthly salary (0.8 = 80%),
   * or hours for an hourly one; null when the slip leaves it out (full time). */
  salaryQuantity: number | null;
  /** Its amount (התשלום): the salary paid this month. */
  salaryPaid: number | null;
  /** סה"כ תשלומים: everything paid this month, before deductions — the gross. */
  grossTotal: number | null;
  vacation: DayAccount;
  sick: DayAccount;
  /** What couldn't be read, for the import to report. */
  missing: string[];
}

type Row = { y: number; items: TextItem[] };

/** Items sharing a baseline (within a point), top of the page first, each row right to left. */
function rowsOf(items: TextItem[]): Row[] {
  const rows: Row[] = [];
  for (const it of items.filter((i) => i.s.trim()).sort((a, b) => b.y - a.y)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 1);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  for (const r of rows) r.items.sort((a, b) => b.x - a.x);
  return rows;
}

const NUMBER = /^-?\d*\.?\d+$/;

/** "1,234.50" / ".00" / "66.00" → number; anything else → null. */
export function parseAmount(s: string): number | null {
  const t = s.replace(/,/g, "").trim();
  return NUMBER.test(t) ? Number(t) : null;
}

/** Where `words` appear in a row, one after another (right to left): the
 * leftmost word's index, or -1. */
function findLabel(row: Row, words: string[]): number {
  for (let i = 0; i + words.length <= row.items.length; i++) {
    if (words.every((w, j) => row.items[i + j].s.trim() === w)) return i + words.length - 1;
  }
  return -1;
}

/** The figure just left of a label: the next item after it in the row, if a number. */
function valueLeftOf(row: Row, words: string[]): number | null | undefined {
  const at = findLabel(row, words);
  if (at < 0) return undefined;
  const next = row.items[at + 1];
  return next ? parseAmount(next.s) : null;
}

/** A label's figure among `rows` — the first row that has the label. */
function figure(rows: Row[], words: string[]): number | null {
  for (const r of rows) {
    const v = valueLeftOf(r, words);
    if (v !== undefined) return v;
  }
  return null;
}

/** The rows under a section header, down to the next header (or the end).
 * A section is a narrow column: only items under the header's own span count,
 * so the neighbouring columns' figures stay out. */
function section(rows: Row[], header: string[], until: string[] | null): Row[] {
  const start = rows.findIndex((r) => findLabel(r, header) >= 0);
  if (start < 0) return [];
  const headerRow = rows[start];
  const at = findLabel(headerRow, header);
  const right = headerRow.items[at - header.length + 1].x;
  const end = until ? rows.findIndex((r, i) => i > start && findLabel(r, until) >= 0) : -1;
  const body = rows.slice(start + 1, end < 0 ? undefined : end);
  // The section's labels sit within ~80pt right of the header's right edge;
  // its figures a little left of the header's left edge.
  const left = headerRow.items[at].x;
  return body.map((r) => ({ y: r.y, items: r.items.filter((i) => i.x <= right + 80 && i.x >= left - 40) }));
}

function account(rows: Row[]): DayAccount {
  return {
    previous: figure(rows, ["יתרה", "קודמת"]),
    accrued: figure(rows, ["צבירה", "ח.ז."]),
    used: figure(rows, ["ניצול", "ח.ז."]),
    balance: figure(rows, ["יתרה", "חדשה"]),
  };
}

export function parsePayslip(items: TextItem[]): Payslip {
  const rows = rowsOf(items);
  // The payments table's columns, by their headers' x: quantity, rate, the
  // gross-up and taxable-value columns, and the amount paid (the leftmost
  // "התשלום"). A figure belongs to the nearest one.
  const header = rows.find((r) => r.items.some((i) => i.s === "כמות") && r.items.some((i) => i.s === "תעריף"));
  const col = (word: string, last = false) => {
    const xs = header?.items.filter((i) => i.s === word).map((i) => i.x) ?? [];
    return xs.length ? (last ? Math.min(...xs) : Math.max(...xs)) : null;
  };
  const columns = { quantity: col("כמות"), rate: col("תעריף"), grossUp: col("גילום"), taxValue: col("שווי"), paid: col("התשלום", true) };
  const inColumns = (row: Row | undefined) => {
    const out: Partial<Record<keyof typeof columns, number>> = {};
    for (const it of row?.items ?? []) {
      const v = parseAmount(it.s);
      if (v == null || it.s === "001") continue;
      let best: keyof typeof columns | null = null;
      for (const [k, x] of Object.entries(columns) as [keyof typeof columns, number | null][])
        if (x != null && Math.abs(it.x - x) <= 30 && (best == null || Math.abs(it.x - x) < Math.abs(it.x - columns[best]!))) best = k;
      if (best && out[best] == null) out[best] = v;
    }
    return out;
  };
  const salary = inColumns(rows.find((r) => r.items.some((i) => i.s === "001") && r.items.some((i) => i.s === "משכורת")));
  const salaryPaid = salary.paid ?? null;
  const salaryQuantity = salary.quantity ?? null;
  const salaryRate = salary.rate ?? (salaryQuantity == null ? salaryPaid : null);
  const grossTotal = inColumns(rows.find((r) => findLabel(r, ['סה"כ', "תשלומים"]) >= 0)).paid ?? null;
  const vacation = account(section(rows, ["חשבון", "חופשה"], ["חשבון", "מחלה"]));
  const sick = account(section(rows, ["חשבון", "מחלה"], null));
  const missing = [
    salaryPaid == null && "salary",
    grossTotal == null && "gross total",
    vacation.balance == null && "vacation balance",
    sick.balance == null && "sick balance",
  ].filter((m): m is string => !!m);
  return { salaryRate, salaryQuantity, salaryPaid, grossTotal, vacation, sick, missing };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A year as file names write it: "2019", or "19" (2015–2035). */
const yearOf = (d: string | undefined) =>
  !d ? null : /^20\d\d$/.test(d) ? Number(d) : /^\d\d$/.test(d) && +d >= 15 && +d <= 35 ? 2000 + Number(d) : null;

/** The month a payslip is for, from its file name ("Adaya_sep_2026.pdf",
 * "Nadav_January_2026.pdf", "Shaked_aug.pdf", older ones "Maya_March2020.pdf",
 * "Edor_July19.pdf"); the year from the name — glued to the month, right after
 * it, or anywhere as 20xx — else `fallbackYear` (its folder's). The first word
 * is the person's name, so a "May" or "Mara" is never read as a month. */
export function payslipPeriod(fileName: string, fallbackYear: number | null): { year: number; month: number } | null {
  const words = fileName
    .replace(/\.pdf$/i, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(1);
  for (let i = 0; i < words.length; i++) {
    const m = /^([a-z]{3,})(\d{2}|\d{4})?$/.exec(words[i]);
    const month = m ? MONTHS.indexOf(m[1].slice(0, 3)) : -1;
    if (month < 0) continue;
    const year = yearOf(m![2]) ?? yearOf(words[i + 1]) ?? yearOf(words.find((w) => /^20\d\d$/.test(w))) ?? fallbackYear;
    return year ? { year, month: month + 1 } : null;
  }
  return null;
}
