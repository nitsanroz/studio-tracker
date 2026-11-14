import { describe, expect, it } from "vitest";
import type { ClientRate, PnlMonthly } from "./finance";
import {
  buildLedgers,
  efficiency,
  finishedThrough,
  grossPay,
  hrAdvice,
  recommendedTerms,
  monthsEnding,
  payAdvice,
  studioMonths,
  summarize,
  supportedPayByMonth,
  lastPayRise,
  lastRaiseOf,
  raiseAdvice,
  sickDays,
  valuePremium,
  type GrossPay,
  type PayAdvice,
  tenure,
  type Efficiency,
  neededReturn,
} from "./people";

// A person's cost (salary + freelance) set against what their hours brought
// in (billable hours × the client's rate at the time).

const rates: ClientRate[] = [
  { clientId: null, clientCanon: "Acme", rate: 300, effectiveFrom: "2020-01-01", effectiveTo: "2026-03-31" },
  { clientId: null, clientCanon: "Acme", rate: 350, effectiveFrom: "2026-04-01", effectiveTo: null },
];

const ledgers = buildLedgers({
  salaries: [
    { profileId: "a", year: 2026, month: 3, amount: 10_000 },
    { profileId: "a", year: 2026, month: 4, amount: 10_000 },
  ],
  freelance: [{ profileId: "a", year: 2026, month: 4, amount: 2_000 }],
  entries: [
    { userId: "a", date: "2026-03-10", minutes: 60 * 50, client: "Acme", billable: true },
    { userId: "a", date: "2026-04-10", minutes: 60 * 40, client: "Acme", billable: true },
    { userId: "a", date: "2026-04-11", minutes: 60 * 10, client: "Studio", billable: false },
  ],
  rates,
});

describe("buildLedgers + summarize", () => {
  it("prices billable hours at the rate in effect that month", () => {
    const s = summarize(ledgers.get("a"), 2026);
    expect(s.revenue).toBe(50 * 300 + 40 * 350);
    expect(s.billableHours).toBe(90);
    expect(s.hours).toBe(100);
  });

  it("sets cost against hours and revenue", () => {
    const s = summarize(ledgers.get("a"), 2026);
    expect(s.cost).toBe(22_000);
    expect(s.costPerHour).toBe(220);
    // April's 10 Studio hours (of 50) are studio work: a fifth of April's
    // ₪12,000 isn't held against them.
    expect(s.studioShare).toBeCloseTo(0.1);
    expect(s.clientCost).toBeCloseTo(10_000 + 12_000 * 0.8);
    expect(s.returnRatio).toBeCloseTo(29_000 / (10_000 + 9_600));
    expect(s.billableShare).toBeCloseTo(0.9);
    expect(s.clients.map((c) => c.client)).toEqual(["Acme", "Studio"]);
  });

  it("leaves out months after `upTo`", () => {
    const s = summarize(ledgers.get("a"), 2026, "2026-03");
    expect(s.cost).toBe(10_000);
    expect(s.hours).toBe(50);
  });

  it("never credits a project manager with the hours they log", () => {
    const s = summarize(ledgers.get("a"), 2026, undefined, false);
    expect(s.hours).toBe(100);
    expect(s.revenue).toBe(0);
    expect(s.costPerHour).toBeNull();
    expect(s.returnRatio).toBeNull();
    expect(s.cost).toBe(22_000);
  });

  it("has no ratios without hours", () => {
    const s = summarize(undefined, null);
    expect(s.costPerHour).toBeNull();
    expect(s.returnRatio).toBeNull();
  });
});

describe("tenure and finishedThrough", () => {
  it("reads years and months", () => {
    expect(tenure("2024-06-09", "2026-10-06")).toBe("2y 3m");
    expect(tenure("2026-07-19", "2026-10-06")).toBe("2m");
  });
  it("is the month before today, across a year", () => {
    expect(finishedThrough(new Date(2026, 9, 6))).toBe("2026-09");
    expect(finishedThrough(new Date(2027, 0, 5))).toBe("2026-12");
  });
});

// ── Efficiency, recommended pay, advice ─────────────────────────────────────

