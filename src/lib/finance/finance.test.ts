import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LINE,
  expenseShares,
  isPartialYear,
  SYNTHETIC_YEARLY_MARKER,
  annualize,
  cellStateClass,
  isForecast,
  isForecastMonth,
  isLocked,
  isPeriodLocked,
  monthsElapsed,
  netIls,
  netOfVat,
  invoicedAtOf,
  isSettled,
  newRateCovers,
  rateForClientOn,
  stateOf,
  stepOf,
  revenueForCell,
  rollupCurrentYear,
  round2,
  sumLine,
  summarizeRows,
  summarizeYear,
  vatRate,
  yearsIn,
  yoy,
  type ClientRate,
  type ExpenseRow,
  type FinanceLock,
  type FreelanceRow,
  type HoursCell,
  type IncomeRow,
  type PnlMonthly,
  type SalaryRow,
} from "./finance";
import { FX_FALLBACK } from "./fx";

// These are the numbers the finance app's overview, plan and expenses pages
// all read from — the P&L rollup, the lock/state rules and the effective
// rate lookup. Nothing here renders anything; it's the arithmetic underneath.

describe("vatRate / netOfVat", () => {
  it("is 17% through 2024 and 18% from 2025", () => {
    expect(vatRate(2023)).toBe(0.17);
    expect(vatRate(2024)).toBe(0.17);
    expect(vatRate(2025)).toBe(0.18);
    expect(vatRate(2026)).toBe(0.18);
  });

  it("strips VAT off a gross amount using that year's rate", () => {
    expect(netOfVat(117, 2024)).toBeCloseTo(100, 5);
    expect(netOfVat(118, 2025)).toBeCloseTo(100, 5);
  });
});

describe("round2", () => {
  it("rounds to 2 decimal places", () => {
    // 1.005 * 100 is 100.49999999999999 in floating point, so this rounds
    // DOWN to 1 rather than up to 1.01 — worth pinning so nobody "fixes" it.
    expect(round2(1.005)).toBe(1);
    expect(round2(10.126)).toBe(10.13);
    expect(round2(10.124)).toBe(10.12);
    expect(round2(0)).toBe(0);
  });
});

describe("netIls", () => {
  it("converts a foreign-currency line to ILS at the fixed rate", () => {
    expect(netIls(100, "USD", false, 2025)).toBeCloseTo(320, 5);
    expect(netIls(100, "EUR", false, 2025)).toBeCloseTo(375, 5);
  });

  it("leaves ILS untouched when not VAT-included", () => {
    expect(netIls(100, "ILS", false, 2025)).toBe(100);
  });

  it("strips VAT only when vatIncluded is true", () => {
    expect(netIls(118, "ILS", true, 2025)).toBeCloseTo(100, 5);
    expect(netIls(118, "ILS", false, 2025)).toBe(118);
  });

  it("never strips VAT off a foreign-currency line even if asked to", () => {
    // A non-ILS (overseas) vendor doesn't charge Israeli VAT, so nothing is
    // ever deducted — enforced in netIls itself, not left to the UI.
    const withVat = netIls(100, "USD", true, 2025);
    const withoutVat = netIls(100, "USD", false, 2025);
    expect(withVat).toBe(withoutVat);
  });

  it("falls back to rate 1 for an unrecognized currency code", () => {
    expect(netIls(100, "XYZ", false, 2025)).toBe(100);
  });
});

describe("isForecast / isLocked / cellStateClass", () => {
  it("only 'predicted' counts as forecast", () => {
    expect(isForecast("predicted")).toBe(true);
    expect(isForecast("actual")).toBe(false);
    expect(isForecast("final")).toBe(false);
  });

  it("only 'final' counts as locked", () => {
    expect(isLocked("final")).toBe(true);
    expect(isLocked("actual")).toBe(false);
    expect(isLocked("predicted")).toBe(false);
  });

  it("gives each state its own class, undefined reading as plain actual", () => {
    expect(cellStateClass("predicted")).toContain("state-predicted");
    expect(cellStateClass("final")).toContain("state-final");
    expect(cellStateClass("actual")).toBe("text-muted");
    expect(cellStateClass(undefined)).toBe("text-muted");
  });
});

