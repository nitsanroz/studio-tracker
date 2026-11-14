// The scenario engine against the staffing handoff's hand-worked numbers
// (2026-11-10), plus the cash rules from the accountant's call (2026-11-11).
// People are anonymous here (E1, E2, F1) — only the arithmetic matters.

import { describe, expect, it } from "vitest";
import { addMonths, type Decision } from "./decisions";
import { DEFAULT_FACTS } from "./facts";
import { runScenario, stabilityGrade, stateAt } from "./engine";
import type { Baseline, CompanyFacts, Futures, Member } from "./types";

const member = (id: string, kind: Member["kind"], monthlyCost: number, capacity = 0, extra: Partial<Member> = {}): Member => ({
  id, name: id, initials: id, kind, monthlyCost, capacity, hours: capacity, billable: capacity, keys: 0, studio: 0, ...extra,
});

/** Handoff scenario 1: ₪350/h, 30 free owner+staff hours, two designers
 * (115h + 92h), one freelancer on ₪140→100 sliding terms, office ₪21.5K,
 * other fixed ₪5.8K; owner 36.9K and staff 15K employer cost. No Keys. */
function handoff(): Baseline {
  return {
    start: "2026-11",
    basedOn: ["2026-08", "2026-09", "2026-10"],
    rate: 350,
    keysShare: 0,
    soldHours: 576,
    projectIncome: 0,
    team: [
      member("O", "owner", 36_900),
      member("S", "staff", 15_000),
      member("E1", "designer", 23_000, 115),
      member("E2", "designer", 12_000, 92),
      member("F1", "freelancer", 0, 300, { price: { kind: "terms", currency: "ILS", terms: { rateHigh: 140, rateLow: 100, hoursLow: 50, hoursHigh: 150 } }, paidWritedowns: true }),
    ],
    otherPayroll: 0,
    office: 21_500,
    otherFixed: 5_800,
    ownerId: "O",
    ownerGross: 15_000,
    employerRatio: 36_900 / 15_000,
    ownerHours: 30,
    staffHours: 0,
    fx: { EUR: 3.99, USD: 3.34 },
    references: [],
    actual: { revenue: 0, costs: 140_000, profit: 0, freelance: 0 },
    profitSinceFacts: 0,
  };
}

const flat = (hours: number): Futures => ({
  bad: { hours, drift: 0, projectIncome: 0 },
  mid: { hours, drift: 0, projectIncome: 0 },
  good: { hours, drift: 0, projectIncome: 0 },
});

const facts: CompanyFacts = { ...DEFAULT_FACTS, taxRefund: 0, cashToday: 300_000, cashAsOf: "2026-11-01", loan: 0, loanAsOf: "2026-11-01", cashFloor: 100_000 };
const d = (x: Omit<Decision, "id">): Decision => ({ id: Math.random().toString(36), ...x });

describe("break-even against the handoff", () => {
  it("today (scenario 1) breaks even near 367 sold hours", () => {
    const r = runScenario(handoff(), [], flat(400), facts);
    expect(r.breakEven).toBeGreaterThan(357);
    expect(r.breakEven).toBeLessThan(377);
  });

  it("no office (scenario 2) moves break-even down by ~90 hours", () => {
    const office = d({ type: "office_end", from: "2026-11", months: 4, alsoSaves: 0, writeoff: 0 });
    const r = runScenario(handoff(), [office], flat(400), facts);
    expect(r.breakEven).toBeGreaterThan(268);
    expect(r.breakEven).toBeLessThan(290);
  });
});