const pnlRow = (month: number, lineItem: string, value: number): PnlMonthly => ({
  year: 2026, month, lineItem, value, state: "actual", source: "rollup",
});
// Each month: ₪150k of costs, ₪130k of it people. The designers, whose hours
// earn, are paid ₪100k and bring in ₪160k; projects bring in ₪10k more. So
// ₪140k is left for the designers' pay to carry: ₪1.40 a ₪1 of pay.
const team = buildLedgers({
  salaries: [3, 4].flatMap((month) => [
    { profileId: "designer", year: 2026, month, amount: 100_000 },
    { profileId: "owner", year: 2026, month, amount: 30_000 },
  ]),
  freelance: [],
  entries: [3, 4].map((m) => ({ userId: "designer", date: `2026-0${m}-10`, minutes: 60 * 500, client: "Flat", billable: true })),
  rates: [{ clientId: null, clientCanon: "Flat", rate: 320, effectiveFrom: "2020-01-01", effectiveTo: null }],
});
const studio = studioMonths(
  [3, 4, 5].flatMap((m) => [
    pnlRow(m, "total_expenses", 150_000),
    pnlRow(m, "total_revenues", 170_000),
    pnlRow(m, "salaries", 120_000),
    pnlRow(m, "freelance_salaries", 10_000),
    pnlRow(m, "days_in_month", 20),
  ]),
  "2026-04",
  team,
  new Map([["designer", "designer"], ["owner", "owner"]]),
);

describe("studioMonths", () => {
  it("adds salaries and freelance as people cost, finished months only", () => {
    expect(studio.get("2026-03")).toMatchObject({ totalExpenses: 150_000, peopleCost: 130_000, workdays: 20 });
    expect(studio.has("2026-05")).toBe(false);
  });

  it("counts only the pay and revenue of people whose hours earn", () => {
    expect(studio.get("2026-03")).toMatchObject({ earnersPay: 100_000, earnersRevenue: 160_000 });
  });
});