describe("isPeriodLocked", () => {
  const locks: FinanceLock[] = [
    { scopeYear: 2025, scopeMonth: 3, block: "salaries" },
    { scopeYear: 2025, scopeMonth: null, block: "revenue" }, // whole-year lock
    { scopeYear: 2026, scopeMonth: 1, block: "all" },
  ];

  it("matches an exact year+month+block lock", () => {
    expect(isPeriodLocked(locks, 2025, 3, "salaries")).toBe(true);
    expect(isPeriodLocked(locks, 2025, 4, "salaries")).toBe(false);
  });

  it("a null scopeMonth locks every month of that year for that block", () => {
    expect(isPeriodLocked(locks, 2025, 1, "revenue")).toBe(true);
    expect(isPeriodLocked(locks, 2025, 12, "revenue")).toBe(true);
    expect(isPeriodLocked(locks, 2025, 1, "salaries")).toBe(false);
  });

  it("a block of 'all' locks every block for that period", () => {
    expect(isPeriodLocked(locks, 2026, 1, "expenses")).toBe(true);
    expect(isPeriodLocked(locks, 2026, 1, "income")).toBe(true);
    expect(isPeriodLocked(locks, 2026, 2, "income")).toBe(false);
  });
});

describe("steps", () => {
  it("reads paid over invoiced over final, and only on a final row", () => {
    expect(stepOf("final", "2026-10-01", "2026-09-30")).toBe("paid");
    expect(stepOf("final", null, "2026-09-30")).toBe("invoiced");
    expect(stepOf("final")).toBe("final");
    expect(stepOf("actual", "2026-10-01", "2026-09-30")).toBe("actual");
  });

  it("invoiced and paid are final; paid keeps the invoice date, earlier steps clear it", () => {
    expect(stateOf("invoiced")).toBe("final");
    expect(invoicedAtOf("paid", "2026-09-30")).toBe("2026-09-30");
    expect(invoicedAtOf("invoiced")).not.toBeNull();
    expect(invoicedAtOf("final", "2026-09-30")).toBeNull();
    expect(isSettled("invoiced") && !isSettled("predicted")).toBe(true);
  });
});

describe("newRateCovers", () => {
  const rate = (r: number, from: string, to: string | null = null): ClientRate => ({ clientId: null, clientCanon: "Acme", rate: r, effectiveFrom: from, effectiveTo: to });

  it("a backdated rate stops where a later rate takes over", () => {
    const added = rate(320, "2026-03-01");
    const rates = [rate(300, "2026-01-01"), rate(350, "2026-07-01"), added];
    const months = [...Array(12)].map((_, i) => i + 1).filter((m) => newRateCovers(rates, added, 2026, m));
    expect(months).toEqual([3, 4, 5, 6]);
  });

  it("a rate starting after the 15th first prices the next month", () => {
    const added = rate(320, "2026-03-20");
    expect(newRateCovers([added], added, 2026, 3)).toBe(false);
    expect(newRateCovers([added], added, 2026, 4)).toBe(true);
  });

  it("the newest rate covers every month from its start", () => {
    const added = rate(400, "2026-05-01");
    const rates = [rate(300, "2026-01-01"), added];
    expect(newRateCovers(rates, added, 2026, 4)).toBe(false);
    expect(newRateCovers(rates, added, 2026, 12)).toBe(true);
  });
});

describe("rateForClientOn", () => {
  const rates: ClientRate[] = [
    { clientId: null, clientCanon: "Acme", rate: 300, effectiveFrom: "2021-09-01", effectiveTo: "2021-12-31" },
    { clientId: null, clientCanon: "Acme", rate: 350, effectiveFrom: "2022-01-01", effectiveTo: null },
    { clientId: null, clientCanon: "Other", rate: 999, effectiveFrom: "2020-01-01", effectiveTo: null },
  ];

  it("picks the rate whose window covers the date", () => {
    expect(rateForClientOn(rates, "Acme", "2021-10-15")).toBe(300);
    expect(rateForClientOn(rates, "Acme", "2022-06-01")).toBe(350);
  });

  it("returns null before any rate starts, or for an unknown client", () => {
    expect(rateForClientOn(rates, "Acme", "2020-01-01")).toBeNull();
    expect(rateForClientOn(rates, "Nobody", "2022-06-01")).toBeNull();
  });

  it("on the exact boundary day, the newer rate has already taken effect", () => {
    expect(rateForClientOn(rates, "Acme", "2022-01-01")).toBe(350);
    expect(rateForClientOn(rates, "Acme", "2021-12-31")).toBe(300);
  });

  it("with overlapping applicable rates, picks the latest-starting one", () => {
    const overlapping: ClientRate[] = [
      { clientId: null, clientCanon: "X", rate: 200, effectiveFrom: "2024-01-01", effectiveTo: null },
      { clientId: null, clientCanon: "X", rate: 250, effectiveFrom: "2024-06-01", effectiveTo: null },
    ];
    expect(rateForClientOn(overlapping, "X", "2024-08-01")).toBe(250);
  });
});

