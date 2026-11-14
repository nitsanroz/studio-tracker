import { describe, expect, it } from "vitest";
import { parseAmount, parsePayslip, payslipPeriod, type TextItem } from "./payslip";

// A Michpal payslip's layout, with made-up figures: labels in logical order,
// each figure to its label's left (the page reads right to left), and the
// vacation and sick accounts as narrow columns beside other figures.
const row = (y: number, ...pairs: [string, number][]): TextItem[] => pairs.map(([s, x]) => ({ s, x, y }));
const slip: TextItem[] = [
  ...row(580, ["תאור", 523], ["התשלום", 491], ["כמות", 415], ["תעריף", 366], ["גילום", 313], ["שווי", 264], ["למס", 246], ["התשלום", 186]),
  ...row(564, ["001", 551], ["משכורת", 521], ["0.80", 426], ["15000.00", 368], ["12000.00", 195]),
  ...row(552, ["016", 551], ["ארוחות", 523], ["300.00", 324], ["500.00", 200]),
  ...row(530, ["093", 551], ["זק.תגמולים", 511], ["149.94", 267]),
  ...row(356, ['סה"כ', 544], ["תשלומים", 509], ["149.94", 265], ["12500.00", 192], ["ניכויי", 127], ["חובה", 107]),
  ...row(313, ["נתונים", 327], ["מצטברים", 292], ["חשבון", 222], ["חופשה", 196]),
  ...row(299, ["שכר", 356], ["חייב", 343], ["99999.00", 284], ["יתרה", 250], ["קודמת", 232], ["10.50", 197]),
  ...row(288, ["צבירה", 247], ["ח.ז.", 235], ["1.25", 201]),
  ...row(276, ["מס", 360], ["הכנסה", 342], ["88888.00", 288], ["ניצול", 249], ["ח.ז.", 238], ["2.00", 205]),
  ...row(265, ["יתרה", 250], ["חדשה", 233], ["9.75", 197]),
  ...row(245, ["חשבון", 220], ["מחלה", 198]),
  ...row(237, ["יתרה", 250], ["קודמת", 232], ["20.00", 194]),
  ...row(225, ["צבירה", 247], ["ח.ז.", 235], ["1.50", 201]),
  ...row(214, ["ניצול", 249], ["ח.ז.", 238], [".00", 205]),
  ...row(203, ["יתרה", 250], ["חדשה", 233], ["21.50", 194]),
];

describe("parsePayslip", () => {
  const p = parsePayslip(slip);

  it("reads the salary by column: job share, full-time rate, amount paid", () => {
    expect([p.salaryQuantity, p.salaryRate, p.salaryPaid]).toEqual([0.8, 15_000, 12_000]);
  });

  it("takes the gross from the amount column, not the taxable-value one", () => {
    expect(p.grossTotal).toBe(12_500);
  });

  it("reads a full-time salary with no share or rate as its own rate", () => {
    const full = parsePayslip(slip.map((i) => (i.y === 564 && (i.x === 426 || i.x === 368) ? { ...i, s: "" } : i)));
    expect([full.salaryQuantity, full.salaryRate, full.salaryPaid]).toEqual([null, 12_000, 12_000]);
  });

  it("reads the vacation account, not the figures beside it", () => {
    expect(p.vacation).toEqual({ previous: 10.5, accrued: 1.25, used: 2, balance: 9.75 });
  });

  it("reads the sick-day account separately", () => {
    expect(p.sick).toEqual({ previous: 20, accrued: 1.5, used: 0, balance: 21.5 });
    expect(p.missing).toEqual([]);
  });

  it("says what it couldn't read", () => {
    expect(parsePayslip(slip.filter((i) => i.y > 300)).missing).toEqual(["vacation balance", "sick balance"]);
  });
});

describe("parseAmount", () => {
  it("reads Michpal's figures", () => {
    expect(parseAmount(".00")).toBe(0);
    expect(parseAmount("31,386.18")).toBe(31386.18);
    expect(parseAmount("ח.ז.")).toBeNull();
  });
});

describe("payslipPeriod", () => {
  it("reads the month from the file name, in any spelling", () => {
    expect(payslipPeriod("Adaya_sep_2026.pdf", null)).toEqual({ year: 2026, month: 9 });
    expect(payslipPeriod("Nadav_January_2026.pdf", null)).toEqual({ year: 2026, month: 1 });
    expect(payslipPeriod("Aky_June_2026.pdf", null)).toEqual({ year: 2026, month: 6 });
  });

  it("takes the folder's year when the name has none", () => {
    expect(payslipPeriod("Shaked_aug.pdf", 2026)).toEqual({ year: 2026, month: 8 });
  });

  it("reads a year glued to the month or written short, before the folder's", () => {
    expect(payslipPeriod("Maya_March2020.pdf", 2021)).toEqual({ year: 2020, month: 3 });
    expect(payslipPeriod("Edor_July19.pdf", 2021)).toEqual({ year: 2019, month: 7 });
    expect(payslipPeriod("Shani_Feb18_Updated.pdf", 2020)).toEqual({ year: 2018, month: 2 });
    expect(payslipPeriod("Gabi_May_25 corrected.pdf", 2026)).toEqual({ year: 2025, month: 5 });
  });

  it("never reads the person's name as a month", () => {
    expect(payslipPeriod("May_oct_2026.pdf", null)).toEqual({ year: 2026, month: 10 });
    expect(payslipPeriod("Maya.pdf", 2026)).toBeNull();
  });
});
