import { describe, expect, it } from "vitest";
import { boardFigures, boardHistory, boardMonthsFor, boardPeriods } from "./board";
import type { BusinessMetrics } from "./business";
import type { AdviceRow } from "./merge";

const row = (over: Partial<AdviceRow>): AdviceRow => ({
  id: over.key ?? "1",
  key: "k",
  signal: "s",
  kind: "heads",
  area: "Clients",
  clientId: null,
  severity: 1,
  facts: {},
  title: "t",
  body: "b",
  wordedTitle: null,
  wordedBody: null,
  isReminder: false,
  firstSeen: "2026-11-10T08:00:00Z",
  lastSeen: "2026-11-10T08:00:00Z",
  resolvedAt: null,
  doneAt: null,
  snoozedUntil: null,
  snoozedAtSeverity: null,
  ...over,
});

describe("the page's history", () => {
  const today = "2026-11-15"; // a Sunday

  it("lists what is snoozed past today or dismissed, and not what a check closed", () => {
    const { hidden } = boardHistory(
      [
        row({ key: "open" }),
        row({ key: "snoozed", snoozedUntil: "2026-11-20" }),
        row({ key: "back-today", snoozedUntil: "2026-11-15" }),
        row({ key: "dismissed", doneAt: "2026-11-12T10:00:00Z" }),
        row({ key: "dismissed-then-closed", doneAt: "2026-11-01T10:00:00Z", resolvedAt: "2026-11-05T10:00:00Z" }),
      ],
      today,
    );
    expect(hidden.map((r) => r.key).sort()).toEqual(["dismissed", "snoozed"]);
  });

  it("lists what closed in the last 30 days, newest first", () => {
    const { resolved } = boardHistory(
      [row({ key: "old", resolvedAt: "2026-09-01T10:00:00Z" }), row({ key: "a", resolvedAt: "2026-11-02T10:00:00Z" }), row({ key: "b", resolvedAt: "2026-11-14T10:00:00Z" })],
      today,
    );
    expect(resolved.map((r) => r.key)).toEqual(["b", "a"]);
  });

  it("counts each week's opened and closed over eight weeks starting on Sundays", () => {
    const { weeks } = boardHistory(
      [
        row({ key: "a", firstSeen: "2026-11-15T07:00:00Z" }),
        row({ key: "b", firstSeen: "2026-11-10T07:00:00Z", resolvedAt: "2026-11-12T07:00:00Z" }),
        row({ key: "c", firstSeen: "2026-06-01T07:00:00Z", resolvedAt: "2026-11-09T07:00:00Z" }),
      ],
      today,
    );
    expect(weeks).toHaveLength(8);
    expect(weeks[0].start).toBe("2026-09-27");
    expect(weeks[7]).toEqual({ start: "2026-11-15", opened: 1, resolved: 0 });
    expect(weeks[6]).toEqual({ start: "2026-11-08", opened: 1, resolved: 2 });
    for (const w of weeks) expect(new Date(`${w.start}T12:00:00`).getDay()).toBe(0);
  });
});

describe("the page's figures", () => {
  const metrics = {
    months: ["2026-08", "2026-09", "2026-10"],
    label: "Aug–Oct",
    revenue: 300_000,
    expenses: 270_000,
    margin: 0.1,
    marginLastYear: 0.2,
    shares: { salaries: 0.5, freelance: 0.15, rent: 0.08, tools: 0.05, other: 0.12 },
    sharesLastYear: null,
    billableHours: 1000,
    avgRate: 300,
    hourlyShare: 1,
    topClient: 0.4,
    topThree: 0.7,
    loadedHourCost: 270,
    loadedHourCostLastYear: null,
    designers: 6,
    workdays: 64,
    utilization: 0.6,
    ownerShare: 0.05,
    avgEmployeeCost: 20_000,
    gap: { incomeShortPerMonth: 10_000, rateUp: 0.08, extraHoursPerMonth: 30, extraPerDesignerDay: 0.2, costCut: 0.07 },
    clients: Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, name: `Client ${i}`, hours: 100 - i, hoursShare: 0.1, rate: 300, rateAgeMonths: 14, leftShare: 0.3 })),
    freelancers: [{ name: "Ab", hoursPerMonth: 90, hourlyIls: 180, hireBreakEvenHours: 110 }],
    pipeline: { openLeads: 3, waitingOnUs: 1, candidates: 2 },
  } satisfies BusinessMetrics;

  it("is null when the months aren't booked", () => {
    expect(boardFigures(null)).toBeNull();
  });

  it("lists the largest clients and folds the rest into one line", () => {
    const f = boardFigures(metrics)!;
    expect(f.clients).toHaveLength(8);
    expect(f.otherClients.count).toBe(2);
    expect(f.otherClients.hoursShare).toBeCloseTo(0.2);
  });

  it("carries no person's cost: a freelancer's rate, the average salary and the totals stay on the server", () => {
    const text = JSON.stringify(boardFigures(metrics));
    for (const secret of ["hourlyIls", "hireBreakEvenHours", "avgEmployeeCost", "incomeShortPerMonth", "revenue", "expenses", "180", "20000", "300000"]) expect(text, secret).not.toContain(secret);
    expect(JSON.parse(text).freelancers).toEqual([{ name: "Ab", hoursPerMonth: 90 }]);
  });
});

describe("the page's period choice", () => {
  it("offers three spans and each of the last six complete months, newest first", () => {
    const p = boardPeriods("2026-11-15");
    expect(p.slice(0, 3).map((x) => x.id)).toEqual(["3m", "1m", "6m"]);
    expect(p.slice(3).map((x) => x.id)).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
  });

  it("reads the months a period names, oldest first", () => {
    expect(boardMonthsFor("3m", "2026-11-15")).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(boardMonthsFor("1m", "2026-11-15")).toEqual(["2026-10"]);
    expect(boardMonthsFor("6m", "2026-11-15")).toHaveLength(6);
    expect(boardMonthsFor("2026-07", "2026-11-15")).toEqual(["2026-07"]);
  });

  it("refuses a month it has no hours for, or one not over yet", () => {
    expect(boardMonthsFor("2026-04", "2026-11-15")).toBeNull();
    expect(boardMonthsFor("2026-11", "2026-11-15")).toBeNull();
    expect(boardMonthsFor("nonsense", "2026-11-15")).toBeNull();
  });
});