describe("revenueForCell", () => {
  const rates: ClientRate[] = [
    { clientId: null, clientCanon: "Acme", rate: 300, effectiveFrom: "2024-01-01", effectiveTo: null },
  ];

  it("is hours times the rate effective mid-month", () => {
    const cell: HoursCell = { year: 2024, month: 3, clientId: null, clientCanon: "Acme", hours: 10 };
    expect(revenueForCell(cell, rates)).toBe(3000);
  });

  it("is 0 when no rate applies", () => {
    const cell: HoursCell = { year: 2023, month: 3, clientId: null, clientCanon: "Acme", hours: 10 };
    expect(revenueForCell(cell, rates)).toBe(0);
  });
});

describe("isPartialYear", () => {
  it("flags both the business's first partial year and the in-progress current year", () => {
    // 2016: founded May 2016, so Jan–Apr never happened — not a real 12-month
    // year, same as the year still in progress. Both must be excluded from
    // "prior full year" YoY comparisons and flagged in year-over-year charts.
    const nov2026 = new Date("2026-11-10T12:00:00Z");
    expect(isPartialYear(2016, nov2026)).toBe(true);
    expect(isPartialYear(2026, nov2026)).toBe(true);
    expect(isPartialYear(2017, nov2026)).toBe(false);
    expect(isPartialYear(2025, nov2026)).toBe(false);
  });

  it("moves with the calendar — on 1 Jan 2027 (Tel Aviv) 2026 is a full year", () => {
    const jan2027 = new Date("2026-12-31T22:30:00Z"); // 00:30 on 1 Jan in Tel Aviv
    expect(isPartialYear(2026, jan2027)).toBe(false);
    expect(isPartialYear(2027, jan2027)).toBe(true);
    expect(isPartialYear(2016, jan2027)).toBe(true);
  });

  it("summarizeYear's partial flag follows isPartialYear, regardless of how much data exists", () => {
    // 2016 has real, final data for May–Dec only — sumLine already sums just
    // those 8 months (nothing to sum for Jan–Apr), but the year must still
    // be marked partial so it isn't treated as a normal 12-month year.
    const pnl2016: PnlMonthly[] = [
      { year: 2016, month: 5, lineItem: LINE.totalRevenues, value: 1000, state: "final", source: "import" },
      { year: 2016, month: 12, lineItem: LINE.totalRevenues, value: 2000, state: "final", source: "import" },
    ];
    expect(summarizeYear(pnl2016, 2016).partial).toBe(true);
    expect(summarizeYear(pnl2016, 2016).revenue).toBe(3000);
  });
});

