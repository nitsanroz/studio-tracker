import { describe, expect, it } from "vitest";
import { LINE } from "@/lib/finance/finance";
import type { AdviceData as MoneyData } from "@/lib/finance/advice/signals";
import { hasAmount } from "@/lib/finance/advice/redact";
import { businessBrief, businessMetrics, completeMonths, strategy, type MonthCost } from "./business";
import { acceptBusiness, businessPrompt, type BusinessReviewed } from "./business-review";
import type { CrossFreelancer } from "./cross";
import type { AdviceRow } from "./merge";
import type { AdviceData as StudioData } from "./signals";

// A made-up studio: every name and figure here is invented.
const TODAY = "2026-11-15";
const Q = ["2026-08", "2026-09", "2026-10"];

/** One P&L month: income, costs and hours. */
const pnlMonth = (key: string, v: { revenue: number; expenses: number; hours: number; salaries?: number; freelance?: number; rent?: number; tools?: number }) => {
  const [year, month] = key.split("-").map(Number);
  const row = (lineItem: string, value: number) => ({ year, month, lineItem, value, state: "actual", source: "rollup" });
  return [
    row(LINE.totalRevenues, v.revenue),
    row(LINE.totalExpenses, v.expenses),
    row(LINE.totalHours, v.hours),
    row(LINE.hoursIncome, v.revenue),
    row(LINE.salaries, v.salaries ?? 0),
    row(LINE.freelance, v.freelance ?? 0),
    row(LINE.rentExpenses, v.rent ?? 0),
    row(LINE.expensesMonthly, v.tools ?? 0),
  ];
};

const money = (over: { months?: Record<string, Parameters<typeof pnlMonth>[1]>; rates?: MoneyData["rates"] } = {}): MoneyData => {
  const month = { revenue: 100_000, expenses: 95_000, hours: 400, salaries: 60_000, freelance: 10_000, rent: 10_000, tools: 5_000 };
  const months = over.months ?? Object.fromEntries(Q.map((k) => [k, month]));
  return {
    today: TODAY,
    pnl: Object.entries(months).flatMap(([k, v]) => pnlMonth(k, v)),
    rates: over.rates ?? [
      { clientId: "lumen", clientCanon: "Lumen", rate: 300, effectiveFrom: "2026-01-01", effectiveTo: null },
      { clientId: "halo", clientCanon: "Halo", rate: 200, effectiveFrom: "2024-06-01", effectiveTo: null },
    ],
  } as unknown as MoneyData;
};

/** `hours` a workday for `days` workdays of a month, by one person on one task. */
const logged = (taskId: string, userId: string, month: string, hours: number, days = 20) =>
  Array.from({ length: days }, (_, i) => ({ taskId, userId, date: `${month}-${String(i + 1).padStart(2, "0")}`, minutes: hours * 60 }));

const studio = (entries: StudioData["entries"], over: Partial<StudioData> = {}): StudioData => ({
  today: TODAY,
  entriesSince: "2026-05-01",
  clients: [
    { id: "lumen", name: "Lumen", billable: true, archived: false, hourCap: null, keysTaskId: null },
    { id: "halo", name: "Halo", billable: true, archived: false, hourCap: null, keysTaskId: null },
    { id: "studio", name: "Studio", billable: false, archived: false, hourCap: null, keysTaskId: null },
  ],
  tasks: [
    { id: "l", clientId: "lumen", sectionId: null, groupId: null, title: "Lumen site", billable: true },
    { id: "h", clientId: "halo", sectionId: null, groupId: null, title: "Halo brand", billable: true },
    { id: "s", clientId: "studio", sectionId: null, groupId: null, title: "Internal", billable: false },
  ],
  sections: [],
  groups: [],
  entries,
  periods: [],
  reportLinks: [],
  estimates: [],
  pnl: [],
  pace: null,
  ownerId: "owner",
  leadsOpen: 3,
  ...over,
});

/** Two salaried designers at 20,000 a month each, every month of the quarter. */
const salaries = (ids = ["dana", "tal"]): MonthCost[] => Q.flatMap((month) => ids.map((profileId) => ({ profileId, month, costIls: 20_000, kind: "salary" as const })));
/** Dana on Lumen and Tal on Halo, `hours` a day each, all quarter. */
const quarter = (hours: number) => Q.flatMap((month) => [...logged("l", "dana", month, hours), ...logged("h", "tal", month, hours)]);

