import { describe, expect, it } from "vitest";
import { LINE, type PnlMonthly } from "@/lib/finance/finance";
import {
  clientQuiet,
  concentration,
  expenseJump,
  findAll,
  freelanceOver,
  fxMissing,
  lossMonths,
  monthNotClosed,
  monthUnpaid,
  olderUnpaid,
  noRate,
  paceBehind,
  payslipsMissing,
  periodUnpaid,
  pulse,
  salariesShare,
  unfiled,
  type AdviceData,
} from "./signals";
import { pageContext, tilesFor } from "./context";
import { ACCOUNTANT_YEARS } from "@/lib/finance/accountant-years";
import { DEFAULT_FACTS } from "@/lib/finance/scenarios/facts";

/** One P&L month: its income, costs and hours (hourly income at ₪300/h). */
function month(year: number, m: number, v: { revenue?: number; expenses?: number; hours?: number; salaries?: number; [line: string]: number | undefined }): PnlMonthly[] {
  const out: PnlMonthly[] = [];
  const put = (lineItem: string, value: number) => out.push({ year, month: m, lineItem, value, state: "actual", source: "rollup" });
  const revenue = v.revenue ?? (v.hours ?? 0) * 300;
  put(LINE.totalRevenues, revenue);
  put(LINE.totalExpenses, v.expenses ?? 0);
  put(LINE.profit, revenue - (v.expenses ?? 0));
  put(LINE.totalHours, v.hours ?? revenue / 300);
  put(LINE.hoursIncome, revenue);
  if (v.salaries != null) put(LINE.salaries, v.salaries);
  for (const [k, val] of Object.entries(v)) if (!["revenue", "expenses", "hours", "salaries"].includes(k) && val != null) put(k, val);
  return out;
}

const base = (over: Partial<AdviceData> = {}): AdviceData => ({
  // what run.ts supplies on the server
  figures: { accountantYears: ACCOUNTANT_YEARS, facts: DEFAULT_FACTS },
  today: "2026-10-22",
  pnl: [],
  goalInputs: null,
  clients: [
    { id: "lumen", name: "Lumen", billable: true, archived: false },
    { id: "orbit", name: "Orbit", billable: true, archived: false },
  ],
  rates: [
    { clientId: "lumen", clientCanon: "Lumen", rate: 300, effectiveFrom: "2024-01-01", effectiveTo: null },
    { clientId: "orbit", clientCanon: "Orbit", rate: 350, effectiveFrom: "2024-01-01", effectiveTo: null },
  ],
  hours: [],
  billableDays: [],
  leadsOpen: 0,
  periods: [],
  lastMonthRows: [],
  payslips: {},
  fxMonths: ["2026-09"],
  monthlyExpenses: [],
  ...over,
});

/** Jul–Sep at 400h a month (₪120K), October planned at ₪100K of costs with `soFar` hours. */
const paceData = (soFar: number, today = "2026-10-22") =>
  base({
    today,
    pnl: [
      ...month(2026, 7, { hours: 400, expenses: 90_000 }),
      ...month(2026, 8, { hours: 400, expenses: 90_000 }),
      ...month(2026, 9, { hours: 400, expenses: 90_000 }),
      ...month(2026, 10, { hours: soFar, expenses: 100_000 }),
    ],
  });

describe("paceBehind", () => {
  // October 2026 has 21 Sun–Thu days; by the 22nd, 16 have counted. Break-even
  // is 333h (≈15.9h a day), the 15% target 392h (≈18.7h a day).
  it("is 'do now' under break-even pace, with the shortfall as the figure", () => {
    const [f] = paceBehind(paceData(100));
    expect(f.kind).toBe("now");
    expect(f.title).toBe("October is under break-even pace");
    expect(f.figure).toMatch(/^−₪\d+K$/);
    expect(f.facts.shortIls).toBeGreaterThan(0);
  });

  it("is a heads-up between break-even and the target", () => {
    const [f] = paceBehind(paceData(272));
    expect(f.kind).toBe("heads");
    expect(f.title).toBe("October covers its costs, not the 15% target");
  });

  it("says nothing on target pace, or in the first three workdays", () => {
    expect(paceBehind(paceData(320))).toEqual([]);
    expect(paceBehind(paceData(5, "2026-10-04"))).toEqual([]);
  });
});