describe("sumLine / summarizeYear / yearsIn", () => {
  const pnl: PnlMonthly[] = [
    { year: 2025, month: 1, lineItem: LINE.totalRevenues, value: 1000, state: "actual", source: "rollup" },
    { year: 2025, month: 2, lineItem: LINE.totalRevenues, value: 2000, state: "predicted", source: "rollup" },
    { year: 2025, month: 1, lineItem: LINE.hoursIncome, value: 1000, state: "actual", source: "rollup" },
    { year: 2025, month: 2, lineItem: LINE.hoursIncome, value: 2000, state: "predicted", source: "rollup" },
    { year: 2025, month: 1, lineItem: LINE.profit, value: 400, state: "actual", source: "rollup" },
    { year: 2025, month: 1, lineItem: LINE.totalHours, value: 50, state: "actual", source: "rollup" },
    { year: 2025, month: 1, lineItem: LINE.salaries, value: 300, state: "actual", source: "rollup" },
    { year: 2026, month: 1, lineItem: LINE.totalRevenues, value: 500, state: "actual", source: "rollup" },
  ];

  it("sumLine counts every state for the given year/line", () => {
    // 2025 totalRevenues: 1000 (actual) + 2000 (predicted) — predicted is a
    // real, deliberate estimate, not a stale forecast, so it counts too.
    expect(sumLine(pnl, 2025, LINE.totalRevenues)).toBe(3000);
  });

  it("summarizeYear derives margin and avgRate counting every state", () => {
    const s = summarizeYear(pnl, 2025);
    expect(s.revenue).toBe(3000);
    expect(s.profit).toBe(400);
    expect(s.margin).toBeCloseTo(400 / 3000, 5);
    expect(s.hours).toBe(50);
    expect(s.avgRate).toBe(60); // hoursIncome 3000 / 50 hours — all revenue here is hours-based
    expect(s.salariesPctRev).toBeCloseTo(300 / 3000, 5);
  });

  it("summarizeYear's avgRate isn't inflated by one-off project income unrelated to hours", () => {
    // A fixed-fee project with almost no hours behind it must not make the
    // ₪/hour rate look like the business bills 400+/hr.
    const withProjectIncome: PnlMonthly[] = [
      { year: 2025, month: 1, lineItem: LINE.totalRevenues, value: 20000, state: "final", source: "import" },
      { year: 2025, month: 1, lineItem: LINE.hoursIncome, value: 2000, state: "final", source: "import" },
      { year: 2025, month: 1, lineItem: LINE.projectIncome, value: 18000, state: "final", source: "import" },
      { year: 2025, month: 1, lineItem: LINE.totalHours, value: 10, state: "final", source: "import" },
    ];
    expect(summarizeYear(withProjectIncome, 2025).avgRate).toBe(200); // 2000 hoursIncome / 10 hours, not 20000/10
  });

  it("summarizeYear returns zeros, not NaN, when there's no revenue or hours", () => {
    const s = summarizeYear([], 2030);
    expect(s.margin).toBe(0);
    expect(s.avgRate).toBe(0);
    expect(s.salariesPctRev).toBe(0);
  });

  it("yearsIn lists every distinct year present, ascending", () => {
    expect(yearsIn(pnl)).toEqual([2025, 2026]);
  });

  describe("with 'today' fixed to 15 Jun 2025 — the current, partial year", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2025, 5, 15));
    });
    afterEach(() => vi.useRealTimers());

    const partialPnl: PnlMonthly[] = [
      { year: 2025, month: 1, lineItem: LINE.totalRevenues, value: 1000, state: "actual", source: "rollup" },
      { year: 2025, month: 1, lineItem: LINE.totalExpenses, value: 400, state: "actual", source: "rollup" },
      // Forecast months (Jun onward — Jun itself hasn't elapsed yet) carry
      // planned expenses with no matching revenue yet, exactly the shape
      // that used to drag a partial year's totals off from reality.
      { year: 2025, month: 6, lineItem: LINE.totalExpenses, value: 9000, state: "predicted", source: "rollup" },
      { year: 2025, month: 12, lineItem: LINE.totalExpenses, value: 9000, state: "predicted", source: "rollup" },
      // A fully-elapsed PAST year must be completely unaffected.
      { year: 2024, month: 1, lineItem: LINE.totalRevenues, value: 500, state: "final", source: "import" },
      { year: 2024, month: 12, lineItem: LINE.totalExpenses, value: 200, state: "final", source: "import" },
    ];

    it("sumLine excludes not-yet-elapsed months for the current year", () => {
      expect(sumLine(partialPnl, 2025, LINE.totalExpenses)).toBe(400);
    });

    it("summarizeYear's profit isn't dragged down by future forecast expenses", () => {
      const s = summarizeYear(partialPnl, 2025);
      expect(s.revenue).toBe(1000);
      expect(s.expenses).toBe(400);
      expect(s.profit).toBe(0); // profit line item itself has no rows — 0, not derived here
    });

    it("a fully-elapsed past year still sums every month", () => {
      expect(sumLine(partialPnl, 2024, LINE.totalRevenues)).toBe(500);
      expect(sumLine(partialPnl, 2024, LINE.totalExpenses)).toBe(200);
    });

    it("a fully-future year (next year's plan) still sums every month — it's not 'to-date', it's a forecast in full", () => {
      const futurePlan: PnlMonthly[] = [
        { year: 2026, month: 1, lineItem: LINE.totalRevenues, value: 1000, state: "predicted", source: "rollup" },
        { year: 2026, month: 12, lineItem: LINE.totalRevenues, value: 1000, state: "predicted", source: "rollup" },
      ];
      // isForecastMonth marks every month of a future year as forecast, but
      // sumLine must still total the whole year — only the CURRENT year's
      // not-yet-elapsed months get excluded, never a future year's.
      expect(sumLine(futurePlan, 2026, LINE.totalRevenues)).toBe(2000);
      expect(summarizeYear(futurePlan, 2026).revenue).toBe(2000);
    });
  });
});

