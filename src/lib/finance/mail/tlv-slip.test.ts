import { describe, expect, it } from "vitest";
import { slipCode, slipFrom, slipMonths } from "./tlv-slip";
import { suggestions, type ExpenseLite, type Receipt } from "./receipts";

// The shape of tel-aviv.digitalnow.co.il's taiGetClientJson answer (2026-11-09), names and numbers trimmed.
const ANSWER = {
  clientEmail: "office@example.com",
  invoices: [
    {
      clientName: "—",
      pdfName: "1029893641.pdf",
      invoiceDetails: { invoicePeriodType: "periodic" },
      accountingDetails: { voucherNumber: "1029893641", lastUpdatedDate: "19.10.2026" },
      paymentDetails: {
        paymentDate: "החשבון יוצג לחברת האשראי בסוף חודש נובמבר",
        totalPaymentAmount: "7,062.50",
        payments: [
          { paymentPeriod: "31.12.26-01.11.26", paymentPeriodDays: 61, paymentAmount: "7,007.72" },
          { paymentPeriod: "31.12.26-01.11.26", paymentPeriodDays: 61, paymentAmount: "54.78" },
        ],
      },
    },
  ],
};

describe("Tel Aviv's arnona slip", () => {
  it("knows its link and reads the total, months and voucher", () => {
    expect(slipCode("https://tel-aviv.digitalnow.co.il/?uuid=abc-123")).toBe("abc-123");
    expect(slipCode("https://example.com/?uuid=abc")).toBeNull();
    expect(slipMonths("31.12.26-01.11.26")).toEqual(["2026-11", "2026-12"]);
    expect(slipFrom(ANSWER)).toEqual({ amount: 7062.5, months: ["2026-11", "2026-12"], voucher: "1029893641", byCard: true, pdfName: "1029893641.pdf" });
    expect(slipFrom({ invoices: [] })).toBeNull();
  });

  it("Nov–Dec's ₪7,062.50 is ₪3,531.25 a month on the grid (no VAT)", () => {
    const cell = (m: string, gross: number, state: string): ExpenseLite => ({ id: m, date: `${m}-15`, endDate: null, category: "rent", vendor: "ארנונה", description: "", currency: "ILS", gross, renewMonths: null, state });
    const r: Receipt = { id: "s", vendor: null, suggestedVendor: "", sender: '"ארנונה - עיריית תל-אביב-יפו" <a@tel-aviv.gov.il>', domain: "tel-aviv.gov.il", date: "2026-11-01", subject: "תלוש הארנונה שלך", account: "office@studionmore.com", amount: 7062.5, currency: "ILS", itemDescription: "ארנונה 11/2026-12/2026" };
    const [s] = suggestions([r], [cell("2026-09", 3498.13, "final"), cell("2026-10", 3498.13, "final"), cell("2026-11", 3500, "predicted"), cell("2026-12", 3500, "predicted")]);
    expect(s).toMatchObject({ rentLine: "ארנונה", rentMonths: ["2026-11", "2026-12"], rentVat: false, rentNow: [3500, 3500] });
    expect(s.amount! / 2).toBe(3531.25);
  });
});