describe("lossMonths", () => {
  it("is 'do now' when the three months together lost money", () => {
    const [f] = lossMonths(
      base({
        pnl: [
          ...month(2026, 7, { revenue: 80_000, expenses: 90_000 }),
          ...month(2026, 8, { revenue: 100_000, expenses: 90_000 }),
          ...month(2026, 9, { revenue: 85_000, expenses: 90_000 }),
        ],
      }),
    );
    expect(f.kind).toBe("now");
    expect(f.title).toBe("Jul–Sep lost money: 2 of 3 months in the red");
    expect(f.body).toBe("Jul −₪10K, Aug +₪10K, Sep −₪5,000; together −₪5,000 over the three.");
    expect(f.figure).toBe("−₪15K");
  });

  it("is only a heads-up when losing months sit in a profitable quarter", () => {
    const [f] = lossMonths(
      base({
        pnl: [
          ...month(2026, 7, { revenue: 88_000, expenses: 90_000 }),
          ...month(2026, 8, { revenue: 89_000, expenses: 90_000 }),
          ...month(2026, 9, { revenue: 134_000, expenses: 90_000 }),
        ],
      }),
    );
    expect(f.kind).toBe("heads");
    expect(f.title).toBe("July and August were in the red");
    expect(f.figure).toBe("−₪3,000");
  });

  it("is quiet when only an older month lost", () => {
    const pnl = [
      ...month(2026, 7, { revenue: 80_000, expenses: 90_000 }),
      ...month(2026, 8, { revenue: 100_000, expenses: 90_000 }),
      ...month(2026, 9, { revenue: 100_000, expenses: 90_000 }),
    ];
    expect(lossMonths(base({ pnl }))).toEqual([]);
  });
});

describe("periodUnpaid", () => {
  const period = { clientId: "lumen", label: "September", dateFrom: "2026-09-01", dateTo: "2026-09-30", paid: false, hours: 10, hoursSince: 0 };

  it("waits for the 14-day terms, then puts the hours × rate on the card", () => {
    // invoiced 1 Oct (the day after the period), due 15 Oct
    expect(periodUnpaid(base({ today: "2026-10-15", periods: [period] }))).toEqual([]);
    const [f] = periodUnpaid(base({ today: "2026-10-17", periods: [period] }));
    expect(f.kind).toBe("heads");
    expect(f.title).toBe("Lumen: September is 2 days past its payment date");
    expect(f.figure).toBe("₪3K");
    expect(f.body).toContain("10h × ₪300 = ₪3,000 before VAT, due 15 Oct (14-day terms).");
    expect(f.reminder).toBe(true);
    expect(f.href).toBe("/client-reports?client=lumen");
  });

  it("is 'do now' from 7 days late, and names work on credit", () => {
    const [f] = periodUnpaid(base({ today: "2026-10-24", periods: [{ ...period, hoursSince: 12 }] }));
    expect(f.kind).toBe("now");
    expect(f.severity).toBe(3);
    expect(f.body).toContain("12h more logged for them since (≈₪3,600)");
  });

  it("uses the client's own terms — net+30 isn't late at day 15", () => {
    const on30 = (d: ReturnType<typeof base>) => ({ ...d, clients: d.clients.map((c) => (c.id === "lumen" ? { ...c, paymentTermsDays: 30 } : c)) });
    expect(periodUnpaid(on30(base({ today: "2026-10-24", periods: [period] })))).toEqual([]); // due 31 Oct
    const [f] = periodUnpaid(on30(base({ today: "2026-11-03", periods: [period] })));
    expect(f.facts).toMatchObject({ dueDate: "2026-10-31", daysLate: 3 });
    expect(f.body).toContain("(30-day terms)");
  });

  it("net+30 is due by the 5th of the month after next", () => {
    const net = (d: ReturnType<typeof base>) => ({ ...d, clients: d.clients.map((c) => (c.id === "lumen" ? { ...c, paymentTermsDays: 30, paymentTermsNet: true } : c)) });
    // September, invoiced 1 Oct → 5 Dec
    expect(periodUnpaid(net(base({ today: "2026-12-05", periods: [period] })))).toEqual([]);
    const [f] = periodUnpaid(net(base({ today: "2026-12-07", periods: [period] })));
    expect(f.facts).toMatchObject({ dueDate: "2026-12-05", daysLate: 2 });
    expect(f.body).toContain("(Net+30 terms)");
  });

  it("stops 45 days late, and at a paid period", () => {
    expect(periodUnpaid(base({ today: "2026-12-01", periods: [period] }))).toEqual([]);
    expect(periodUnpaid(base({ today: "2026-10-24", periods: [{ ...period, paid: true }] }))).toEqual([]);
  });

  it("defers to the Plan: quiet once every month of the period is marked paid there", () => {
    expect(periodUnpaid(base({ today: "2026-10-24", periods: [period], planPaid: [{ clientId: "lumen", client: "Lumen", month: "2026-09" }] }))).toEqual([]);
    // By name, for a Plan row with no client id.
    expect(periodUnpaid(base({ today: "2026-10-24", periods: [period], planPaid: [{ clientId: null, client: "Lumen", month: "2026-09" }] }))).toEqual([]);
    // Another client's paid month doesn't count.
    expect(periodUnpaid(base({ today: "2026-10-24", periods: [period], planPaid: [{ clientId: "orbit", client: "Orbit", month: "2026-09" }] }))).toHaveLength(1);
  });
});