describe("summarizeRows", () => {
  it("aggregates an arbitrary set of pnl rows, counting every state", () => {
    const rows: PnlMonthly[] = [
      { year: 2025, month: 1, lineItem: LINE.totalRevenues, value: 100, state: "actual", source: "rollup" },
      { year: 2025, month: 2, lineItem: LINE.totalRevenues, value: 900, state: "predicted", source: "rollup" },
      { year: 2025, month: 1, lineItem: LINE.hoursIncome, value: 100, state: "actual", source: "rollup" },
      { year: 2025, month: 2, lineItem: LINE.hoursIncome, value: 900, state: "predicted", source: "rollup" },
      { year: 2025, month: 1, lineItem: LINE.totalHours, value: 10, state: "actual", source: "rollup" },
    ];
    const s = summarizeRows(rows);
    expect(s.revenue).toBe(1000);
    expect(s.avgRate).toBe(100);
  });

  it("avgRate isn't inflated by one-off project income unrelated to hours", () => {
    const rows: PnlMonthly[] = [
      { year: 2025, month: 1, lineItem: LINE.totalRevenues, value: 20000, state: "final", source: "import" },
      { year: 2025, month: 1, lineItem: LINE.hoursIncome, value: 2000, state: "final", source: "import" },
      { year: 2025, month: 1, lineItem: LINE.totalHours, value: 10, state: "final", source: "import" },
    ];
    expect(summarizeRows(rows).avgRate).toBe(200); // 2000 / 10, not 20000 / 10
  });
});

describe("annualize / monthsElapsed", () => {
  it("scales a partial-year figure to a full-year run rate", () => {
    expect(annualize(600, 6)).toBe(1200);
    expect(annualize(600, 0)).toBe(600); // no elapsed months: return as-is, don't divide by zero
  });

  describe("with 'today' fixed to 15 Jun 2025", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2025, 5, 15));
    });
    afterEach(() => vi.useRealTimers());

    it("counts distinct elapsed months with a revenue row — chronology, not state, decides", () => {
      const pnl: PnlMonthly[] = [
        { year: 2025, month: 1, lineItem: LINE.totalRevenues, value: 100, state: "actual", source: "rollup" },
        // A 'predicted' row in an already-elapsed month still counts — it's a
        // deliberate estimate for a month that's happened, not a stale guess.
        { year: 2025, month: 2, lineItem: LINE.totalRevenues, value: 100, state: "predicted", source: "rollup" },
        // July hasn't happened yet (today is 15 Jun), so it's excluded
        // regardless of its state.
        { year: 2025, month: 7, lineItem: LINE.totalRevenues, value: 100, state: "predicted", source: "rollup" },
      ];
      expect(monthsElapsed(pnl, 2025)).toBe(2);
    });
  });
});

describe("yoy", () => {
  it("computes absolute and percent change", () => {
    expect(yoy(120, 100)).toEqual({ abs: 20, pct: 0.2 });
  });

  it("percent is null when the prior value is 0, to avoid a fake infinity", () => {
    expect(yoy(50, 0)).toEqual({ abs: 50, pct: null });
  });
});

describe("isForecastMonth — the one definition every view must agree on", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15)); // 15 Jul 2026 (month is 0-indexed)
  });
  afterEach(() => vi.useRealTimers());

  it("a future year is always forecast, a past year never is", () => {
    expect(isForecastMonth(2027, 1)).toBe(true);
    expect(isForecastMonth(2025, 12)).toBe(false);
  });

  it("within the current year, the CURRENT month itself still counts as forecast", () => {
    // It isn't over yet — this is the >= boundary the whole app relies on.
    expect(isForecastMonth(2026, 7)).toBe(true);
    expect(isForecastMonth(2026, 8)).toBe(true);
    expect(isForecastMonth(2026, 6)).toBe(false);
  });
});

