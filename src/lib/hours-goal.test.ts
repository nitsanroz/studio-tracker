import { describe, expect, it } from "vitest";
import { LINE, hoursGoal, type PnlMonthly } from "./hours-goal";

// ⚠️ Mirrors the hoursGoal tests in finance-admin's src/lib/overview.test.ts —
// keep both in step with hours-goal.ts (see its header).

const row = (month: number, lineItem: string, value: number, year = 2026): PnlMonthly => ({ year, month, lineItem, value });

// September: 18 workdays, 630h, ₪216,000. October so far: 24h, ₪7,920, 18 workdays.
const pnl: PnlMonthly[] = [
  row(9, LINE.daysInMonth, 18),
  row(9, LINE.totalHours, 630),
  row(9, LINE.hoursIncome, 216_000),
  row(9, LINE.totalRevenues, 216_000),
  row(10, LINE.daysInMonth, 18),
  row(10, LINE.totalHours, 24),
  row(10, LINE.hoursIncome, 7_920),
  row(10, LINE.totalRevenues, 7_920),
  row(10, LINE.totalExpenses, 140_000),
];

describe("hoursGoal", () => {
  // Jul–Sep: 1,800h for ₪600,000 → ₪333.33/h. October: ₪140,000 of costs over 18 workdays.
  const goalPnl: PnlMonthly[] = [
    ...pnl.filter((r) => r.month === 10),
    row(7, LINE.totalHours, 600), row(7, LINE.hoursIncome, 200_000),
    row(8, LINE.totalHours, 570), row(8, LINE.hoursIncome, 184_000),
    row(9, LINE.totalHours, 630), row(9, LINE.hoursIncome, 216_000),
  ];

  it("prices the month's costs at the last three months' rate", () => {
    const g = hoursGoal(goalPnl, 2026, new Date(2026, 9, 12))!;
    expect(g.rate).toBeCloseTo(600_000 / 1_800);
    expect(g.rateMonths).toEqual([{ year: 2026, month: 7 }, { year: 2026, month: 8 }, { year: 2026, month: 9 }]);
    expect(g.hours).toBeCloseTo(420);
    expect(g.perDay).toBeCloseTo(420 / 18);
    expect(g.perWeek).toBeCloseTo((420 / 18) * 5);
  });

  it("splits what's left over the workdays left, today included", () => {
    // Mon Oct 12 2026: Oct 1, 4–8 and 11 are the 7 Sun–Thu days before it, of 21 — scaled to 18.
    const g = hoursGoal(goalPnl, 2026, new Date(2026, 9, 12))!;
    expect(g.workdaysDone).toBeCloseTo((7 * 18) / 21);
    expect(g.workdaysLeft).toBeCloseTo(18 - (7 * 18) / 21);
    expect(g.expectedByNow).toBeCloseTo((420 / 18) * ((7 * 18) / 21));
    expect(g.neededPerDay).toBeCloseTo((420 - 24) / g.workdaysLeft);
    // Today (a Monday) counts toward the average logged: 8 days of 21, scaled to 18.
    expect(g.actualPerDay).toBeCloseTo(24 / ((8 * 18) / 21));
  });

  it("adds a profit target: the hours for revenue of costs ÷ (1 − margin)", () => {
    const g = hoursGoal(goalPnl, 2026, new Date(2026, 9, 12), { margin: 0.2 })!;
    // ₪140,000 ÷ 0.8 = ₪175,000 → 525h at ₪333.33/h.
    expect(g.profit.margin).toBe(0.2);
    expect(g.profit.hours).toBeCloseTo(525);
    expect(g.profit.perDay).toBeCloseTo(525 / 18);
    expect(g.profit.neededPerDay).toBeCloseTo((525 - 24) / g.workdaysLeft);
  });

  it("weighs each day by the designers in, from the weekly plan's absences", () => {
    // A team of 4; one away Sun–Tue Oct 18–20, after today: 3 days at ¾.
    const team = [...goalPnl, row(10, LINE.numDesigners, 4)];
    const absent = { "2026-10-18": 1, "2026-10-19": 1, "2026-10-20": 1, "2026-10-23": 9 };
    const g = hoursGoal(team, 2026, new Date(2026, 9, 12), { inputs: { absent, away: [], freelancers: [] } })!;
    const scale = 18 / 21;
    expect(g.absentDays).toBeCloseTo(3 * scale);
    expect(g.effectiveWorkdays).toBeCloseTo(18 - 3 * scale * 0.25);
    expect(g.days.find((d) => d.date === "2026-10-19")!.weight).toBeCloseTo(scale * 0.75);
    // Friday the 23rd isn't a workday, so its entry counts for nothing.
    expect(g.days.some((d) => d.date === "2026-10-23")).toBe(false);
    // The same hours over fewer full-team days: a higher daily target.
    expect(g.perDay).toBeCloseTo(420 / g.effectiveWorkdays);
    expect(g.perDay).toBeGreaterThan(420 / 18);
    // The absences are still ahead, so they weigh on what's left, not on "by today".
    expect(g.expectedByNow).toBeCloseTo(g.perDay * 7 * scale);
    expect(g.neededPerDay).toBeCloseTo((420 - 24) / (g.effectiveWorkdays - 7 * scale));
  });

  it("costs an hourly freelancer at their pace, not the plan's flat amount", () => {
    // Jul–Sep: 300h for ₪30,000 (₪100/h) over 18 + 18 + 18 workdays (no sheet days → Sun–Thu).
    const withDays = [...goalPnl, row(7, LINE.daysInMonth, 18), row(8, LINE.daysInMonth, 18), row(9, LINE.daysInMonth, 18)];
    const dima = {
      name: "Dima",
      planned: 14_000,
      recent: [7, 8, 9].map((month) => ({ year: 2026, month, hours: 100, pay: 10_000 })),
      soFar: 45,
      absent: ["2026-10-13", "2026-10-14"],
    };
    const g = hoursGoal(withDays, 2026, new Date(2026, 9, 12), { inputs: { absent: {}, away: [], freelancers: [dima] } })!;
    // 14 Sun–Thu days from Mon the 12th on, 2 of them away: 12 × 18/21 workdays at 300/54 h a day.
    const hours = 45 + (300 / 54) * 12 * (18 / 21);
    expect(g.freelance[0].hours).toBeCloseTo(hours);
    expect(g.freelance[0].rate).toBeCloseTo(100);
    expect(g.costs).toBeCloseTo(140_000 - 14_000 + hours * 100);
    expect(g.plannedCosts).toBe(140_000);
    expect(g.hours).toBeCloseTo(g.costs / g.rate);
  });

  it("prices a sliding-rate freelancer through his terms, plus his charges, in ₪", () => {
    // Jul–Sep: 54 workdays, 108h → 2h a workday. Mon Oct 12: 14 Sun–Thu days left (× 18/21).
    const withDays = [...goalPnl, row(7, LINE.daysInMonth, 18), row(8, LINE.daysInMonth, 18), row(9, LINE.daysInMonth, 18)];
    const ab = {
      name: "AB",
      planned: 5_000,
      terms: { currency: "EUR", rateHigh: 55, rateLow: 45, hoursLow: 50, hoursHigh: 150 },
      fx: 3.5,
      soFar: 40,
      charges: 100,
      recent: [7, 8, 9].map((month) => ({ year: 2026, month, hours: 36 })),
      absent: [],
    };
    const g = hoursGoal(withDays, 2026, new Date(2026, 9, 12), { inputs: { absent: {}, away: [], freelancers: [], formulaFreelancers: [ab] } })!;
    const hours = 40 + 2 * 14 * (18 / 21);
    const rate = 55 - (10 * (hours - 50)) / 100;
    const cost = (Math.round(hours * Math.round(rate * 100) / 100 * 100) / 100 + 100) * 3.5;
    expect(g.freelance[0].hours).toBeCloseTo(hours);
    expect(g.freelance[0].cost).toBeCloseTo(cost);
    expect(g.costs).toBeCloseTo(140_000 - 5_000 + cost);
  });

  it("lets project income cover part of the costs", () => {
    const g = hoursGoal([...goalPnl, row(10, LINE.projectIncome, 40_000)], 2026, new Date(2026, 9, 12))!;
    expect(g.hours).toBeCloseTo(300);
  });

  it("needs nothing more once the hours are in, and nothing per day after the last workday", () => {
    const covered = goalPnl.map((r) => (r.month === 10 && r.lineItem === LINE.totalHours ? { ...r, value: 500 } : r));
    expect(hoursGoal(covered, 2026, new Date(2026, 9, 12))!.neededPerDay).toBe(0);
    // Sat Oct 31: every workday is behind us.
    expect(hoursGoal(goalPnl, 2026, new Date(2026, 9, 31))!.neededPerDay).toBeNull();
  });

  it("has no goal without costs, without a recent rate, or outside the current year", () => {
    expect(hoursGoal(goalPnl.filter((r) => r.lineItem !== LINE.totalExpenses), 2026, new Date(2026, 9, 12))).toBeNull();
    expect(hoursGoal(pnl.filter((r) => r.month === 10), 2026, new Date(2026, 9, 12))).toBeNull();
    expect(hoursGoal(goalPnl, 2025, new Date(2026, 9, 12))).toBeNull();
  });
});