describe("noRate", () => {
  it("flags billable hours no rate covers", () => {
    const [f] = noRate(base({ rates: [], hours: [{ clientId: "lumen", month: "2026-10", hours: 12.5 }] }));
    expect(f.title).toBe("Lumen has hours in October but no rate");
    expect(f.figure).toBe("12.5h at ₪0");
  });

  it("is quiet when a rate covers the month", () => {
    expect(noRate(base({ hours: [{ clientId: "lumen", month: "2026-10", hours: 12.5 }] }))).toEqual([]);
  });
});

describe("concentration and clientQuiet", () => {
  /** `hours` a day for each of the last `days` days, ending today (2026-10-22). */
  const days = (clientId: string, n: number, hours: number, endBack = 0) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.UTC(2026, 9, 22 - endBack - i));
      return { clientId, date: d.toISOString().slice(0, 10), hours };
    });

  it("flags one client at 40%+ of 90 days' billable hours, with the open leads", () => {
    const [f] = concentration(base({ leadsOpen: 2, billableDays: [...days("lumen", 90, 3), ...days("orbit", 90, 1)] }));
    expect(f.kind).toBe("idea");
    expect(f.title).toBe("Lumen is 75% of the studio's billable work");
    expect(f.figure).toBe("₪81K");
    expect(f.body).toContain("2 leads are open");
  });

  it("says nothing about leads when they couldn't be loaded", () => {
    const [f] = concentration(base({ leadsOpen: null, billableDays: [...days("lumen", 90, 3), ...days("orbit", 90, 1)] }));
    expect(f.body).not.toMatch(/lead/i);
    expect(f.facts).not.toHaveProperty("leadsOpen");
  });

  it("is quiet under 40% or under 100 hours", () => {
    expect(concentration(base({ billableDays: [...days("lumen", 90, 1), ...days("orbit", 90, 2)] }))[0].clientId).toBe("orbit");
    expect(concentration(base({ billableDays: [...days("lumen", 90, 1), ...days("orbit", 90, 1), ...days("nova", 90, 1)] }))).toEqual([]);
    expect(concentration(base({ billableDays: days("lumen", 20, 1) }))).toEqual([]);
  });

  it("flags a client gone quiet: under 40% of their usual month in the last 30 days", () => {
    const billableDays = [...days("lumen", 90, 1, 31), ...days("lumen", 30, 0.2)];
    const [f] = clientQuiet(base({ billableDays }));
    expect(f.title).toBe("Lumen has gone quiet");
    expect(f.figure).toBe("−₪7,200");
    expect(clientQuiet(base({ billableDays: [...days("lumen", 90, 1, 31), ...days("lumen", 30, 0.5)] }))).toEqual([]);
  });
});

describe("costs", () => {
  it("flags salaries' share rising 5+ points", () => {
    const pnl = [
      ...[6, 7, 8, 9, 10, 11, 12].flatMap((m) => month(2025, m, { revenue: 100_000, expenses: 80_000, salaries: 50_000 })),
      ...[1, 2, 3, 4, 5, 6].flatMap((m) => month(2026, m, { revenue: 100_000, expenses: 80_000, salaries: 50_000 })),
      ...[7, 8, 9].flatMap((m) => month(2026, m, { revenue: 100_000, expenses: 90_000, salaries: 60_000 })),
    ];
    const [f] = salariesShare(base({ pnl }));
    expect(f.title).toBe("Salaries took 60% of income over Jul–Sep");
    expect(f.body).toContain("Up from 50%");
  });

  it("flags an expense line jumping over its six months before", () => {
    const pnl = [
      ...[3, 4, 5, 6, 7, 8].flatMap((m) => month(2026, m, { revenue: 100_000, expenses: 80_000, [LINE.expensesMisc]: 3_000 })),
      ...month(2026, 9, { revenue: 100_000, expenses: 80_000, [LINE.expensesMisc]: 8_000 }),
    ];
    const [f] = expenseJump(base({ pnl }));
    expect(f.title).toBe("Misc expenses jumped in September");
    expect(f.figure).toBe("+₪5K");
  });

  it("costs an hourly freelancer at what he has logged against the plan", () => {
    const data = paceData(300);
    data.goalInputs = {
      absent: {},
      away: [],
      freelancers: [
        {
          name: "Dima",
          planned: 5_000,
          recent: [7, 8, 9].map((m) => ({ year: 2026, month: m, hours: 100, pay: 12_000 })),
          soFar: 80,
          absent: [],
          terms: { currency: "ILS", rateHigh: 140, rateLow: 100, hoursLow: 50, hoursHigh: 150 },
        },
      ],
    };
    const [f] = freelanceOver(data);
    expect(f.title).toBe("Dima is over this month's plan");
    expect(f.body).toContain("it bottoms at ₪100/h from 150h");
  });
});

