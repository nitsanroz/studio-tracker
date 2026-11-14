import { describe, expect, it } from "vitest";
import { invoiceDueFor, parseInvoiceDay, paymentDue, termsFromClientRow, termsLabel } from "./payment-terms";

describe("paymentDue", () => {
  it("N days after the invoice", () => {
    expect(paymentDue("2026-10-15", { days: 14, net: false })).toBe("2026-10-29");
    expect(paymentDue("2026-10-20T09:00:00Z", { days: 14, net: false })).toBe("2026-11-03");
    expect(paymentDue("2026-10-24")).toBe("2026-11-07");
  });

  it("net+30: Maccabi's 20 Oct invoice is paid in the run by 5 Dec", () => {
    expect(paymentDue("2026-10-20", { days: 30, net: true })).toBe("2026-12-05");
    expect(paymentDue("2026-01-31", { days: 30, net: true })).toBe("2026-03-05");
    expect(paymentDue("2026-12-01", { days: 30, net: true })).toBe("2027-02-05");
  });
});

describe("invoiceDueFor", () => {
  it("the client's invoice day in the month after", () => {
    expect(invoiceDueFor(2026, 10, { invoiceDay: 15 })).toBe("2026-11-15"); // NoTraffic
    expect(invoiceDueFor(2026, 10, { invoiceDay: 20 })).toBe("2026-11-20"); // Maccabi, Visitt
    expect(invoiceDueFor(2026, 10, { invoiceDay: null })).toBe("2026-11-01");
    expect(invoiceDueFor(2026, 12, { invoiceDay: 1 })).toBe("2027-01-01");
  });

  it("clamps a late day to a short month", () => {
    expect(invoiceDueFor(2026, 1, { invoiceDay: 31 })).toBe("2026-02-28");
  });
});

describe("parseInvoiceDay / termsFromClientRow", () => {
  it("reads a day, never terms", () => {
    expect(parseInvoiceDay("20th")).toBe(20);
    expect(parseInvoiceDay("1")).toBe(1);
    expect(parseInvoiceDay("15")).toBe(15);
    expect(parseInvoiceDay("Net 30")).toBeNull();
    expect(parseInvoiceDay("30 days from invoice")).toBeNull();
    expect(parseInvoiceDay("")).toBeNull();
    expect(parseInvoiceDay(null)).toBeNull();
  });

  it("defaults what a row doesn't have", () => {
    expect(termsFromClientRow({})).toEqual({ days: 14, net: false, invoiceDay: null });
    expect(termsFromClientRow({ payment_terms_days: 30, payment_terms_net: true, invoice_note: "20" })).toEqual({ days: 30, net: true, invoiceDay: 20 });
  });

  it("labels", () => {
    expect(termsLabel({ days: 14, net: false })).toBe("14-day");
    expect(termsLabel({ days: 30, net: true })).toBe("Net+30");
  });
});