describe("decisions over time", () => {
  it("office notice: rent through the notice, then none; write-off in the last month, no cash", () => {
    const office = d({ type: "office_end", from: "2026-11", months: 4, writeoff: 50_000 });
    const r = runScenario(handoff(), [office], flat(400), facts);
    const m = r.futures.mid.months;
    expect(m.find((x) => x.month === "2027-03")!.office).toBe(21_500);
    expect(m.find((x) => x.month === "2027-04")!.office).toBe(0);
    const mar = m.find((x) => x.month === "2027-03")!;
    expect(mar.oneOff).toBe(-50_000);
    const prev = m.find((x) => x.month === "2027-02")!;
    // Cash moves by the profit WITHOUT the write-off.
    expect(mar.cash - prev.cash).toBeCloseTo(mar.profit + 50_000, 5);
  });

  it("a let-go designer is paid through their last month, then costs nothing", () => {
    const leave = d({ type: "person_leave", personId: "E1", from: "2026-12" });
    const b = handoff();
    expect(stateAt(b, [leave], "2026-12", facts).team.some((m) => m.id === "E1")).toBe(true);
    expect(stateAt(b, [leave], "2027-01", facts).team.some((m) => m.id === "E1")).toBe(false);
  });

  it("work beyond every capacity is turned away and earns nothing", () => {
    const b = handoff();
    b.team = b.team.filter((m) => m.kind !== "freelancer");
    const r = runScenario(b, [], flat(400), facts);
    // 30 + 115 + 92 = 237 hours fit; 163 turned away a month.
    expect(r.futures.mid.months[0].turnedAway).toBeCloseTo(163, 5);
    expect(r.futures.mid.months[0].revenue).toBeCloseTo(237 * 350, 5);
  });

  it("extra work is shared by today's freelancer mix; a freelancer given hours by a decision gets them first", () => {
    const b = handoff();
    const flat140 = { kind: "flat" as const, rate: 100, currency: "ILS" as const };
    b.team = [
      ...b.team.filter((m) => m.kind !== "freelancer"),
      member("A", "freelancer", 0, 1000, { hours: 100, price: flat140, paidWritedowns: true }),
      member("B", "freelancer", 0, 1000, { hours: 300, price: flat140, paidWritedowns: true }),
    ];
    // 237h fit in-house; 200h left → A:B = 1:3.
    expect(runScenario(b, [], flat(437), facts).futures.mid.months[0].freelance).toBeCloseTo(200 * 100, 5);
    const s = stateAt(b, [], "2026-11", facts);
    expect(s.team.find((m) => m.id === "A")!.capSet).toBeFalsy();
    const katie = d({ type: "freelancer_add", from: "2026-11", name: "K", rate: 200, currency: "ILS", capacity: 80, paidWritedowns: true });
    // K takes her 80h first at ₪200, the other 120h are shared at ₪100.
    expect(runScenario(b, [katie], flat(437), facts).futures.mid.months[0].freelance).toBeCloseTo(80 * 200 + 120 * 100, 5);
  });

  it("AI speed cuts hourly revenue but not work sold per deliverable", () => {
    const ai = d({ type: "ai_productivity", from: "2026-11", pct: 20, months: 0, toolCost: 0 });
    const hourly = runScenario(handoff(), [ai], flat(200), facts).futures.mid.months[0];
    expect(hourly.revenue).toBeCloseTo(200 * 0.8 * 350, 5);
    const fixed = d({ type: "fixed_price", from: "2026-11", pct: 100, discount: 0 });
    const perDeliverable = runScenario(handoff(), [ai, fixed], flat(200), facts).futures.mid.months[0];
    expect(perDeliverable.revenue).toBeCloseTo(200 * 350, 5);
  });

  it("clients taking routine work in-house cuts the volume", () => {
    const inHouse = d({ type: "in_house", from: "2026-11", pct: 25, months: 0 });
    const r = runScenario(handoff(), [inHouse], flat(200), facts);
    expect(r.futures.mid.months[0].volume).toBeCloseTo(150, 5);
  });

  it("Keys write-downs use capacity but earn nothing", () => {
    const b = handoff();
    b.keysShare = 0.2;
    const m = runScenario(b, [], flat(200), facts).futures.mid.months[0];
    expect(m.work).toBeCloseTo(250, 5);
    expect(m.revenue).toBeCloseTo(200 * 350, 5);
  });
});

