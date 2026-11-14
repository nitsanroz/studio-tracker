import { describe, expect, it } from "vitest";
import { LINE, rollupCurrentYear, type ClientMonthly, type ClientRate, type FinanceLock, type PnlMonthly } from "./finance";
import {
  buildClientRows,
  clientMonthRows,
  computeMonthRollup,
  isSyncBatchFor,
  mainRowOnly,
  expenseLinesFor,
  monthLocked,
  planHoursCells,
  pnlLineByMonth,
  rateFor,
} from "./plan-model";

// These feed the Plan page's live grid — the numbers an admin edits hours
// against and watches the rollup respond to.

describe("buildClientRows", () => {
  it("sums sub-accounts for the same client/month into one row", () => {
    const rows: ClientMonthly[] = [
      { year: 2025, month: 1, clientId: null, clientCanon: "Acme", discipline: null, subAccount: "main", hours: 5, rate: 300, revenueGross: 1500, state: "actual", comment: "" },
      { year: 2025, month: 1, clientId: null, clientCanon: "Acme", discipline: null, subAccount: "extra", hours: 3, rate: 300, revenueGross: 900, state: "actual", comment: "" },
    ];
    const out = buildClientRows(rows, 2025);
    expect(out).toHaveLength(1);
    expect(out[0].cells.get(1)?.hours).toBe(8);
  });

  it("keeps the first non-empty comment when sub-accounts disagree", () => {
    const rows: ClientMonthly[] = [
      { year: 2025, month: 1, clientId: null, clientCanon: "Acme", discipline: null, subAccount: "a", hours: 1, rate: null, revenueGross: 0, state: "actual", comment: "" },
      { year: 2025, month: 1, clientId: null, clientCanon: "Acme", discipline: null, subAccount: "b", hours: 1, rate: null, revenueGross: 0, state: "actual", comment: "note" },
    ];
    expect(buildClientRows(rows, 2025)[0].cells.get(1)?.comment).toBe("note");
  });

  it("excludes rows from other years and sorts clients alphabetically", () => {
    const rows: ClientMonthly[] = [
      { year: 2024, month: 1, clientId: null, clientCanon: "Zeta", discipline: null, subAccount: "", hours: 1, rate: null, revenueGross: 0, state: "actual", comment: "" },
      { year: 2025, month: 1, clientId: null, clientCanon: "Zeta", discipline: null, subAccount: "", hours: 2, rate: null, revenueGross: 0, state: "actual", comment: "" },
      { year: 2025, month: 1, clientId: null, clientCanon: "Acme", discipline: null, subAccount: "", hours: 1, rate: null, revenueGross: 0, state: "actual", comment: "" },
    ];
    const out = buildClientRows(rows, 2025);
    expect(out.map((r) => r.clientCanon)).toEqual(["Acme", "Zeta"]);
    expect(out[1].cells.get(1)?.hours).toBe(2); // the 2024 row for Zeta is excluded
  });
});

describe("pnlLineByMonth", () => {
  it("sums a line item per month within one year, ignoring other years/lines", () => {
    const pnl: PnlMonthly[] = [
      { year: 2025, month: 1, lineItem: LINE.salaries, value: 100, state: "actual", source: "rollup" },
      { year: 2025, month: 1, lineItem: LINE.salaries, value: 50, state: "actual", source: "import" },
      { year: 2025, month: 2, lineItem: LINE.salaries, value: 10, state: "actual", source: "rollup" },
      { year: 2025, month: 1, lineItem: LINE.freelance, value: 999, state: "actual", source: "rollup" },
      { year: 2024, month: 1, lineItem: LINE.salaries, value: 999, state: "actual", source: "rollup" },
    ];
    const out = pnlLineByMonth(pnl, 2025, LINE.salaries);
    expect(out.get(1)).toBe(150);
    expect(out.get(2)).toBe(10);
    expect(out.has(3)).toBe(false);
  });
});

describe("monthLocked", () => {
  it("is the same predicate as isPeriodLocked (shared implementation, not a reimplementation)", () => {
    const locks: FinanceLock[] = [{ scopeYear: 2025, scopeMonth: null, block: "revenue" }];
    expect(monthLocked(locks, 2025, 6, "revenue")).toBe(true);
    expect(monthLocked(locks, 2025, 6, "salaries")).toBe(false);
  });
});

describe("rateFor", () => {
  it("resolves a client's rate for a given year/month via the mid-month convention", () => {
    const rates: ClientRate[] = [
      { clientId: null, clientCanon: "Acme", rate: 300, effectiveFrom: "2025-01-01", effectiveTo: "2025-05-31" },
      { clientId: null, clientCanon: "Acme", rate: 350, effectiveFrom: "2025-06-01", effectiveTo: null },
    ];
    expect(rateFor(rates, "Acme", 2025, 5)).toBe(300);
    expect(rateFor(rates, "Acme", 2025, 6)).toBe(350);
    expect(rateFor(rates, "Acme", 2025, 12)).toBe(350);
    expect(rateFor(rates, "Nobody", 2025, 6)).toBeNull();
  });
});