describe("monthsEnding", () => {
  it("counts back across a new year", () => {
    expect(monthsEnding("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("efficiency", () => {
  it("spreads hours over the studio's workdays", () => {
    const e = efficiency(ledgers.get("a"), ["2026-03", "2026-04"], studio);
    expect(e.months).toBe(2);
    expect(e.hoursPerWorkday).toBe(100 / 40);
    expect(e.earnedPerHour).toBeCloseTo(29_000 / 100);
  });

  it("leaves out months they weren't there", () => {
    expect(efficiency(ledgers.get("a"), ["2026-01", "2026-03"], studio).months).toBe(1);
  });
});

describe("payAdvice", () => {
  it("is the revenue their work brings, less margin, over what pay must carry", () => {
    const a = payAdvice(ledgers.get("a"), ["2026-03"], studio, true, 0.15)!;
    // March: 50h × ₪300 = ₪15,000 revenue; pay ₪10,000.
    expect(a.revenue).toBe(15_000);
    expect(a.overhead).toBeCloseTo(1.4);
    expect(a.recommended).toBeCloseTo((15_000 * 0.85) / 1.4);
  });

  it("averages over the months and ignores months the studio has no P&L for", () => {
    const a = payAdvice(ledgers.get("a"), ["2026-03", "2026-04", "2026-05"], studio, true, 0)!;
    expect(a.months).toBe(2);
    expect(a.actual).toBe(22_000 / 2);
  });

  it("pays their studio work at the same rate, without holding it against them", () => {
    // April: 40h × ₪350 = ₪14,000 from client work; 10 of their 50h on Studio.
    const a = payAdvice(ledgers.get("a"), ["2026-04"], studio, true, 0.15)!;
    expect(a.studioShare).toBeCloseTo(0.2);
    expect(a.recommended).toBeCloseTo((14_000 * 0.85) / 1.4 / 0.8);
  });

  it("balances out: a studio making exactly the margin recommends what it pays", () => {
    // The designers earn ₪160k on ₪100k pay; costs ₪150k, revenue ₪170k.
    // At the margin that leaves (₪20k profit ÷ ₪160k = 12.5%), pay holds.
    const a = payAdvice(team.get("designer"), ["2026-03"], studio, true, 0.125)!;
    expect(a.recommended).toBeCloseTo(100_000);
  });

  it("has nothing to say for someone whose hours aren't their own", () => {
    expect(payAdvice(ledgers.get("a"), ["2026-03"], studio, false)).toBeNull();
  });
});

describe("hrAdvice", () => {
  const eff = (billableShare: number | null, hoursPerWorkday: number | null, months = 3): Efficiency => ({
    months, billableShare, hoursPerWorkday, studioShare: 0, keysShare: 0, earnedPerHour: null, returnRatio: null, summary: summarize(undefined, null),
  });
  const today = new Date(2026, 9, 13);
  const base = {
    active: true, ownWork: true, position: "designer" as const, freelancer: false, startDate: "2023-01-01", today,
    recent: eff(0.8, 7.5), earlier: eff(0.8, 7.5, 9),
    notes: [{ kind: "raise" as const, date: "2026-01-01" }, { kind: "review_year" as const, date: "2026-01-01" }],
  };
  const pay = (actual: number, recommended: number) => ({ actual, recommended, gap: recommended - actual, revenue: 0, overhead: 1.5, studioShare: 0, hours: 150, billableHours: 120, workdays: 21, months: 3, keys: [] });

  it("flags someone paid well below what their work supports", () => {
    expect(hrAdvice({ ...base, pay: pay(10_000, 14_000) })[0]).toMatchObject({ tone: "act", title: "Paid below what their work supports" });
  });

  it("says pay is fine within the tolerance, and nothing else when all is well", () => {
    expect(hrAdvice({ ...base, pay: pay(10_000, 10_500) }).map((a) => a.title)).toEqual(["Pay is in line with their work"]);
  });

  it("only calls a long wait for a raise urgent when they're underpaid", () => {
    const old = [{ kind: "raise" as const, date: "2024-01-01" }, { kind: "review_year" as const, date: "2026-01-01" }];
    const tone = (p: ReturnType<typeof pay>) => hrAdvice({ ...base, notes: old, pay: p }).find((a) => a.title.startsWith("No salary update"))?.tone;
    expect(tone(pay(10_000, 10_500))).toBe("watch");
    expect(tone(pay(10_000, 14_000))).toBe("act");
  });

  it("flags an overdue yearly talk and a long time since the last raise", () => {
    const titles = hrAdvice({ ...base, pay: null, notes: [{ kind: "raise", date: "2024-09-01" }] }).map((a) => a.title);
    expect(titles).toContain("Yearly talk overdue");
    expect(titles.some((t) => t.startsWith("No salary update in 2y"))).toBe(true);
  });

  it("asks for the 3-month talk of someone new", () => {
    const titles = hrAdvice({ ...base, pay: null, startDate: "2026-07-01", notes: [] }).map((a) => a.title);
    expect(titles).toContain("3-month talk due");
  });

  it("judges hours against the share of the month they were paid for", () => {
    const few = (jobShare: number | null) => hrAdvice({ ...base, pay: null, jobShare, recent: eff(0.8, 4.9) }).some((a) => a.title === "Few hours logged");
    expect(few(null)).toBe(true);
    expect(few(0.71)).toBe(false); // 4.9h ÷ 0.71 ≈ 6.9h a paid workday
  });

  it("notices a falling billable share and few hours", () => {
    const titles = hrAdvice({ ...base, pay: null, recent: eff(0.55, 5) }).map((a) => a.title);
    expect(titles).toEqual(expect.arrayContaining(["Billable share is falling", "Few hours logged"]));
  });

  it("gives a freelancer no raise, review-talk or hours advice", () => {
    const titles = hrAdvice({ ...base, freelancer: true, pay: null, notes: [], recent: eff(0.8, 3) }).map((a) => a.title);
    expect(titles).toEqual([]);
  });

  it("gives the owner no advice about themselves", () => {
    expect(hrAdvice({ ...base, position: "owner", pay: null, notes: [] })).toEqual([]);
  });

  it("talks in gross salary when payslips give it", () => {
    const gross = { unit: "month" as const, current: 10_000, at: { year: 2026, month: 9 }, share: null, recommended: 13_000 };
    const [a] = hrAdvice({ ...base, pay: pay(12_000, 12_500), gross });
    // The gross figures decide (10,000 vs 13,000), not the cost ones (in line).
    expect(a.title).toBe("Paid below what their work supports");
    expect(a.detail).toContain("₪13,000 gross");
    expect(a.detail).toContain("now ₪10,000 gross");
  });

  it("flags many hours written down to Keys", () => {
    const titles = hrAdvice({ ...base, pay: null, recent: { ...eff(0.8, 7.5), keysShare: 0.15 } }).map((a) => a.title);
    expect(titles).toContain("Many hours written down");
  });

  it("says nothing about someone who left", () => {
    expect(hrAdvice({ ...base, active: false, pay: pay(10_000, 20_000) })).toEqual([]);
  });
});

describe("Studio and Keys hours", () => {
  const l = buildLedgers({
    salaries: [{ profileId: "k", year: 2026, month: 5, amount: 10_000 }],
    freelance: [],
    entries: [
      { userId: "k", date: "2026-05-03", minutes: 60 * 60, client: "Acme", billable: true },
      { userId: "k", date: "2026-05-04", minutes: 60 * 20, client: "Studio", billable: false },
      { userId: "k", date: "2026-05-05", minutes: 60 * 20, client: "Acme", billable: false, keys: true },
    ],
    rates,
  }).get("k");

  it("sorts hours into billable, studio and Keys", () => {
    const s = summarize(l, 2026);
    expect([s.billableHours, s.studioHours, s.keysHours]).toEqual([60, 20, 20]);
    expect(s.keysShare).toBeCloseTo(0.2);
  });

  it("holds Keys hours against them but not studio work", () => {
    // ₪10,000 for 100h, 20h on Studio → ₪8,000 their client work has to earn.
    const s = summarize(l, 2026);
    expect(s.clientCost).toBeCloseTo(8_000);
    expect(s.returnRatio).toBeCloseTo((60 * 350) / 8_000);
  });
});

describe("grossPay", () => {
  // Booked cost is gross plus the employer's share; a payslip states the gross.
  const l = buildLedgers({
    salaries: [
      { profileId: "p", year: 2026, month: 8, amount: 6_000 },
      { profileId: "p", year: 2026, month: 9, amount: 12_000 },
    ],
    freelance: [],
    entries: [],
    rates,
  }).get("p");
  const slip = (month: number, quantity: number | null, paid: number) => ({
    year: 2026, month, salaryRate: 10_000, salaryQuantity: quantity, salaryPaid: paid, grossTotal: paid, vacationBalance: 3, sickBalance: 5,
  });
  const advice = (recommended: number) =>
    ({ actual: 9_000, revenue: 0, overhead: 1.5, studioShare: 0, recommended, gap: 0, hours: 0, billableHours: 0, workdays: 21, months: 2, keys: ["2026-08", "2026-09"] });

  it("shows the latest payslip's full-time gross salary", () => {
    const g = grossPay([slip(8, 0.5, 5_000), slip(9, null, 10_000)], l, null)!;
    expect(g).toMatchObject({ unit: "month", current: 10_000, at: { year: 2026, month: 9 }, share: null, recommended: null });
  });

  it("turns a recommendation in cost into full-time gross, over half and full months", () => {
    // ₪18,000 of cost bought ₪20,000 of full-time gross rate over the 2 months.
    const g = grossPay([slip(8, 0.5, 5_000), slip(9, null, 10_000)], l, advice(9_900))!;
    expect(g.recommended).toBeCloseTo((9_900 * 20_000) / 18_000);
  });

  it("leaves out months paid the other way (hourly then monthly)", () => {
    const mixed = [{ ...slip(8, 100, 6_000), salaryRate: 60 }, slip(9, null, 10_000)];
    const g = grossPay(mixed, l, advice(9_900))!;
    // Monthly now: only September counts — ₪10,000 rate for ₪12,000 cost.
    expect(g.unit).toBe("month");
    expect(g.recommended).toBeCloseTo((9_900 * 10_000) / 12_000);
  });

  it("puts an hourly worker's recommendation per hour", () => {
    const hourly = [8, 9].map((m) => ({ ...slip(m, 100, 6_000), salaryRate: 60 }));
    const g = grossPay(hourly, l, advice(9_000))!;
    expect(g.unit).toBe("hour");
    // ₪12,000 paid for ₪18,000 of cost, over 100h a month.
    expect(g.recommended).toBeCloseTo((9_000 * 12_000) / 18_000 / 100);
  });
});

describe("supportedPayByMonth", () => {
  // Travel and the like on top of the salary don't count.
  const slip = (month: number, salary: number) => ({
    year: 2026, month, salaryRate: salary, salaryQuantity: null, salaryPaid: salary, grossTotal: salary + 700, vacationBalance: null, sickBalance: null,
  });
  const l = ledgers.get("a");

  it("puts each month's 3-month advice into payslip salary", () => {
    const s = supportedPayByMonth([slip(3, 8_000), slip(4, 9_000)], l, studio, ["2026-03", "2026-04"]);
    expect(s.basis).toBe("salary");
    // March alone (no P&L before it): ₪8,000 of salary for ₪10,000 of cost.
    expect(s.byMonth.get("2026-03")).toBeCloseTo((payAdvice(l, ["2026-03"], studio)!.recommended * 8_000) / 10_000);
    // April looks at March and April: ₪17,000 of salary for ₪22,000 of cost.
    expect(s.byMonth.get("2026-04")).toBeCloseTo((payAdvice(l, monthsEnding("2026-04", 3), studio)!.recommended * 17_000) / 22_000);
  });

  it("uses all their payslips for months before the first", () => {
    const s = supportedPayByMonth([slip(4, 9_000)], l, studio, ["2026-03"]);
    expect(s.byMonth.get("2026-03")).toBeCloseTo((payAdvice(l, ["2026-03"], studio)!.recommended * 9_000) / 12_000);
  });

  it("stays in cost without payslips, and says nothing when hours aren't their own", () => {
    const s = supportedPayByMonth([], l, studio, ["2026-03"]);
    expect(s.basis).toBe("cost");
    expect(s.byMonth.get("2026-03")).toBeCloseTo(payAdvice(l, ["2026-03"], studio)!.recommended);
    expect(supportedPayByMonth([slip(3, 8_000)], l, studio, ["2026-03"], false).byMonth.size).toBe(0);
  });
});

describe("lastPayRise", () => {
  const s = (month: number, salaryRate: number, salaryQuantity: number | null = null) => ({
    year: 2026, month, salaryRate, salaryQuantity, salaryPaid: null, grossTotal: null, vacationBalance: null, sickBalance: null,
  });

  it("finds the last month the salary went up", () => {
    expect(lastPayRise([s(1, 15_000), s(2, 15_000), s(3, 18_000), s(4, 18_000)])).toBe("2026-03");
  });

  it("counts a move from hourly to monthly pay, not a lower hourly month", () => {
    expect(lastPayRise([s(5, 60, 120), s(6, 55, 100), s(7, 10_000)])).toBe("2026-07");
    expect(lastPayRise([s(5, 60, 120), s(6, 55, 100)])).toBeNull();
  });
});

describe("lastRaiseOf", () => {
  const s = (month: number, salaryRate: number) => ({
    year: 2025, month, salaryRate, salaryQuantity: null, salaryPaid: null, grossTotal: null, vacationBalance: null, sickBalance: null,
  });

  it("takes the latest of a raise or start note, a payslip rise and the start date", () => {
    const notes = [{ kind: "raise" as const, date: "2024-03-10" }, { kind: "review_year" as const, date: "2025-12-01" }];
    expect(lastRaiseOf(notes, [], "2022-01-01")).toBe("2024-03");
    expect(lastRaiseOf(notes, [s(5, 15_000), s(6, 17_000)], "2022-01-01")).toBe("2025-06");
    expect(lastRaiseOf([], [], "2023-09-15")).toBe("2023-09");
    expect(lastRaiseOf([{ kind: "start", date: "2021-02-01" }], [], null)).toBe("2021-02");
    expect(lastRaiseOf([], [], null)).toBeNull();
  });

  it("is what both the Overview advice and the raise box count from", () => {
    const today = new Date(2026, 9, 13);
    const slips = [s(1, 15_000), s(2, 17_000)];
    const notes = [{ kind: "raise" as const, date: "2023-01-01" }, { kind: "review_year" as const, date: "2026-06-01" }];
    const eff = { months: 3, billableShare: 0.8, hoursPerWorkday: 7.5, studioShare: 0, keysShare: 0, earnedPerHour: null, returnRatio: null, summary: summarize(undefined, null) };
    const common = { active: true, ownWork: true, position: "designer" as const, freelancer: false, startDate: "2022-01-01", notes, slips, today };
    // Raised on the Feb 2025 payslip: 20 months ago — the advice used to count from the 2023 note.
    const titles = hrAdvice({ ...common, pay: null, recent: eff, earlier: { ...eff, months: 9 } }).map((a) => a.title);
    expect(titles).toContain("No salary update in 1y 8m");
    const gross: GrossPay = { unit: "month", current: 17_000, at: { year: 2026, month: 9 }, share: null, recommended: 17_000 };
    expect(raiseAdvice({ ...common, last3: { pay: null, gross }, last12: { pay: null, gross } })!.lastRise).toBe("2025-02");
  });
});

describe("raiseAdvice", () => {
  const today = new Date(2026, 9, 14);
  const pay = (recommended: number, billableHours = 100): PayAdvice => ({
    actual: 20_000, revenue: 0, overhead: 1.5, studioShare: 0, recommended, gap: 0, hours: 140, billableHours, workdays: 21, months: 3, keys: [],
  });
  const gross = (current: number, recommended: number): GrossPay => ({ unit: "month", current, at: { year: 2026, month: 9 }, share: null, recommended });
  const base = {
    active: true, ownWork: true, position: "designer" as const, freelancer: false, startDate: "2024-01-01", notes: [], slips: [], today,
  };
  const plan = (s3: number, s12: number, extra: Partial<Parameters<typeof raiseAdvice>[0]> = {}) =>
    raiseAdvice({ ...base, last3: { pay: pay(0), gross: gross(10_000, s3) }, last12: { pay: pay(0, 90), gross: gross(10_000, s12) }, ...extra })!;

  it("raises now, by what both 3 and 12 months support, rounded down to ₪500", () => {
    const p = plan(11_400, 11_200);
    expect(p).toMatchObject({ verdict: "raise", target: 11_000, when: "now", ceiling: null });
  });

  it("caps a raise at 15% and names the next step", () => {
    const p = plan(14_000, 13_000);
    expect(p).toMatchObject({ verdict: "raise", target: 11_500, ceiling: 13_000 });
  });

  it("waits for the yearly review after the last raise", () => {
    const p = plan(11_400, 11_200, { notes: [{ kind: "raise", date: "2026-03-01" }] });
    expect(p.when).toBe("2027-03");
  });

  it("gives a raise on condition when only the last 3 months support it", () => {
    const p = plan(11_400, 9_800);
    expect(p).toMatchObject({ verdict: "raise_if", target: 11_000, when: "2027-01" });
    // 100 billable hours supported ₪11,400; ₪11,000 needs about 96.
    expect(p.need!.hours).toBeCloseTo((100 * 11_000) / 11_400);
  });

  it("holds when pay is about right, naming the hours a 10% raise takes", () => {
    const p = plan(10_200, 10_100);
    expect(p).toMatchObject({ verdict: "hold", target: 11_000 });
    expect(p.need!.hours).toBeCloseTo((100 * 11_000) / 10_200);
  });

  it("says no raise when their work carries well under their pay", () => {
    const p = plan(7_000, 7_500);
    expect(p).toMatchObject({ verdict: "no_raise", target: null });
    expect(p.need!.hours).toBeCloseTo((100 * 10_000) / 7_000);
  });

  it("puts a part-timer's hours as full time, like their salary", () => {
    const p = raiseAdvice({ ...base, last3: { pay: pay(0, 50), gross: gross(10_000, 10_200), jobShare: 0.5 }, last12: { pay: pay(0, 50), gross: gross(10_000, 10_100) } })!;
    expect(p.billable3).toBe(100);
    expect(p.need!.hours).toBeCloseTo((100 * 11_000) / 10_200);
  });

  it("adds what they bring beyond their hours to what their work supports", () => {
    // ₪10,200 alone holds; 10% on top makes ₪11,220 over 3 months, ₪11,110 over 12.
    const p = plan(10_200, 10_100, { premium: 0.1 });
    expect(p).toMatchObject({ verdict: "raise", target: 11_000, work3: 10_200 });
    expect(p.supported3).toBeCloseTo(11_220);
  });

  it("is a plain review for someone whose hours aren't their own, and none for freelancers", () => {
    expect(plan(11_400, 11_200, { ownWork: false, position: "office_manager" })).toMatchObject({ verdict: "review", when: "now" });
    expect(plan(11_400, 11_200, { freelancer: true })).toBeNull();
  });
});

describe("recommendedTerms", () => {
  const dima = { rateHigh: 140, rateLow: 100, hoursLow: 50, hoursHigh: 150 };
  const pay = (actual: number, recommended: number) => ({
    actual, recommended, gap: recommended - actual, revenue: 0, overhead: 1.5, studioShare: 0, hours: 118, billableHours: 100, workdays: 21, months: 3, keys: [],
  });

  it("scales both rates by what the work supports over what's paid, to ₪5", () => {
    const r = recommendedTerms(dima, pay(14_000, 15_400))!;
    expect(r.factor).toBeCloseTo(1.1);
    expect(r.terms).toEqual({ rateHigh: 155, rateLow: 110, hoursLow: 50, hoursHigh: 150 });
  });

  it("would have paid the supported amount at any hours (before rounding)", () => {
    // A month's bill at hours h is h × rate(h); both rates × k makes it × k.
    const k = 1.25;
    const rate = (h: number, t: typeof dima) =>
      h <= t.hoursLow ? t.rateHigh : h >= t.hoursHigh ? t.rateLow : t.rateHigh - ((t.rateHigh - t.rateLow) * (h - t.hoursLow)) / (t.hoursHigh - t.hoursLow);
    const scaled = { ...dima, rateHigh: dima.rateHigh * k, rateLow: dima.rateLow * k };
    for (const h of [30, 118, 160]) expect(h * rate(h, scaled)).toBeCloseTo(h * rate(h, dima) * k);
  });

  it("names the new rates in the advice", () => {
    const eff = { months: 3, billableShare: 0.8, hoursPerWorkday: 7, studioShare: 0, keysShare: 0, earnedPerHour: null, returnRatio: null, summary: summarize(undefined, null) };
    const [a] = hrAdvice({
      active: true, ownWork: true, position: null, freelancer: true, startDate: "2024-01-01", notes: [],
      pay: pay(10_000, 13_000), terms: dima, recent: eff, earlier: { ...eff, months: 9 }, today: new Date(2026, 9, 13),
    });
    expect(a.detail).toContain("₪180/h up to 50h a month, down to ₪130/h at 150h");
  });
});

describe("valuePremium", () => {
  it("adds each factor's share of its max by grade out of 10, concerns taking off", () => {
    expect(valuePremium({})).toBe(0);
    expect(valuePremium({ guidance: 10 })).toBeCloseTo(0.1);
    expect(valuePremium({ guidance: 6, clients: 0 })).toBeCloseTo(0.06);
    expect(valuePremium({ guidance: 10, concerns: 10 })).toBeCloseTo(0);
    expect(valuePremium({ culture: 14 })).toBeCloseTo(0.05);
  });
});

describe("sickDays", () => {
  const slip = (month: number, sickUsed: number | null) => ({
    year: 2026, month, salaryRate: null, salaryQuantity: null, salaryPaid: null, grossTotal: null, vacationBalance: null, sickBalance: null, sickUsed,
  });

  it("adds the sick days on those months' payslips", () => {
    expect(sickDays([slip(7, 2), slip(8, 0), slip(9, 1.5)], ["2026-08", "2026-09"])).toBe(1.5);
    expect(sickDays([slip(7, null)], ["2026-07"])).toBeNull();
  });
});

describe("neededReturn", () => {
  it("is the overhead grossed up by the target margin, or null without pay", () => {
    expect(neededReturn({ overhead: 1.7 })).toBeCloseTo(1.7 / 0.85, 10);
    expect(neededReturn(null)).toBeNull();
    expect(neededReturn(undefined)).toBeNull();
  });
});
