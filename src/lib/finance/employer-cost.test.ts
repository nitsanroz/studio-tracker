import { describe, expect, it } from "vitest";
import { parseEmployerCost, reportPeriod } from "./employer-cost";
import type { TextItem } from "./payslip";

// Michpal's employer-cost report, with made-up figures: each employee's
// number and name on one line, their figures on it and the line below, and
// the total-cost column printing only its cents.
const at = (y: number, ...pairs: [string, number][]): TextItem[] => pairs.map(([s, x]) => ({ s, x, y }));
const report: TextItem[] = [
  ...at(741, ["מספר", 537], ["תשלומים", 424], ["תגמולי", 377], ["קרן", 342], ["פצויים", 290], ["שונות", 250], ["ב.לאומי", 204], ["מס", 175]),
  ...at(731, ["מעסיק", 379], ["השתלמות", 323], ["מעסיק", 209], ["עלות", 168], ["הפחתה", 144]),
  ...at(713, ["0001", 538], ["כהן", 514], ["דנה", 501], ["1,000.50", 283], ["2,000.25", 201], [".75", 84], [",", 69]),
  ...at(711, ["30,000.00", 421], ["900.00", 377], ["1,100.00", 326]),
  // 30,000 + 900 + 1,100 + 1,000.50 + 2,000.25 = 35,000.75
  ...at(699, ["0006", 538], ["לוי", 524], ["רון", 512], ["500.00", 283], ["400.00", 201], [".00", 84]),
  ...at(697, ["9,500.00", 425], ["600.00", 371], ["100.00", 146]),
  // 9,500 + 600 + 500 + 400 − 100 (reduction) = 10,900.00
  ...at(685, ["0010", 538], ["בר", 525], ["טל", 513], ["99.00", 207], [".11", 84]),
  ...at(683, ["1,000.00", 421]),
  // 1,099.00 — but the report's cents say .11: not checked
  ...at(628, ["6", 551], ["סך", 528], ["למחל.", 508], ["40,500.00", 421]),
];

describe("parseEmployerCost", () => {
  const rows = parseEmployerCost(report);

  it("finds every employee, not the totals", () => {
    expect(rows.map((r) => r.number)).toEqual(["0001", "0006", "0010"]);
    expect(rows[0].name).toBe("כהן דנה");
  });

  it("adds the employer's costs to the payments", () => {
    expect(rows[0]).toMatchObject({ payments: 30_000, employerCosts: 5_000.75, total: 35_000.75, checked: true });
  });

  it("takes a reduction off", () => {
    expect(rows[1]).toMatchObject({ payments: 9_500, total: 10_900, checked: true });
  });

  it("flags a total whose printed cents disagree", () => {
    expect(rows[2]).toMatchObject({ total: 1_099, checked: false });
  });
});

describe("reportPeriod", () => {
  it("reads the month in any spelling", () => {
    expect(reportPeriod("Sep_2026.pdf", null)).toEqual({ year: 2026, month: 9 });
    expect(reportPeriod("May_2025_corrected.pdf", null)).toEqual({ year: 2025, month: 5 });
    expect(reportPeriod("Aug_2024.pdf.pdf", null)).toEqual({ year: 2024, month: 8 });
    expect(reportPeriod("january_2026.pdf", null)).toEqual({ year: 2026, month: 1 });
  });
});

describe("parseEmployerCost — two departments", () => {
  // Department 1 (one employee) then its subtotal, then department 2 (one
  // employee), its subtotal and the company total below it.
  const items: TextItem[] = [
    ...at(741, ["תשלומים", 424], ["תגמולי", 377]),
    ...at(731, ["הפחתה", 144]),
    ...at(713, ["0001", 538], ["אחת", 514], ["100.00", 283], [".00", 84]),
    ...at(711, ["1,000.00", 421]),
    ...at(690, ["סך", 528], ["1,000.00", 421]),
    ...at(660, ["0002", 538], ["שתיים", 514], ["200.00", 283], [".00", 84]),
    ...at(658, ["2,000.00", 421]),
    ...at(640, ["סך", 528], ["2,000.00", 421], ["300.00", 283], [".00", 84]),
    ...at(620, ['סה"כ', 528], ["3,000.00", 421], ["300.00", 283], [".00", 84]),
  ];

  it("stops the last employee's block at the subtotal under them", () => {
    const rows = parseEmployerCost(items);
    expect(rows.map((r) => [r.number, r.payments, r.total, r.checked])).toEqual([
      ["0001", 1_000, 1_100, true],
      ["0002", 2_000, 2_200, true],
    ]);
  });
});