describe("computeMonthRollup", () => {
  const rates: ClientRate[] = [
    { clientId: null, clientCanon: "Acme", rate: 300, effectiveFrom: "2025-01-01", effectiveTo: null },
  ];
  const clientRows = buildClientRows(
    [
      { year: 2025, month: 3, clientId: null, clientCanon: "Acme", discipline: null, subAccount: "", hours: 10, rate: 300, revenueGross: 3000, state: "actual", comment: "" },
    ],
    2025,
  );
  const income = new Map([[3, 500]]);
  const pnl: PnlMonthly[] = [
    { year: 2025, month: 3, lineItem: LINE.salaries, value: 1000, state: "actual", source: "rollup" },
    { year: 2025, month: 3, lineItem: LINE.rentExpenses, value: 200, state: "actual", source: "rollup" },
    // A different month's expense must not leak into March's total.
    { year: 2025, month: 4, lineItem: LINE.salaries, value: 9999, state: "actual", source: "rollup" },
  ];

  it("combines hourly revenue, project income and the expense lines into one live figure", () => {
    const r = computeMonthRollup(clientRows, rates, income, pnl, 2025, 3);
    expect(r.hoursIncome).toBe(3000); // 10h * 300
    expect(r.projectIncome).toBe(500);
    expect(r.totalRevenue).toBe(3500);
    expect(r.totalExpense).toBe(1200); // salaries 1000 + rent 200
    expect(r.profit).toBe(2300);
    expect(r.profitPct).toBeCloseTo(2300 / 3500, 5);
    expect(r.totalHours).toBe(10);
  });

  it("a booked month shows its locked totals, not a recount of the detail", () => {
    const booked: PnlMonthly[] = [
      ...pnl,
      { year: 2025, month: 3, lineItem: LINE.totalRevenues, value: 4100, state: "final", source: "import" },
      { year: 2025, month: 3, lineItem: LINE.totalExpenses, value: 1500, state: "final", source: "import" },
      { year: 2025, month: 3, lineItem: LINE.profit, value: 2600, state: "final", source: "import" },
      { year: 2025, month: 3, lineItem: LINE.hoursIncome, value: 3000, state: "final", source: "import" },
      { year: 2025, month: 3, lineItem: LINE.projectIncome, value: 500, state: "final", source: "import" },
    ];
    const r = computeMonthRollup(clientRows, rates, income, booked, 2025, 3);
    expect(r.booked).toBe(true);
    expect(r.totalRevenue).toBe(4100);
    expect(r.totalExpense).toBe(1500); // booked, not the 1200 the lines add up to
    expect(r.profit).toBe(2600);
    expect(r.otherIncome).toBe(600); // 4100 − 3000 hours − 500 projects (e.g. a sheet's rent income)
    expect(r.totalHours).toBe(10); // not booked → the live count
  });

  it("an unlocked month stays live even when totals are stored", () => {
    const stored: PnlMonthly[] = [
      ...pnl,
      { year: 2025, month: 3, lineItem: LINE.totalRevenues, value: 9999, state: "actual", source: "rollup" },
      { year: 2025, month: 3, lineItem: LINE.totalExpenses, value: 9999, state: "actual", source: "rollup" },
    ];
    const r = computeMonthRollup(clientRows, rates, income, stored, 2025, 3);
    expect(r.booked).toBe(false);
    expect(r.totalRevenue).toBe(3500);
  });

  it("reads zero for a month with no client hours and no income", () => {
    const r = computeMonthRollup(clientRows, rates, income, pnl, 2025, 7);
    expect(r.totalRevenue).toBe(0);
    expect(r.profitPct).toBe(0); // guarded against dividing by zero revenue
  });
});

describe("expenseLinesFor", () => {
  const row = (year: number, lineItem: string, value = 100): PnlMonthly => ({ year, month: 1, lineItem, value, state: "final", source: "import" });
  it("an old year with one combined Expenses line shows it in place of the empty split", () => {
    const keys = expenseLinesFor([row(2019, LINE.expensesOther), row(2019, LINE.salaries)], 2019).map((l) => l.key);
    expect(keys).toContain(LINE.expensesOther);
    expect(keys).not.toContain(LINE.expensesMonthly);
    expect(keys).not.toContain(LINE.expensesMisc);
  });
  it("a year with the Monthly / Yearly / Misc split keeps it (and never adds the combined line too)", () => {
    const keys = expenseLinesFor([row(2026, LINE.expensesOther), row(2026, LINE.expensesMisc)], 2026).map((l) => l.key);
    expect(keys).toContain(LINE.expensesMisc);
    expect(keys).not.toContain(LINE.expensesOther);
  });
});