describe("filing and close", () => {
  const expense = (filedAt: string | null) => ({ date: "2026-01-01", endDate: null, filedAt });

  it("asks for filing from the 8th, gently in week one, never from the 25th", () => {
    expect(unfiled(base({ today: "2026-10-10", monthlyExpenses: [expense(null)] }))[0].kind).toBe("now");
    expect(unfiled(base({ today: "2026-10-03", monthlyExpenses: [expense(null)] }))[0].kind).toBe("heads");
    expect(unfiled(base({ today: "2026-10-26", monthlyExpenses: [expense(null)] }))).toEqual([]);
    expect(unfiled(base({ today: "2026-10-10", monthlyExpenses: [expense("2026-09-26T08:00:00Z")] }))).toEqual([]);
  });

  it("calls last month open while any of its rows isn't final, one card per page, pointing at the cells", () => {
    const rows: AdviceData["lastMonthRows"] = [
      { table: "salaries", state: "final", amount: 30_000, id: "s1", name: "Noa" },
      { table: "freelance", state: "predicted", amount: 4_000, id: "f1", name: "Dima" },
      { table: "freelance", state: "actual", amount: 1_000, id: "f2", name: "AB" },
      { table: "freelance", state: "actual", amount: 0, id: "f3", name: "ech" },
    ];
    const found = monthNotClosed(base({ today: "2026-10-06", lastMonthRows: rows }));
    expect(found).toHaveLength(1);
    const [f] = found;
    expect(f.title).toBe("2 September freelance amounts aren't final");
    expect(f.body).toContain("Not final yet: Dima (₪4,000), AB (₪1,000).");
    expect(f.figure).toBe("₪5K");
    expect(f.href).toBe("/finance/freelance?year=2026");
    expect(f.focus).toBe("row:f1 row:f2 month:2026-09");
    // Salaries are never named — the body is worded by Claude.
    const [s] = monthNotClosed(base({ today: "2026-10-06", lastMonthRows: [{ ...rows[0], state: "actual" }] }));
    expect(s.body).not.toContain("Noa");
    expect(s.href).toBe("/finance/salaries?year=2026");
    expect(monthNotClosed(base({ today: "2026-10-03", lastMonthRows: rows }))).toEqual([]);
    expect(monthNotClosed(base({ today: "2026-10-06", lastMonthRows: rows.slice(0, 1) }))).toEqual([]);
  });

  it("asks for paid only once a cell is final, and stays quiet until paid is tracked", () => {
    const rows: AdviceData["lastMonthRows"] = [
      { table: "freelance", state: "final", amount: 4_000, id: "f1", name: "Dima", paid: false },
      { table: "freelance", state: "final", amount: 1_000, id: "f2", name: "AB", paid: true },
      // Not final yet: that's the "not final" card's, not this one's.
      { table: "freelance", state: "actual", amount: 2_000, id: "f4", name: "Ofer", paid: false },
      { table: "salaries", state: "final", amount: 30_000, id: "s1", name: "Noa" },
    ];
    const [f, ...rest] = monthUnpaid(base({ today: "2026-10-16", lastMonthRows: rows }));
    expect(rest).toEqual([]);
    expect(f.title).toBe("1 September freelance payment isn't marked paid");
    expect(f.kind).toBe("now");
    expect(f.focus).toBe("row:f1 month:2026-09");
    expect(f.key).toBe("paid:2026-09:freelance");
  });

  it("keeps reminding of older final, unpaid amounts, a card per page", () => {
    const older: NonNullable<AdviceData["olderUnpaid"]> = [
      { table: "freelance", month: "2026-07", amount: 2_000, id: "f7", name: "Dima" },
      { table: "freelance", month: "2026-08", amount: 3_000, id: "f8", name: "AB" },
      { table: "salaries", month: "2026-08", amount: 0, id: "s8", name: "Noa" },
    ];
    const [f, ...rest] = olderUnpaid(base({ today: "2026-10-03", olderUnpaid: older }));
    expect(rest).toEqual([]);
    expect(f.title).toBe("2 older freelance payments aren't marked paid");
    expect(f.body).toContain("from July, August");
    expect(f.focus).toBe("row:f7 row:f8 month:2026-07 month:2026-08");
    expect(f.href).toBe("/finance/freelance?year=2026");
    expect(olderUnpaid(base({}))).toEqual([]);
  });

  it("counts payslips against salary rows from the 12th", () => {
    const rows: AdviceData["lastMonthRows"] = Array.from({ length: 6 }, () => ({ table: "salaries", state: "final", amount: 1 }));
    expect(payslipsMissing(base({ today: "2026-10-12", lastMonthRows: rows, payslips: { "2026-09": 5 } }))[0].figure).toBe("5 of 6");
    expect(payslipsMissing(base({ today: "2026-10-12", lastMonthRows: rows, payslips: { "2026-09": 6 } }))).toEqual([]);
  });

  it("notices a month with no official rate", () => {
    expect(fxMissing(base({ fxMonths: [] }))[0].title).toBe("No Bank of Israel rate stored for September");
    expect(fxMissing(base())).toEqual([]);
  });
});

