import { describe, expect, it } from "vitest";
import { availableDays, balanceAsOf, fitRequest, formatDays, plannedVacation, workdays, type VacationRequest } from "./vacation";
import type { DayState } from "./types";

const holidays: DayState[] = [{ id: "h", dateFrom: "2026-10-14", dateTo: "2026-10-14", label: "Holiday" }];

const req = (startDate: string, endDate: string, status: VacationRequest["status"], id = startDate): VacationRequest => ({
  id,
  profileId: "p",
  startDate,
  endDate,
  days: 0,
  message: "",
  status,
  decidedAt: null,
  decisionNote: null,
  createdAt: "",
});

describe("workdays", () => {
  it("counts Sun–Thu only, holidays out", () => {
    // Sun 11 Oct – Sat 17 Oct 2026: Sun–Thu is 5 days, less the holiday on Wed 14.
    expect(workdays("2026-10-11", "2026-10-17", holidays)).toEqual(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-15"]);
  });

  it("is empty for a weekend or a backwards range", () => {
    expect(workdays("2026-10-16", "2026-10-17", [])).toEqual([]);
    expect(workdays("2026-10-15", "2026-10-11", [])).toEqual([]);
  });
});

describe("availableDays", () => {
  const sep = { year: 2026, month: 9, balance: 10, accrued: 1 };
  const oct13 = new Date(2026, 9, 13);

  it("knows a payslip's balance runs to the end of its month", () => {
    expect(balanceAsOf(sep)).toBe("2026-09-30");
  });

  it("adds October's credit and takes off what's approved or waiting since", () => {
    const a = availableDays(
      sep,
      [
        req("2026-09-20", "2026-09-21", "approved"), // already on the payslip
        req("2026-10-11", "2026-10-12", "approved"), // 2 days
        req("2026-10-18", "2026-10-18", "pending"), // 1 day
        req("2026-10-19", "2026-10-20", "declined"),
      ],
      [],
      undefined,
      oct13,
    );
    // 10 + 1 (October) − 3
    expect(a).toEqual({ balance: 10, monthly: 1, approved: 2, pending: 1, available: 8 });
  });

  it("counts only the part of a request after the payslip's month", () => {
    // Tue 29 Sep – Thu 1 Oct: only Oct 1 is after September's payslip.
    expect(availableDays(sep, [req("2026-09-29", "2026-10-01", "approved")], [], undefined, oct13).approved).toBe(1);
  });

  it("leaves out the request being decided", () => {
    expect(availableDays(sep, [req("2026-10-18", "2026-10-18", "pending", "x")], [], "x", oct13).available).toBe(11);
  });

  it("never offers this month what a later month already needs", () => {
    // 0 on the payslip; November's 2 days are booked, so October has nothing spare.
    const aki = { year: 2026, month: 9, balance: 0, accrued: 1 };
    expect(availableDays(aki, [req("2026-11-01", "2026-11-02", "approved")], [], undefined, oct13).available).toBe(0);
  });
});

describe("vacation already in the plan", () => {
  const sep = { year: 2026, month: 9, balance: 10, accrued: 1 };
  const oct13 = new Date(2026, 9, 13);

  it("counts days typed into the plan, once even when a request made them", () => {
    // 18–20 Oct typed into the plan before requests existed; 20 Oct also approved.
    const planned = ["2026-10-18", "2026-10-19", "2026-10-20"];
    const a = availableDays(sep, [req("2026-10-20", "2026-10-20", "approved")], [], undefined, oct13, planned);
    expect(a).toMatchObject({ approved: 3, available: 8 });
  });

  it("reads them from the person's own column only", () => {
    const columns = [
      { id: "c1", profileId: "p", type: "member" },
      { id: "c2", profileId: "q", type: "member" },
    ];
    const entries = [
      { columnId: "c1", date: "2026-10-18", type: "absence", absenceType: "vacation" },
      { columnId: "c1", date: "2026-10-21", type: "absence", absenceType: "sick" },
      { columnId: "c2", date: "2026-10-19", type: "absence", absenceType: "vacation" },
    ];
    expect(plannedVacation("p", columns, entries)).toEqual(["2026-10-18"]);
  });
});

describe("fitRequest", () => {
  // Aki: 0 on September's payslip, a day a month on a full position.
  const aki = { year: 2026, month: 9, balance: 0, accrued: 1 };
  const oct13 = new Date(2026, 9, 13);

  it("has a day by October and two by November", () => {
    expect(fitRequest(aki, [], [], ["2026-10-15"], undefined, oct13)).toMatchObject({ ok: true, leftAfter: 0 });
    expect(fitRequest(aki, [], [], ["2026-11-01", "2026-11-02"], undefined, oct13)).toMatchObject({ ok: true, leftAfter: 0 });
    expect(fitRequest(aki, [], [], ["2026-10-14", "2026-10-15"], undefined, oct13)).toMatchObject({
      ok: false,
      short: { month: "2026-10", by: 1 },
    });
  });

  it("counts earlier bookings against a later month", () => {
    // October's day is taken, so November has only its own day left.
    const f = fitRequest(aki, [req("2026-10-15", "2026-10-15", "approved")], [], ["2026-11-01", "2026-11-02"], undefined, oct13);
    expect(f).toMatchObject({ ok: false, short: { month: "2026-11", by: 1 } });
  });
});

describe("formatDays", () => {
  it("shows days to one decimal", () => {
    expect(formatDays(9.55)).toBe("9.6");
    expect(formatDays(10)).toBe("10");
    expect(formatDays(-2.6)).toBe("−2.6");
  });
});
