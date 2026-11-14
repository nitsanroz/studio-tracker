import { describe, expect, it } from "vitest";
import { amountDraftOf, amountFieldsOf, vatShapeOf, type AmountDraft } from "./amount-vat";
import type { ExpenseRowDb } from "./db";
import { buildFxTable } from "./fx";

const DATE = "2026-03-10"; // 18% VAT year
const fx = buildFxTable([{ year: 2026, month: 3, usd_ils: 3.165, eur_ils: 3.6 }]);
const draft = (p: Partial<AmountDraft>): AmountDraft => ({ amount: "", currency: "ILS", withVat: true, ...p });

const row = (p: Partial<ExpenseRowDb>): ExpenseRowDb =>
  ({
    id: "x",
    date: DATE,
    end_date: null,
    category: "misc",
    vendor: "",
    description: "",
    amount_gross: 118,
    amount_no_vat: 100,
    currency: "ILS",
    vat_included: true,
    renew_months: null,
    recurrence: "one_off",
    link: null,
    notes: "",
    state: "actual",
    ...p,
  }) as ExpenseRowDb;

describe("amountFieldsOf — one With VAT / Without VAT switch", () => {
  it("with VAT → 18% comes off", () => {
    expect(amountFieldsOf(draft({ amount: "118", withVat: true }), DATE, fx)).toEqual({
      amount_gross: 118, amount_no_vat: 100, currency: "ILS", vat_included: true,
    });
  });

  it("without VAT → counted as typed", () => {
    expect(amountFieldsOf(draft({ amount: "55", withVat: false }), DATE, fx)).toEqual({
      amount_gross: 55, amount_no_vat: 55, currency: "ILS", vat_included: false,
    });
  });

  it("foreign currency → never VAT, converted at the month's rate whatever the switch says", () => {
    const f = amountFieldsOf(draft({ amount: "100", currency: "USD", withVat: true }), DATE, fx);
    expect(f?.vat_included).toBe(false);
    expect(f?.amount_no_vat).toBe(Math.round(100 * 3.165 * 1.05 * 100) / 100);
  });

  it("refuses an empty or non-positive amount", () => {
    expect(amountFieldsOf(draft({ amount: "" }), DATE, fx)).toBeNull();
    expect(amountFieldsOf(draft({ amount: "0" }), DATE, fx)).toBeNull();
    expect(amountFieldsOf(draft({ amount: "abc" }), DATE, fx)).toBeNull();
  });
});

describe("reading a stored row back", () => {
  it("recognises each stored shape", () => {
    expect(vatShapeOf(row({ amount_gross: 118, amount_no_vat: 100 }))).toBe("incl");
    expect(vatShapeOf(row({ amount_gross: 55, amount_no_vat: 55, vat_included: false }))).toBe("none");
    expect(vatShapeOf(row({ amount_gross: 182.4, amount_no_vat: 182.4 }))).toBe("none");
    expect(vatShapeOf(row({ amount_gross: 251.49, amount_no_vat: 241.94 }))).toBe("mixed");
  });

  it("an existing mixed receipt opens as its net, without VAT — saving keeps the net", () => {
    const r = row({ amount_gross: 251.49, amount_no_vat: 241.94 });
    const d = amountDraftOf(r);
    expect(d).toEqual({ amount: "241.94", currency: "ILS", withVat: false });
    expect(amountFieldsOf(d, r.date, fx)?.amount_no_vat).toBe(241.94);
  });

  it("a with-VAT row round-trips unchanged", () => {
    const r = row({ amount_gross: 118, amount_no_vat: 100 });
    expect(amountFieldsOf(amountDraftOf(r), r.date, fx)?.amount_no_vat).toBe(100);
  });
});
