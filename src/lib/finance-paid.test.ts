import { describe, expect, it } from "vitest";
import { monthKey, monthsPaidFromPlan, monthsSpanned, paidMonthsFor, periodPaidInFinance } from "./finance-paid";

describe("monthsSpanned", () => {
  it("a calendar month is one month", () => {
    expect(monthsSpanned("2026-10-01", "2026-10-31")).toEqual(["2026-10"]);
  });
  it("a mid-month period touches both months", () => {
    expect(monthsSpanned("2026-09-20", "2026-10-19")).toEqual(["2026-09", "2026-10"]);
  });
  it("crosses a year", () => {
    expect(monthsSpanned("2026-11-15", "2027-02-14")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
  it("a single day", () => {
    expect(monthsSpanned("2026-03-31", "2026-03-31")).toEqual(["2026-03"]);
  });
  it("an inverted range spans nothing", () => {
    expect(monthsSpanned("2026-10-01", "2026-09-30")).toEqual([]);
  });
});

describe("periodPaidInFinance", () => {
  const rows = [
    { client_id: "a", year: 2026, month: 9, paid: true },
    { client_id: "a", year: 2026, month: 10, paid: true },
    { client_id: "a", year: 2026, month: 11, paid: false },
    { client_id: "b", year: 2026, month: 11, paid: true },
  ];
  const a = paidMonthsFor(rows, "a");

  it("keys months the same way", () => {
    expect(monthKey(2026, 9)).toBe("2026-09");
    expect([...a].sort()).toEqual(["2026-09", "2026-10"]);
  });
  it("paid when every month the period touches is paid", () => {
    expect(periodPaidInFinance({ dateFrom: "2026-09-20", dateTo: "2026-10-19" }, a)).toBe(true);
  });
  it("not paid when one month is unpaid on the Plan", () => {
    expect(periodPaidInFinance({ dateFrom: "2026-10-20", dateTo: "2026-11-19" }, a)).toBe(false);
  });
  it("not paid when a month has no Plan row at all", () => {
    expect(periodPaidInFinance({ dateFrom: "2026-08-20", dateTo: "2026-09-19" }, a)).toBe(false);
  });
  it("another client's paid month doesn't count", () => {
    expect(periodPaidInFinance({ dateFrom: "2026-11-01", dateTo: "2026-11-30" }, a)).toBe(false);
    expect(periodPaidInFinance({ dateFrom: "2026-11-01", dateTo: "2026-11-30" }, paidMonthsFor(rows, "b"))).toBe(true);
  });
  it("an inverted period is never paid", () => {
    expect(periodPaidInFinance({ dateFrom: "2026-10-31", dateTo: "2026-10-01" }, a)).toBe(false);
  });
});

describe("monthsPaidFromPlan", () => {
  const clients = [
    { id: "v", name: "Visitt" },
    { id: "o", name: "Other" },
  ];
  const row = (over: Partial<import("./finance-paid").PlanMonthRow>) => ({
    client_id: null,
    client_canon: "Visitt",
    year: 2026,
    month: 10,
    paid_at: "2026-11-09T12:00:00Z",
    ...over,
  });

  it("matches by name when the row has no client id", () => {
    expect(monthsPaidFromPlan([row({})], clients)).toEqual([{ client_id: "v", year: 2026, month: 10, paid: true }]);
  });
  it("matches by client id even when the name differs", () => {
    expect(monthsPaidFromPlan([row({ client_id: "o", client_canon: "Other Ltd" })], clients)).toEqual([
      { client_id: "o", year: 2026, month: 10, paid: true },
    ]);
  });
  it("a month is paid only when every sub-account row is", () => {
    const out = monthsPaidFromPlan([row({}), row({ paid_at: null })], clients);
    expect(out).toEqual([{ client_id: "v", year: 2026, month: 10, paid: false }]);
  });
  it("a row matching by id and by name counts once", () => {
    expect(monthsPaidFromPlan([row({ client_id: "v" })], clients)).toHaveLength(1);
  });
  it("feeds periodPaidInFinance: Oct (21 Sep – 20 Oct) paid once Sep and Oct are", () => {
    const rows = monthsPaidFromPlan([row({ month: 9 }), row({ month: 10 }), row({ month: 11, paid_at: null })], clients);
    const paid = paidMonthsFor(rows, "v");
    expect(periodPaidInFinance({ dateFrom: "2026-09-21", dateTo: "2026-10-20" }, paid)).toBe(true);
    expect(periodPaidInFinance({ dateFrom: "2026-10-21", dateTo: "2026-11-19" }, paid)).toBe(false);
  });
  it("a row of an unknown client is dropped", () => {
    expect(monthsPaidFromPlan([row({ client_canon: "Nobody" })], clients)).toEqual([]);
  });
});