describe("the year's dividend", () => {
  it("is the profit after company tax, net of dividend tax, and clears the loan first", () => {
    const f = { ...facts, loan: 50_000, cashToday: 2_000_000, cashFloor: 0 };
    const r = runScenario(handoff(), [], flat(500), f).futures.mid;
    expect(r.dividend.limitedBy).toBe("profit");
    expect(r.dividend.net).toBeCloseTo(r.profit * 0.77 * 0.7, 5);
    expect(r.dividend.toLoan).toBeCloseTo(r.months[11].loan, 5);
    expect(r.dividend.toYou).toBeCloseTo(r.dividend.net - r.dividend.toLoan, 5);
  });

  it("never takes the bank under the cash floor", () => {
    const f = { ...facts, loan: 0, cashToday: 120_000, cashFloor: 100_000 };
    const r = runScenario(handoff(), [], flat(500), f).futures.mid;
    expect(r.dividend.limitedBy).toBe("cash");
    expect(r.dividend.gross).toBeCloseTo(r.lowestCash.cash - 100_000, 5);
  });

  it("is nothing in a losing year", () => {
    const r = runScenario(handoff(), [], flat(200), facts).futures.mid;
    expect(r.dividend.net).toBe(0);
    expect(r.dividend.limitedBy).toBe("none");
  });
});

describe("cash", () => {
  it("equipment sold: the price is cash, the P&L sees price less book value", () => {
    const office = d({ type: "office_end", from: "2026-11", months: 4, equipmentSale: 20_000 });
    const m = runScenario(handoff(), [office], flat(400), { ...facts, equipmentBook: 50_000 }).futures.mid.months;
    const mar = m.find((x) => x.month === "2027-03")!;
    const feb = m.find((x) => x.month === "2027-02")!;
    expect(mar.oneOff).toBe(-30_000);
    // Cash = profit with the book loss added back, plus the price received.
    expect(mar.cash - feb.cash).toBeCloseTo(mar.profit + 30_000 + 20_000, 5);
  });

  it("a dividend clears the loan first; only its tax leaves the bank", () => {
    const f = { ...facts, loan: 100_000 };
    const div = d({ type: "dividend", from: "2027-01", amount: 70_000 });
    const r = runScenario(handoff(), [div], flat(400), f);
    const m = r.futures.mid.months;
    const jan = m.find((x) => x.month === "2027-01")!;
    const dec = m.find((x) => x.month === "2026-12")!;
    expect(jan.dividendTax).toBeCloseTo(30_000, 5);
    expect(jan.dividendCash).toBe(0);
    expect(jan.cash - dec.cash).toBeCloseTo(jan.profit - 30_000, 5);
    expect(jan.loan).toBeLessThan(dec.loan - 69_000);
  });

  it("the reserve is the deepest dip in cumulative profit; runway counts to cash under zero", () => {
    const r = runScenario(handoff(), [], flat(200), { ...facts, cashToday: 100_000 });
    const bad = r.futures.bad;
    expect(bad.reserve).toBeCloseTo(Math.min(...bad.months.map((m) => m.cumProfit)), 5);
    expect(bad.reserve).toBeLessThan(0);
    expect(bad.runway).not.toBeNull();
    expect(bad.months[bad.runway!].cash).toBeLessThan(0);
    expect(bad.lowestCash.cash).toBe(Math.min(...bad.months.map((m) => m.cash)));
  });

  it("the tax refund arrives as cash only, in its month", () => {
    const f = { ...facts, taxRefund: 17_000, taxRefundMonth: addMonths("2026-11", 1) };
    const m = runScenario(handoff(), [], flat(400), f).futures.mid.months;
    expect(m[1].cash - m[0].cash).toBeCloseTo(m[1].profit + 17_000, 5);
  });
});

describe("stability grade", () => {
  it("is 0–100, and higher when the office goes and the bad future breaks even", () => {
    const f = flat(400);
    f.bad.hours = 320;
    const today = runScenario(handoff(), [], f, facts);
    const noOffice = runScenario(handoff(), [d({ type: "office_end", from: "2026-11", months: 0, alsoSaves: 0, writeoff: 0 })], f, facts);
    const g1 = stabilityGrade(today, f);
    const g2 = stabilityGrade(noOffice, f);
    expect(g1).toBeGreaterThanOrEqual(0);
    expect(g2).toBeLessThanOrEqual(100);
    expect(g2).toBeGreaterThan(g1);
  });
});
