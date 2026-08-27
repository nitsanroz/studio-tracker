import { describe, expect, it } from "vitest";
import { nextInvoiceDate, nextPeriod, parseInvoiceDay, periodLabel } from "./billing-rollover";

describe("nextInvoiceDate", () => {
  it("finds the invoice day inside the same month", () => {
    expect(nextInvoiceDate("2026-09-05", 15)).toBe("2026-09-15");
  });

  it("takes the day itself when `from` already lands on it", () => {
    expect(nextInvoiceDate("2026-09-15", 15)).toBe("2026-09-15");
  });

  it("rolls into next month once the day has passed", () => {
    expect(nextInvoiceDate("2026-09-20", 15)).toBe("2026-10-15");
  });

  it("clamps an invoice day of 31 to the length of the month", () => {
    // ⚠️ `new Date(2026, 1, 31)` silently becomes 3 March. Left unclamped, every
    // period after a short month would be shifted by those extra days.
    expect(nextInvoiceDate("2026-02-01", 31)).toBe("2026-02-28");
    expect(nextInvoiceDate("2026-04-01", 31)).toBe("2026-04-30");
  });

  it("handles a February in a leap year", () => {
    expect(nextInvoiceDate("2028-02-01", 31)).toBe("2028-02-29");
  });

  it("crosses a year boundary", () => {
    expect(nextInvoiceDate("2026-12-20", 5)).toBe("2027-01-05");
  });
});

describe("nextPeriod", () => {
  const today = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  it("returns null while the last period is still running", () => {
    // ⚠️ Two open periods would split a week's hours across both.
    expect(nextPeriod({ dateFrom: "2026-08-01", dateTo: "2026-08-31" }, 1, today("2026-08-27"))).toBe(
      null,
    );
  });

  it("returns null on the last period's final day", () => {
    expect(nextPeriod({ dateFrom: "2026-08-01", dateTo: "2026-08-31" }, 1, today("2026-08-31"))).toBe(
      null,
    );
  });

  it("starts the day after the last period ended", () => {
    const p = nextPeriod({ dateFrom: "2026-08-01", dateTo: "2026-08-31" }, null, today("2026-09-01"));
    expect(p?.dateFrom).toBe("2026-09-01");
  });

  it("runs a calendar month when there is no invoice day", () => {
    const p = nextPeriod({ dateFrom: "2026-08-01", dateTo: "2026-08-31" }, null, today("2026-09-01"));
    expect(p).toEqual({ label: "September 2026", dateFrom: "2026-09-01", dateTo: "2026-09-30" });
  });

  it("aligns to the invoice day when the client has one", () => {
    // Last period ended on the 4th, invoice day is the 5th → the new period runs
    // 5 Sep to 4 Oct, so it lines up with what gets invoiced.
    const p = nextPeriod({ dateFrom: "2026-08-05", dateTo: "2026-09-04" }, 5, today("2026-09-05"));
    expect(p?.dateFrom).toBe("2026-09-05");
    expect(p?.dateTo).toBe("2026-10-04");
  });

  it("recovers a drifted period back onto the invoice day", () => {
    // A hand-edited period ended mid-month; the next one should end the day before
    // the invoice day rather than perpetuate the drift.
    const p = nextPeriod({ dateFrom: "2026-07-01", dateTo: "2026-08-09" }, 1, today("2026-08-27"));
    expect(p?.dateFrom).toBe("2026-08-10");
    expect(p?.dateTo).toBe("2026-08-31");
  });

  it("creates only ONE period even when the last ended long ago", () => {
    // ⚠️ Deliberate: silently backfilling six periods into a client's report is not
    // something to do unasked. The caller can run again tomorrow.
    const p = nextPeriod({ dateFrom: "2026-01-01", dateTo: "2026-01-31" }, 1, today("2026-08-27"));
    expect(p?.dateFrom).toBe("2026-02-01");
    expect(p?.dateTo).toBe("2026-02-28");
  });

  it("does not choke on an out-of-range invoice day", () => {
    for (const bad of [0, 32, -1, 99]) {
      const p = nextPeriod({ dateFrom: "2026-08-01", dateTo: "2026-08-31" }, bad, today("2026-09-01"));
      expect(p?.dateTo).toBe("2026-09-30"); // falls back to a calendar month
    }
  });

  it("crosses a year boundary", () => {
    const p = nextPeriod({ dateFrom: "2026-11-01", dateTo: "2026-12-31" }, 1, today("2027-01-02"));
    expect(p).toEqual({ label: "January 2027", dateFrom: "2027-01-01", dateTo: "2027-01-31" });
  });

  it("survives a period ending on 31 January with invoice day 31", () => {
    const p = nextPeriod({ dateFrom: "2026-01-01", dateTo: "2026-01-30" }, 31, today("2026-03-01"));
    expect(p?.dateFrom).toBe("2026-01-31");
    // Next 31st on or after 31 Jan is 31 Jan itself, so the cycle runs a month.
    expect(p?.dateTo).toBe("2026-02-27");
  });
});

describe("periodLabel", () => {
  it("names a whole calendar month after the month", () => {
    expect(periodLabel("2026-09-01", "2026-09-30")).toBe("September 2026");
    expect(periodLabel("2026-02-01", "2026-02-28")).toBe("February 2026");
  });

  it("shows a range when the period straddles two months", () => {
    expect(periodLabel("2026-09-05", "2026-10-04")).toBe("5/9 → 4/10");
  });

  it("does not call a partial month by the month's name", () => {
    expect(periodLabel("2026-09-01", "2026-09-15")).toBe("1/9 → 15/9");
  });
});

describe("parseInvoiceDay", () => {
  it("reads the ordinals actually in the data", () => {
    // The three clients using this field today: Anchor, Visitt, Baseline.
    expect(parseInvoiceDay("20th")).toBe(20);
    expect(parseInvoiceDay("1st")).toBe(1);
  });

  it("reads a bare number and a fuller phrase", () => {
    expect(parseInvoiceDay("5")).toBe(5);
    expect(parseInvoiceDay("15th of the month")).toBe(15);
    expect(parseInvoiceDay(" 28 ")).toBe(28);
  });

  it("returns null for anything it cannot read, so the fallback is a calendar month", () => {
    // ⚠️ Never a guess: a boundary nobody chose is worse than no alignment.
    for (const v of ["", "   ", "end of month", "on delivery", "when invoiced", null, undefined]) {
      expect(parseInvoiceDay(v)).toBe(null);
    }
  });

  it("refuses a number that is not a day of the month", () => {
    for (const v of ["45", "0", "2026", "99th"]) expect(parseInvoiceDay(v)).toBe(null);
  });

  it("refuses PAYMENT TERMS, which are the dangerous case", () => {
    // ⚠️⚠️ This field was a free-text note for four years before it meant
    // anything, so it can hold anything anyone typed about invoicing. Every one of
    // these carries a number in 1–31 and NONE of them names a day of the month —
    // read as one, they silently re-align a client's billing periods.
    for (const v of [
      "Net 30",
      "net 14",
      "30 days from invoice",
      "15 days EOM",
      "within 7 days",
      "2 weeks after delivery",
      "PO 12345 required",
    ]) {
      expect(parseInvoiceDay(v)).toBe(null);
    }
  });

  it("accepts a day whether it is bare or ordinal, anywhere in the phrase", () => {
    expect(parseInvoiceDay("the 5th of each month")).toBe(5);
    expect(parseInvoiceDay("22nd")).toBe(22);
    expect(parseInvoiceDay("3rd")).toBe(3);
  });
});
