import { describe, expect, it } from "vitest";
import { buildFxTable, fxQuote, FX_FALLBACK, FX_MARKUP, monthEndRates } from "./fx";
import { expenseNetIls, LINE, netIls, rollupCurrentYear, type ExpenseRow } from "./finance";

const table = buildFxTable([
  { year: 2026, month: 1, usd_ils: 3.095, eur_ils: 3.6 },
  { year: 2026, month: 3, usd_ils: 3.165, eur_ils: null },
]);

describe("fxQuote", () => {
  it("applies the bank/card markup to the Bank of Israel rate", () => {
    const q = fxQuote(table, "USD", 2026, 3);
    expect(q.official).toBe(3.165);
    expect(q.rate).toBeCloseTo(3.165 * (1 + FX_MARKUP), 10);
    expect(q.from).toBe("2026-03");
  });

  it("uses the nearest EARLIER month when a month has no rate, never a later one", () => {
    expect(fxQuote(table, "USD", 2026, 2).from).toBe("2026-01"); // not March
    expect(fxQuote(table, "EUR", 2026, 3).from).toBe("2026-01"); // March has no EUR
  });

  it("falls back to the fixed rate when nothing earlier is stored", () => {
    const q = fxQuote(table, "USD", 2025, 6);
    expect(q.official).toBeNull();
    expect(q.rate).toBe(FX_FALLBACK.USD);
  });
});

describe("monthEndRates", () => {
  it("keeps the LAST business day of each month", () => {
    const csv = [
      "SERIES_CODE,FREQ,TIME_PERIOD,OBS_VALUE",
      "RER_USD_ILS,D,2026-08-28,2.968",
      "RER_USD_ILS,D,2026-08-31,2.988",
      "RER_USD_ILS,D,2026-09-01,3.012",
      "RER_USD_ILS,D,2025-12-31,3.5", // another year — ignored
    ].join("\n");
    const m = monthEndRates(csv, 2026);
    expect(m.get(8)).toBe(2.988);
    expect(m.get(9)).toBe(3.012);
    expect(m.size).toBe(2);
  });
});

describe("VAT and currency rules", () => {
  it("never deducts VAT from a foreign-currency amount, even if flagged", () => {
    expect(netIls(100, "USD", true, 2026, { table, month: 3 })).toBeCloseTo(100 * 3.165 * (1 + FX_MARKUP), 6);
  });

  it("counts an ILS price marked 'no VAT' as is", () => {
    expect(netIls(105, "ILS", false, 2026)).toBe(105);
    expect(expenseNetIls({ amount_gross: 105, amount_no_vat: null, currency: "ILS", vat_included: false }, 2026)).toBe(105);
  });

  it("strips VAT from an ILS price that includes it", () => {
    expect(netIls(118, "ILS", true, 2026)).toBeCloseTo(100, 6);
  });

  it("converts a foreign row at its month's rate rather than the stored snapshot", () => {
    const row = { amount_gross: 306, amount_no_vat: 969.67, currency: "USD", vat_included: false };
    expect(expenseNetIls(row, 2026, { table, month: 3 })).toBeCloseTo(306 * 3.165 * 1.05, 6);
    // No stored rate for that period → the snapshot stands.
    expect(expenseNetIls(row, 2025, { table, month: 6 })).toBe(969.67);
  });
});

describe("rollup with monthly rates", () => {
  it("bills each month of a dollar subscription at that month's own rate", () => {
    const expenses: ExpenseRow[] = [
      { date: "2026-01-01", endDate: "2026-03-31", category: "monthly", vendor: "Google", amountGross: 100, amountNoVat: 320, currency: "USD", vatIncluded: false, state: "actual" },
    ];
    const out = rollupCurrentYear({ year: 2026, hours: [], rates: [], income: [], salaries: [], freelance: [], expenses, fx: table });
    expect(out.get(1)?.get(LINE.expensesMonthly)).toBeCloseTo(100 * 3.095 * 1.05, 6);
    expect(out.get(2)?.get(LINE.expensesMonthly)).toBeCloseTo(100 * 3.095 * 1.05, 6); // Feb → Jan's rate
    expect(out.get(3)?.get(LINE.expensesMonthly)).toBeCloseTo(100 * 3.165 * 1.05, 6);
  });

  it("converts a yearly payment once, at the month it was paid", () => {
    const expenses: ExpenseRow[] = [
      { date: "2026-03-10", endDate: null, category: "yearly", vendor: "Figma", amountGross: 1200, amountNoVat: 3840, currency: "USD", vatIncluded: false, renewMonths: 12, state: "actual" },
    ];
    const out = rollupCurrentYear({ year: 2026, hours: [], rates: [], income: [], salaries: [], freelance: [], expenses, fx: table });
    const perMonth = (1200 * 3.165 * 1.05) / 12;
    expect(out.get(3)?.get(LINE.expensesYearly)).toBeCloseTo(perMonth, 6);
    expect(out.get(12)?.get(LINE.expensesYearly)).toBeCloseTo(perMonth, 6);
  });
});
