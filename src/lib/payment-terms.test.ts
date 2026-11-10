import { describe, expect, it } from "vitest";
import { DEFAULT_PAYMENT_TERMS_DAYS, invoiceDateFor, paymentDueFor, termsToStore } from "./payment-terms";

describe("paymentDueFor", () => {
  it("counts the terms from the invoice day — the day after the period ends", () => {
    // NoTraffic: period 15 Sep – 14 Oct, invoiced the 15th, 14 days → 29 Oct
    expect(invoiceDateFor("2026-10-14")).toBe("2026-10-15");
    expect(paymentDueFor("2026-10-14", 14)).toBe("2026-10-29");
  });

  it("uses the client's own terms", () => {
    // Maccabi: period ends the 19th, invoiced the 20th, net+30 → 19 Nov
    expect(paymentDueFor("2026-10-19", 30)).toBe("2026-11-19");
  });

  it("defaults to the studio's 14 days", () => {
    expect(DEFAULT_PAYMENT_TERMS_DAYS).toBe(14);
    expect(paymentDueFor("2026-10-31")).toBe("2026-11-15");
  });

  it("crosses month ends and the clock change by calendar day", () => {
    expect(paymentDueFor("2026-10-24", 14)).toBe("2026-11-08");
    expect(paymentDueFor("2026-03-26", 1)).toBe("2026-03-28");
  });
});

describe("termsToStore", () => {
  it("accepts whole days, with or without the words around them", () => {
    expect(termsToStore("30")).toBe(30);
    expect(termsToStore(" 14 ")).toBe(14);
    expect(termsToStore("30 days")).toBe(30);
    expect(termsToStore("net+30")).toBe(30);
    expect(termsToStore("Net 45")).toBe(45);
    expect(termsToStore("0")).toBe(0);
  });

  it("refuses anything else rather than guessing", () => {
    expect(termsToStore("")).toBeNull();
    expect(termsToStore("-5")).toBeNull();
    expect(termsToStore("14.5")).toBeNull();
    expect(termsToStore("two weeks")).toBeNull();
    expect(termsToStore("181")).toBeNull();
  });
});