describe("what Claude is sent", () => {
  it("never puts an amount in a title", () => {
    const data = paceData(100);
    data.today = "2026-10-12";
    data.rates = [];
    data.hours = [{ clientId: "lumen", month: "2026-10", hours: 3 }];
    data.periods = [{ clientId: "orbit", label: "September", dateFrom: "2026-09-01", dateTo: "2026-09-25", paid: false, hours: 10, hoursSince: 8 }];
    data.lastMonthRows = [{ table: "freelance", state: "predicted", amount: 4_000 }];
    data.monthlyExpenses = [{ date: "2026-01-01", endDate: null, filedAt: null }];
    data.fxMonths = [];
    const found = findAll(data);
    expect(found.length).toBeGreaterThanOrEqual(5);
    for (const f of found) expect(f.title).not.toMatch(/[₪€$]|\d+K\b/);
  });
});

describe("pulse", () => {
  it("gives each page its own figures, and the Overview no pace tile", () => {
    const tiles = pulse(paceData(300));
    const on = (path: string) => tilesFor(tiles, pageContext(path)).map((t) => t.label);
    expect(on("/finance")).toEqual(["Oct profit (est.)", "Jul–Sep profit", "2026 (est.)", "Biggest client · 90 days", "Unpaid past terms"]);
    expect(on("/finance/plan")).toEqual(["Hours pace", "Sep booked"]);
    expect(on("/finance/expenses")).toEqual(["Invoices filed", "Renewals · 45 days"]);
    expect(on("/finance/settings")).toEqual([]);
    expect(tiles.find((t) => t.label === "Jul–Sep profit")?.display).toBe("+₪90K");
    for (const t of tiles) expect(t.help.length).toBeGreaterThan(40);
  });
});

describe("tax advice", () => {
  it("shows the dividend date from December to 19 January only", async () => {
    const { dividendWindow } = await import("./tax");
    expect(dividendWindow(base({ today: "2026-10-22" }))).toHaveLength(0);
    const dec = dividendWindow(base({ today: "2026-12-05" }));
    expect(dec).toHaveLength(1);
    expect(dec[0].key).toBe("dividend-window:2027");
    expect(dividendWindow(base({ today: "2027-01-19" }))).toHaveLength(1);
    expect(dividendWindow(base({ today: "2027-01-20" }))).toHaveLength(0);
  });

  it("keeps amounts out of every tax title", async () => {
    const { dividendWindow, booksGap } = await import("./tax");
    const fs = [...dividendWindow(base({ today: "2026-12-05" })), ...booksGap(base())];
    for (const f of fs) expect(f.title).not.toMatch(/[₪$€]/);
  });

  it("flags last year's gap to the accountant only when it is big", async () => {
    const { booksGap } = await import("./tax");
    const year = (profit: number) => Array.from({ length: 12 }, (_, i) => month(2025, i + 1, { revenue: 200_000, expenses: 200_000 - profit / 12 })).flat();
    expect(booksGap(base({ pnl: year(264_000) }))).toHaveLength(1); // his 2025 pre-tax is −₪2K
    expect(booksGap(base({ pnl: year(0) }))).toHaveLength(0);
  });
});