describe("rollupCurrentYear", () => {
  const rates: ClientRate[] = [
    { clientId: null, clientCanon: "Acme", rate: 300, effectiveFrom: "2025-01-01", effectiveTo: null },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 15)); // 15 Jun 2025 — Jun is the "current" month
  });
  afterEach(() => vi.useRealTimers());

  it("derives hourly revenue from hours × the effective rate, and rolls up totals", () => {
    const hours: HoursCell[] = [{ year: 2025, month: 1, clientId: null, clientCanon: "Acme", hours: 10 }];
    const out = rollupCurrentYear({
      year: 2025,
      hours,
      rates,
      income: [],
      salaries: [],
      freelance: [],
      expenses: [],
    });
    const jan = out.get(1)!;
    expect(jan.get(LINE.totalHours)).toBe(10);
    expect(jan.get(LINE.hoursIncome)).toBe(3000);
    expect(jan.get(LINE.totalRevenues)).toBe(3000);
    expect(jan.get(LINE.totalExpenses)).toBe(0);
    expect(jan.get(LINE.profit)).toBe(3000);
    expect(jan.get(LINE.avgRate)).toBe(300);
  });

  it("counts predicted income/salaries/freelance rows just like any other state", () => {
    // 'predicted' is a deliberate, considered estimate — it belongs in the
    // real total the moment it's entered, not just once it's later confirmed.
    const income: IncomeRow[] = [{ date: "2025-01-15", source: "fixed_project", amount: 500, state: "predicted" }];
    const salaries: SalaryRow[] = [{ year: 2025, month: 1, grossAmount: 1000, state: "predicted" }];
    const freelance: FreelanceRow[] = [{ year: 2025, month: 1, amount: 200, state: "predicted" }];
    const out = rollupCurrentYear({ year: 2025, hours: [], rates, income, salaries, freelance, expenses: [] });
    const jan = out.get(1)!;
    expect(jan.get(LINE.projectIncome)).toBe(500);
    expect(jan.get(LINE.salaries)).toBe(1000);
    expect(jan.get(LINE.freelance)).toBe(200);
  });

  it("counts an actual income/salary row normally", () => {
    const income: IncomeRow[] = [{ date: "2025-01-15", source: "fixed_project", amount: 500, state: "actual" }];
    const salaries: SalaryRow[] = [{ year: 2025, month: 1, grossAmount: 1000, state: "actual" }];
    const out = rollupCurrentYear({ year: 2025, hours: [], rates, income, salaries, freelance: [], expenses: [] });
    const jan = out.get(1)!;
    expect(jan.get(LINE.projectIncome)).toBe(500);
    expect(jan.get(LINE.salaries)).toBe(1000);
    expect(jan.get(LINE.totalExpenses)).toBe(1000);
    expect(jan.get(LINE.profit)).toBe(-500); // 500 revenue - 1000 salary
  });

  it("avgRate is hourly revenue only — a one-off project fee never inflates the ₪/hour rate", () => {
    const hours: HoursCell[] = [{ year: 2025, month: 1, clientId: null, clientCanon: "Acme", hours: 10 }];
    const income: IncomeRow[] = [{ date: "2025-01-15", source: "fixed_project", amount: 18000, state: "actual" }];
    const out = rollupCurrentYear({ year: 2025, hours, rates, income, salaries: [], freelance: [], expenses: [] });
    const jan = out.get(1)!;
    expect(jan.get(LINE.hoursIncome)).toBe(3000); // 10 hours × 300 rate
    expect(jan.get(LINE.totalRevenues)).toBe(21000); // 3000 hourly + 18000 project
    expect(jan.get(LINE.avgRate)).toBe(300); // 3000 hoursIncome / 10 hours, not 21000/10
    expect(jan.get(LINE.incomeInHours)).toBe(70); // 21000 total revenue / 300 rate
  });

  it("a 'monthly' expense counts toward every month in its accrual window", () => {
    const expenses: ExpenseRow[] = [
      {
        date: "2025-02-01",
        endDate: "2025-04-30",
        category: "monthly",
        vendor: "Some SaaS",
        amountGross: 117,
        amountNoVat: 100,
        state: "actual",
      },
    ];
    const out = rollupCurrentYear({ year: 2025, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    for (const m of [2, 3, 4]) {
      expect(out.get(m)?.get(LINE.expensesOther)).toBe(100);
    }
    expect(out.get(1)).toBeUndefined();
    expect(out.get(5)).toBeUndefined();
  });

  it("a 'monthly' expense that already ended in a past year contributes nothing to a later year's rollup", () => {
    // A subscription cancelled in 2024 (endDate still in 2024) must not
    // silently count as a full 12 months of expense every year after that —
    // only the end year's own month check short-circuits the window, so a
    // mismatched (past) end year used to fall through to "ongoing all year".
    const expenses: ExpenseRow[] = [
      { date: "2024-07-01", endDate: "2024-12-31", category: "monthly", vendor: "Old SaaS", amountGross: 117, amountNoVat: 100, state: "actual" },
    ];
    const out = rollupCurrentYear({ year: 2026, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    expect(out.size).toBe(0);
  });

  it("a 'monthly' expense started in an earlier year counts every month it still runs", () => {
    const expenses: ExpenseRow[] = [
      { date: "2025-10-01", endDate: null, category: "monthly", vendor: "Open SaaS", amountGross: 117, amountNoVat: 100, state: "actual" },
      { date: "2025-06-01", endDate: "2026-03-31", category: "monthly", vendor: "Ending SaaS", amountGross: 117, amountNoVat: 50, state: "actual" },
    ];
    const out = rollupCurrentYear({ year: 2026, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    for (const m of [1, 2, 3]) expect(out.get(m)?.get(LINE.expensesMonthly)).toBe(150);
    for (const m of [4, 12]) expect(out.get(m)?.get(LINE.expensesMonthly)).toBe(100);
  });

  it("a 'monthly' expense that hasn't started yet (future year) contributes nothing to an earlier year's rollup", () => {
    const expenses: ExpenseRow[] = [
      { date: "2027-03-01", endDate: null, category: "monthly", vendor: "New SaaS", amountGross: 117, amountNoVat: 100, state: "actual" },
    ];
    const out = rollupCurrentYear({ year: 2026, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    expect(out.size).toBe(0);
  });

  it("a predicted expense counts the same whether its month has elapsed or is still ahead", () => {
    // "Today" is fixed to 15 Jun 2025 in this block, so April is elapsed and
    // July is still ahead — a predicted row counts in both, the same way.
    const elapsed: ExpenseRow[] = [
      { date: "2025-04-01", endDate: null, category: "misc", vendor: "Misc Co", amountGross: 100, amountNoVat: 100, state: "predicted" },
    ];
    const stillAhead: ExpenseRow[] = [
      { date: "2025-07-01", endDate: null, category: "misc", vendor: "Misc Co", amountGross: 100, amountNoVat: 100, state: "predicted" },
    ];
    const outElapsed = rollupCurrentYear({
      year: 2025,
      hours: [],
      rates,
      income: [],
      salaries: [],
      freelance: [],
      expenses: elapsed,
    });
    const outAhead = rollupCurrentYear({
      year: 2025,
      hours: [],
      rates,
      income: [],
      salaries: [],
      freelance: [],
      expenses: stillAhead,
    });
    expect(outElapsed.get(4)?.get(LINE.expensesOther)).toBe(100);
    expect(outAhead.get(7)?.get(LINE.expensesOther)).toBe(100);
  });

  it("categorizes rent and investment lines onto their own P&L lines", () => {
    const expenses: ExpenseRow[] = [
      { date: "2025-03-01", endDate: null, category: "rent", vendor: "Landlord", amountGross: 100, amountNoVat: 100, state: "actual" },
      { date: "2025-03-01", endDate: null, category: "investment", vendor: "New laptop", amountGross: 50, amountNoVat: 50, state: "actual" },
    ];
    const out = rollupCurrentYear({ year: 2025, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    const mar = out.get(3)!;
    expect(mar.get(LINE.rentExpenses)).toBe(100);
    expect(mar.get(LINE.investments)).toBe(50);
    expect(mar.get(LINE.expensesOther)).toBeUndefined();
    expect(mar.get(LINE.totalExpenses)).toBe(150);
  });

  it("falls back to netOfVat when a row carries no amountNoVat", () => {
    const expenses: ExpenseRow[] = [
      { date: "2025-01-01", endDate: null, category: "misc", vendor: "Misc Co", amountGross: 118, amountNoVat: null, state: "actual" },
    ];
    const out = rollupCurrentYear({ year: 2025, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    expect(out.get(1)?.get(LINE.expensesOther)).toBeCloseTo(100, 5); // 2025 VAT is 18%
  });

  it("spreads a real yearly renewal evenly over the 12 months it covers, including into the next year", () => {
    // Paid 1 Oct 2025, ₪1,200 net → ₪100/month for Oct 2025 – Sep 2026.
    const expenses: ExpenseRow[] = [
      { date: "2025-10-01", endDate: null, category: "yearly", vendor: "Dropbox", amountGross: 1416, amountNoVat: 1200, state: "actual" },
    ];
    const y2025 = rollupCurrentYear({ year: 2025, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    const y2026 = rollupCurrentYear({ year: 2026, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    for (const m of [10, 11, 12]) expect(y2025.get(m)?.get(LINE.expensesYearly)).toBeCloseTo(100, 5);
    expect(y2025.get(9)).toBeUndefined();
    for (let m = 1; m <= 9; m++) expect(y2026.get(m)?.get(LINE.expensesYearly)).toBeCloseTo(100, 5);
    expect(y2026.get(10)).toBeUndefined();
    expect(y2026.get(1)?.get(LINE.expensesOther)).toBeCloseTo(100, 5);
  });

  it("spreads a 2-year plan over 24 months", () => {
    const expenses: ExpenseRow[] = [
      { date: "2025-01-15", endDate: null, category: "yearly", vendor: "Goodsync", amountGross: 2400, amountNoVat: 2400, renewMonths: 24, state: "actual" },
    ];
    const y2025 = rollupCurrentYear({ year: 2025, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    const y2026 = rollupCurrentYear({ year: 2026, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    const y2027 = rollupCurrentYear({ year: 2027, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    expect(y2025.get(1)?.get(LINE.expensesYearly)).toBeCloseTo(100, 5);
    expect(y2026.get(12)?.get(LINE.expensesYearly)).toBeCloseTo(100, 5);
    expect(y2027.size).toBe(0);
  });

  it("counts a synthetic 'amortized this month' row in its own month only — never spread, never into another year", () => {
    const expenses: ExpenseRow[] = [
      { date: "2025-06-01", endDate: null, category: "yearly", vendor: "", description: SYNTHETIC_YEARLY_MARKER, amountGross: 1800, amountNoVat: 1800, state: "actual" },
    ];
    const y2025 = rollupCurrentYear({ year: 2025, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    const y2026 = rollupCurrentYear({ year: 2026, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    expect(y2025.get(6)?.get(LINE.expensesYearly)).toBe(1800);
    expect(y2025.size).toBe(1);
    expect(y2026.size).toBe(0);
  });

  it("converts a USD row with no stored net amount to shekels (no VAT stripped)", () => {
    const expenses: ExpenseRow[] = [
      { date: "2026-02-01", endDate: null, category: "misc", vendor: "Some US Co", amountGross: 100, amountNoVat: null, currency: "USD", vatIncluded: false, state: "actual" },
    ];
    const out = rollupCurrentYear({ year: 2026, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    expect(out.get(2)?.get(LINE.expensesMisc)).toBeCloseTo(100 * FX_FALLBACK.USD, 5);
  });

  it("routes Accounting/Lawyer/Gur vendors onto their own line, regardless of category, while still counting toward expensesOther", () => {
    const expenses: ExpenseRow[] = [
      { date: "2025-05-01", endDate: null, category: "yearly", vendor: "Accounting", amountGross: 100, amountNoVat: 100, state: "actual" },
      { date: "2025-05-01", endDate: null, category: "misc", vendor: "Lawyer", amountGross: 50, amountNoVat: 50, state: "actual" },
      { date: "2025-05-01", endDate: null, category: "monthly", vendor: "Gur", amountGross: 124, amountNoVat: 124, state: "actual" },
      { date: "2025-05-01", endDate: null, category: "misc", vendor: "Some Other Co", amountGross: 20, amountNoVat: 20, state: "actual" },
    ];
    const out = rollupCurrentYear({ year: 2025, hours: [], rates, income: [], salaries: [], freelance: [], expenses });
    const may = out.get(5)!;
    expect(may.get(LINE.expensesAccounting)).toBe(100);
    expect(may.get(LINE.expensesLawyer)).toBe(50);
    expect(may.get(LINE.expensesGur)).toBe(124);
    expect(may.get(LINE.expensesMisc)).toBe(20); // only the non-Accounting/Lawyer/Gur misc row
    expect(may.get(LINE.expensesOther)).toBe(294); // all four still fold into the combined bucket
    expect(may.get(LINE.totalExpenses)).toBe(294);
  });
});

describe("expenseShares — one rule for the P&L and the Expenses page", () => {
  const base = { vendor: "Adobe", state: "actual" as const, amountNoVat: null, currency: "ILS", vatIncluded: false };
  it("a yearly renewal paid in Sep 2025 still costs Jan–Aug 2026 its share", () => {
    const r = { ...base, date: "2025-09-01", endDate: null, category: "yearly" as const, amountGross: 6000 };
    expect(expenseShares(r, 2025).map((x) => x.month)).toEqual([9, 10, 11, 12]);
    const y26 = expenseShares(r, 2026);
    expect(y26.map((x) => x.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(y26.every((x) => x.amount === 500)).toBe(true);
  });
  it("a yearly row's end date doesn't cut the spread — the year was paid up front", () => {
    const r = { ...base, date: "2025-09-01", endDate: "2026-03-31", category: "yearly" as const, amountGross: 6000 };
    expect(expenseShares(r, 2026).map((x) => x.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("a monthly row runs from its date to its end date, into later years", () => {
    const r = { ...base, date: "2025-11-01", endDate: "2026-03-31", category: "monthly" as const, amountGross: 100 };
    expect(expenseShares(r, 2026)).toEqual([1, 2, 3].map((month) => ({ month, amount: 100 })));
    expect(expenseShares(r, 2027)).toEqual([]);
  });
  it("anything else counts once, in its own month and year", () => {
    const r = { ...base, date: "2026-04-10", endDate: null, category: "misc" as const, amountGross: 250 };
    expect(expenseShares(r, 2026)).toEqual([{ month: 4, amount: 250 }]);
    expect(expenseShares(r, 2027)).toEqual([]);
  });
});