describe("completeMonths", () => {
  it("is the months before this one, oldest first, across a year's end", () => {
    expect(completeMonths("2026-11-15", 3)).toEqual(Q);
    expect(completeMonths("2027-02-01", 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

describe("businessMetrics", () => {
  it("reads the quarter from the books and the tracker together", () => {
    const m = businessMetrics(studio(quarter(5)), money(), [], salaries())!;
    expect(m.label).toBe("Aug–Oct");
    expect(m.margin).toBeCloseTo(0.05);
    expect(m.shares).toMatchObject({ salaries: 0.6, freelance: 0.1, rent: 0.1, tools: 0.05 });
    // 300,000 of income over 1,200 hours; 285,000 of costs over the same hours.
    expect(m.avgRate).toBeCloseTo(250);
    expect(m.loadedHourCost).toBeCloseTo(237.5);
    expect(m.designers).toBe(2);
    expect(m.avgEmployeeCost).toBe(20_000);
  });

  it("works out the same gap to the target three ways", () => {
    const g = businessMetrics(studio(quarter(5)), money(), [], salaries())!.gap!;
    // 285,000 ÷ 0.85 = 335,294 needed; 35,294 short over the quarter.
    expect(g.incomeShortPerMonth).toBeCloseTo(11_765, 0);
    expect(g.rateUp).toBeCloseTo(0.1176, 3);
    expect(g.extraHoursPerMonth).toBeCloseTo(47.06, 1);
    expect(g.costCut).toBeCloseTo(0.1053, 3);
  });

  it("has no gap at or above the target", () => {
    const rich = Object.fromEntries(Q.map((k) => [k, { revenue: 100_000, expenses: 80_000, hours: 400 }]));
    expect(businessMetrics(studio(quarter(5)), money({ months: rich }), [], salaries())!.gap).toBeNull();
  });

  it("is null until all three months are booked", () => {
    const two = Object.fromEntries(Q.slice(0, 2).map((k) => [k, { revenue: 100_000, expenses: 95_000, hours: 400 }]));
    expect(businessMetrics(studio(quarter(5)), money({ months: two }), [], salaries())).toBeNull();
  });

  it("counts a salaried person only in months with real hours, and never a freelancer", () => {
    const rare = [...quarter(5), ...logged("l", "noa", "2026-10", 1, 10)]; // 10h: not a working month
    const costs = [...salaries(), { profileId: "noa", month: "2026-10", costIls: 20_000, kind: "salary" as const }, { profileId: "ab", month: "2026-10", costIls: 9_000, kind: "freelance" as const }];
    expect(businessMetrics(studio(rare), money(), [], costs)!.designers).toBe(2);
  });

  it("gives each client its share of the hours, the age of its rate and what it leaves", () => {
    const m = businessMetrics(studio(quarter(5)), money(), [], salaries())!;
    const [lumen, halo] = [m.clients.find((c) => c.name === "Lumen")!, m.clients.find((c) => c.name === "Halo")!];
    expect(lumen.hoursShare).toBeCloseTo(0.5);
    expect(lumen.rateAgeMonths).toBe(10);
    expect(halo.rateAgeMonths).toBe(29);
    // Dana: 20,000 ÷ 100h = 200 an hour against Lumen's 300 → a third left. Tal against Halo's 200 → nothing.
    expect(lumen.leftShare).toBeCloseTo(1 / 3);
    expect(halo.leftShare).toBeCloseTo(0);
  });

  it("leaves a client's margin unknown when the owner did most of the hours", () => {
    const owners = Q.flatMap((month) => logged("l", "owner", month, 5));
    const m = businessMetrics(studio(owners), money(), [], salaries())!;
    expect(m.clients[0].leftShare).toBeNull();
    expect(m.ownerShare).toBe(1);
  });
});

describe("strategy — what the rules can say on their own", () => {
  const cards = (m: ReturnType<typeof businessMetrics>) => Object.fromEntries(strategy(m).map((f) => [f.signal, f]));

  it("is silent without the figures", () => {
    expect(strategy(null)).toEqual([]);
  });

  it("turns the gap to the target into three levers", () => {
    const f = cards(businessMetrics(studio(quarter(5)), money(), [], salaries()))["target-gap"];
    expect(f).toMatchObject({ key: "strategy:target-gap:2026-10", kind: "idea", area: "Strategy · Profit", figure: "−₪12K/mo" });
    expect(f.title).toBe("Aug–Oct ran at 5% — three ways to the 15% target");
    expect(f.facts).toMatchObject({ marginPct: 5, rateUpPct: 12, extraHoursPerMonth: 47, costCutPct: 11 });
  });

  it("names the clients paying less than an hour costs", () => {
    const f = cards(businessMetrics(studio(quarter(5)), money(), [], salaries()))["hour-cost"];
    // Halo pays 200 against 237.5: 37.5 × 100h a month.
    expect(f.facts).toMatchObject({ clients: "Halo", hoursSharePct: 50, gapIls: 3750 });
    expect(f.title).toBe("Halo pays less than an hour costs the studio");
  });

  it("names rates unchanged for a year, and not younger ones", () => {
    const f = cards(businessMetrics(studio(quarter(5)), money(), [], salaries()))["rate-age"];
    expect(f.facts).toMatchObject({ clients: "Halo", oldestMonths: 29 });
    expect(f.figure).toBeNull();
  });

  it("says there is room to sell when the team bills under 65% of a full day", () => {
    const f = cards(businessMetrics(studio(quarter(4)), money(), [], salaries())).capacity; // 4h of 8
    expect(f.title).toContain("there is room to sell");
    expect(f.facts).toMatchObject({ utilizationPct: expect.any(Number), openLeads: 3 });
    expect(f.facts.utilizationPct as number).toBeLessThan(65);
  });

  it("says the team is full above 85%, and nothing in between", () => {
    expect(cards(businessMetrics(studio(quarter(7.5)), money(), [], salaries())).capacity.title).toContain("it is full");
    expect(cards(businessMetrics(studio(quarter(6)), money(), [], salaries())).capacity).toBeUndefined();
  });

  it("compares a busy freelancer with a hire", () => {
    // 200 an hour: an employee at 20,000 a month costs the same from 100h. AB logs 110h a month.
    const ab: CrossFreelancer = { profileId: "ab", name: "Avi Bar", terms: { currency: "ILS", rateHigh: 200, rateLow: 200, hoursLow: 50, hoursHigh: 150 }, fx: 1, monthHours: 110 };
    const entries = [...quarter(5), ...Q.flatMap((month) => logged("l", "ab", month, 5.5))];
    const f = cards(businessMetrics(studio(entries), money(), [ab], salaries()))["freelance-or-hire"];
    expect(f.facts).toMatchObject({ name: "Avi", hoursPerMonth: 110, breakEvenHours: 100 });
    const light = [...quarter(5), ...Q.flatMap((month) => logged("l", "ab", month, 2))];
    expect(cards(businessMetrics(studio(light), money(), [ab], salaries()))["freelance-or-hire"]).toBeUndefined();
  });

  it("says when people take well over the rule-of-thumb share of income", () => {
    // Salaries 60% + freelancers 10% of income.
    const f = cards(businessMetrics(studio(quarter(6)), money(), [], salaries()))["people-share"];
    expect(f).toMatchObject({ figure: "70%", title: "People took 70% of income over Aug–Oct" });
    const lean = Object.fromEntries(Q.map((k) => [k, { revenue: 100_000, expenses: 80_000, hours: 400, salaries: 40_000, freelance: 5_000 }]));
    expect(cards(businessMetrics(studio(quarter(6)), money({ months: lean }), [], salaries()))["people-share"]).toBeUndefined();
  });

  it("says when nearly all income is sold by the hour", () => {
    const f = cards(businessMetrics(studio(quarter(6)), money(), [], salaries()))["hourly-model"];
    expect(f.facts.hourlySharePct).toBe(100);
    expect(f.body).toContain("fixed deliverable");
  });

  it("tells the owner when a quarter or more of the billable hours are their own", () => {
    const entries = [...quarter(5), ...Q.flatMap((month) => logged("l", "owner", month, 5))];
    const f = cards(businessMetrics(studio(entries), money(), [], salaries()))["owner-load"];
    expect(f.facts.ownerSharePct).toBe(33);
    expect(cards(businessMetrics(studio(quarter(5)), money(), [], salaries()))["owner-load"]).toBeUndefined();
  });

  it("never puts an amount in a title — titles are what Claude is sent", () => {
    const entries = [...quarter(4), ...Q.flatMap((month) => logged("l", "owner", month, 5))];
    for (const f of strategy(businessMetrics(studio(entries), money(), [], salaries()))) expect(f.title).not.toMatch(/[₪€$]/);
  });
});

describe("businessBrief — what Claude is sent", () => {
  const row = (title: string, signal = "cap"): AdviceRow => ({ title, signal, area: "Budget", severity: 2, resolvedAt: null, facts: {} }) as unknown as AdviceRow;

  it("holds no amount: shares, percentages, hours and indexes only", () => {
    const m = businessMetrics(studio(quarter(5)), money(), [], salaries())!;
    const text = businessPrompt(m, TODAY, [row("Lumen is at 92% of October's cap"), row("Paid ₪12,000 late")]);
    expect(text).not.toMatch(/[₪€$]/);
    // None of the studio's real figures, in any spelling.
    for (const figure of ["100000", "100,000", "95000", "285000", "20000", "237.5", "237", "250"]) expect(text).not.toContain(figure);
    expect(text).toContain("[amount]");
  });

  it("gives rates as an index where the average is 100", () => {
    const brief = businessBrief(businessMetrics(studio(quarter(5)), money(), [], salaries())!, TODAY, []);
    expect(brief.pricing).toMatchObject({ averageRateIndex: 100, costOfABillableHourIndex: 95, rateIndexNeededForTarget: 112 });
    expect(brief.clients.find((c) => c.name === "Lumen")).toMatchObject({ rateIndex: 120, shareOfBillableHoursPct: 50, leftAfterItsPeoplePct: 33 });
    expect(brief.costsAsShareOfIncomePct).toMatchObject({ salaries: 60, freelancers: 10, rent: 10, tools: 5 });
    expect(brief.concentration).toMatchObject({ largestClientShareOfHoursPct: 50, topThreeShareOfHoursPct: 100, activeClients: 2 });
    expect(brief.incomeSoldByTheHourPct).toBe(100);
  });

  it("leaves Claude's own cards out of what the checks found", () => {
    const m = businessMetrics(studio(quarter(5)), money(), [], salaries())!;
    const text = businessPrompt(m, TODAY, [row("An idea", "idea"), row("A past review", "review"), row("Report due")]);
    expect(text).toContain("Report due");
    expect(text).not.toContain("A past review");
  });
});

describe("acceptBusiness — what is kept of Claude's answer", () => {
  const rec = (over: Partial<BusinessReviewed["recommendations"][number]> = {}) => ({ area: "Pricing" as const, horizon: "this quarter" as const, title: "Raise Halo's rate at renewal", why: "Halo is on half the hours at an index of 80.", action: "Tell them in December.", ...over });

  it("keeps well-formed recommendations and drops any that carry an amount", () => {
    const kept = acceptBusiness({ summary: "A steady studio.", recommendations: [rec(), rec({ why: "They pay ₪200 an hour." }), rec({ title: " " })], questions: ["Is Halo strategic?", "Worth 12,000 a month?"] });
    expect(kept.recommendations).toHaveLength(1);
    expect(kept.questions).toEqual(["Is Halo strategic?"]);
    expect(hasAmount(kept.summary)).toBe(false);
  });

  it("drops an unknown area or horizon, and caps the list at six", () => {
    const many = Array.from({ length: 9 }, () => rec());
    expect(acceptBusiness({ summary: "", recommendations: [...many, rec({ area: "Magic" as never })], questions: [] }).recommendations).toHaveLength(6);
    expect(acceptBusiness({ summary: "", recommendations: [rec({ horizon: "someday" as never })], questions: [] }).recommendations).toEqual([]);
  });
});

describe("the playbook", () => {
  it("is general knowledge only — no amount, so it may sit in a browser bundle", async () => {
    const { PLAYBOOK } = await import("./playbook");
    expect(PLAYBOOK).not.toMatch(/[₪$€]/);
    expect(PLAYBOOK).toContain("rule of thumb");
  });
});