describe("clientMonthRows / mainRowOnly", () => {
  const cmRow = (over: Partial<ClientMonthly>): ClientMonthly => ({ year: 2026, month: 3, clientId: null, clientCanon: "Mobileye", discipline: null, subAccount: "", hours: 1, rate: 300, revenueGross: 300, state: "actual", comment: "", ...over });
  const list = [
    cmRow({ subAccount: "Corporate", hours: 10 }),
    cmRow({ subAccount: "HR", hours: 5 }),
    cmRow({ clientCanon: "Acme" }),
    cmRow({ month: 4 }),
    cmRow({ year: 2025 }),
  ];
  it("takes every row of one client's month, sub-accounts included, and nothing else", () => {
    const rows = clientMonthRows(list, 2026, 3, "Mobileye");
    expect(rows.map((r) => r.subAccount)).toEqual(["Corporate", "HR"]);
  });
  it("a month held in sub-account rows is not written as a main row (it would count twice)", () => {
    expect(mainRowOnly(clientMonthRows(list, 2026, 3, "Mobileye"))).toBe(false);
    expect(mainRowOnly([cmRow({ subAccount: "HR" })])).toBe(false);
  });
  it("no rows yet, or only the main row, may be written", () => {
    expect(mainRowOnly([])).toBe(true);
    expect(mainRowOnly(clientMonthRows(list, 2026, 3, "Acme"))).toBe(true);
  });
});

describe("isSyncBatchFor", () => {
  const sync = (years: number[]) => ({ action_label: "Synced 2 client-months from the tracker", changes: years.map((year) => ({ match: { year } })) });
  it("takes a tracker sync of the year on screen", () => {
    expect(isSyncBatchFor(sync([2026, 2026]), 2026)).toBe(true);
  });
  it("skips another year's sync", () => {
    expect(isSyncBatchFor(sync([2025]), 2026)).toBe(false);
  });
  it("skips a Rates repricing logged to the same table", () => {
    expect(isSyncBatchFor({ action_label: "Rate for Acme: 2 repriced", changes: [{ match: { year: 2026 } }] }, 2026)).toBe(false);
    expect(isSyncBatchFor({ action_label: "Rate deleted for Acme: 1 repriced", changes: [{ match: { year: 2026 } }] }, 2026)).toBe(false);
  });
  it("skips an empty batch", () => {
    expect(isSyncBatchFor({ action_label: "Synced 0 client-months", changes: [] }, 2026)).toBe(false);
  });
});

describe("planHoursCells — the P&L counts the Plan's hours (Nitsan, 2026-11-10)", () => {
  const rates: ClientRate[] = [{ clientId: null, clientCanon: "Acme", rate: 300, effectiveFrom: "2026-01-01", effectiveTo: null }];
  const cm = (o: Partial<ClientMonthly>): ClientMonthly => ({
    year: 2026, month: 10, clientId: null, clientCanon: "Acme", discipline: null, subAccount: "", hours: 0, rate: 300, revenueGross: 0,
    state: "actual", comment: "", ...o,
  });
  const plan = [
    cm({ hours: 145.5 }), // typed / kept on the Plan — the tracker may say 150
    cm({ clientCanon: "Mobileye", subAccount: "Corporate", hours: 10, rate: 250, revenueGross: 2500, state: "final" }),
    cm({ clientCanon: "Mobileye", subAccount: "HR", hours: 4, rate: 200, revenueGross: 800, state: "final" }),
    cm({ clientCanon: "Studio", hours: 40, rate: null }),
    cm({ month: 9, hours: 0 }),
  ];

  it("prices each client-month as the Plan's rollup does", () => {
    const cells = planHoursCells(plan, rates, 2026);
    expect(cells.find((c) => c.clientCanon === "Acme")).toMatchObject({ month: 10, hours: 145.5, revenue: 43650 });
    // sub-accounts summed, a final month at its booked revenue
    expect(cells.find((c) => c.clientCanon === "Mobileye")).toMatchObject({ hours: 14, revenue: 3300 });
    // Studio and empty months left out
    expect(cells.map((c) => c.clientCanon).sort()).toEqual(["Acme", "Mobileye"]);
  });

  it("so the P&L's hours and hourly income equal the Plan's month exactly", () => {
    const rows = buildClientRows(plan, 2026);
    const planMonth = computeMonthRollup(rows, rates, new Map(), [], 2026, 10);
    const pnl = rollupCurrentYear({ year: 2026, hours: planHoursCells(plan, rates, 2026), rates, income: [], salaries: [], freelance: [], expenses: [] });
    expect(pnl.get(10)?.get(LINE.hoursIncome)).toBe(planMonth.hoursIncome);
    expect(pnl.get(10)?.get(LINE.totalHours)).toBe(planMonth.totalHours);
  });
});
