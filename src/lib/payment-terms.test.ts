import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAYMENT_TERMS_DAYS,
  invoiceDateFor,
  invoiceDueFor,
  termsAdjective,
  termsFromClientRow,
  paymentDue,
  paymentDueFor,
  termsLabel,
  termsToStore,
} from "./payment-terms";

const days = (n: number) => ({ days: n, net: false });
const net = (n: number) => ({ days: n, net: true });

describe("paymentDueFor — N days", () => {
  it("counts the terms from the invoice day — the day after the period ends", () => {
    // NoTraffic: period 15 Sep – 14 Oct, invoiced the 15th, 14 days → 29 Oct
    expect(invoiceDateFor("2026-10-14")).toBe("2026-10-15");
    expect(paymentDueFor("2026-10-14", days(14))).toBe("2026-10-29");
  });

  it("defaults to the studio's 14 days", () => {
    expect(DEFAULT_PAYMENT_TERMS_DAYS).toBe(14);
    expect(paymentDueFor("2026-10-31")).toBe("2026-11-15");
  });

  it("crosses month ends and the clock change by calendar day", () => {
    expect(paymentDueFor("2026-10-24", days(14))).toBe("2026-11-08");
    expect(paymentDueFor("2026-03-26", days(1))).toBe("2026-03-28");
  });
});

describe("paymentDue — net+N", () => {
  it("Maccabi's net+30: invoiced 20 Oct, paid in the run by 5 Dec (40–45 days)", () => {
    expect(paymentDue("2026-10-20", net(30))).toBe("2026-12-05");
    expect(paymentDueFor("2026-10-19", net(30))).toBe("2026-12-05");
  });

  it("counts months, so a short February doesn't push it a month late", () => {
    expect(paymentDue("2026-01-31", net(30))).toBe("2026-03-05");
    expect(paymentDue("2026-02-20", net(30))).toBe("2026-04-05");
  });

  it("net+0 is the next run, net+60 two months further, across the year end", () => {
    expect(paymentDue("2026-10-20", net(0))).toBe("2026-11-05");
    expect(paymentDue("2026-10-20", net(60))).toBe("2027-01-05");
    expect(paymentDue("2026-12-01", net(30))).toBe("2027-02-05");
  });
});

describe("termsLabel / termsToStore", () => {
  it("writes them the way they're said", () => {
    expect(termsLabel(days(14))).toBe("14 days");
    expect(termsLabel(net(30))).toBe("Net+30");
  });

  it("accepts days with or without the word", () => {
    expect(termsToStore("30")).toEqual(days(30));
    expect(termsToStore(" 14 ")).toEqual(days(14));
    expect(termsToStore("30 days")).toEqual(days(30));
    expect(termsToStore("0")).toEqual(days(0));
  });

  it("reads net terms in English and Hebrew", () => {
    expect(termsToStore("net+30")).toEqual(net(30));
    expect(termsToStore("Net 45")).toEqual(net(45));
    expect(termsToStore("NET30")).toEqual(net(30));
    expect(termsToStore("שוטף+30")).toEqual(net(30));
    expect(termsToStore("שוטף 60")).toEqual(net(60));
  });

  it("refuses anything else rather than guessing", () => {
    expect(termsToStore("")).toBeNull();
    expect(termsToStore("-5")).toBeNull();
    expect(termsToStore("14.5")).toBeNull();
    expect(termsToStore("two weeks")).toBeNull();
    expect(termsToStore("181")).toBeNull();
    expect(termsToStore("net")).toBeNull();
  });
});

// From finance-admin's own test file, which tested its mirror of this module.
describe("what finance reads on top", () => {
  it("takes a timestamp as well as a date", () => {
    expect(paymentDue("2026-10-20T09:00:00Z", { days: 14, net: false })).toBe("2026-11-03");
  });

  it("invoiceDueFor: the client's invoice day in the month after", () => {
    expect(invoiceDueFor(2026, 10, { invoiceDay: 15 })).toBe("2026-11-15"); // NoTraffic
    expect(invoiceDueFor(2026, 10, { invoiceDay: 20 })).toBe("2026-11-20"); // Maccabi, Visitt
    expect(invoiceDueFor(2026, 10, { invoiceDay: null })).toBe("2026-11-01");
    expect(invoiceDueFor(2026, 12, { invoiceDay: 1 })).toBe("2027-01-01");
  });

  it("invoiceDueFor clamps a late day to a short month", () => {
    expect(invoiceDueFor(2026, 1, { invoiceDay: 31 })).toBe("2026-02-28");
  });

  it("termsFromClientRow defaults what a row doesn't have", () => {
    expect(termsFromClientRow({})).toEqual({ days: 14, net: false, invoiceDay: null });
    expect(termsFromClientRow({ payment_terms_days: 30, payment_terms_net: true, invoice_note: "20" })).toEqual({ days: 30, net: true, invoiceDay: 20 });
    // a note about terms is not a day
    expect(termsFromClientRow({ invoice_note: "Net 30" }).invoiceDay).toBeNull();
  });

  it("termsAdjective reads in a sentence", () => {
    expect(termsAdjective({ days: 14, net: false })).toBe("14-day");
    expect(termsAdjective({ days: 30, net: true })).toBe("Net+30");
  });
});
