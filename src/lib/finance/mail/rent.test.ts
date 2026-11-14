import { describe, expect, it } from "vitest";
import { isPaymentNotice, monthsHolding, monthsPaid, periodIn, rentLineOf, rentMonthsFor, rentNet, periodPair, rentQuery, rentSince, RENT_SOURCES, splitBill } from "./rent";
import { receiptAmount, receiptDescription, rtlPdfTotal } from "./receipts";
import { suggestions, type ExpenseLite, type Receipt } from "./receipts";

const LINES = ["שכירות", "חשמל", "ארנונה", "מים", "פרטנר", "ועד בית", "מנקה", "ביטוח סטודיו"];
const src = (line: string) => RENT_SOURCES.find((s) => s.line === line)!;

describe("rentLineOf", () => {
  it("knows the studio's bills by sender or by subject", () => {
    expect(rentLineOf({ domain: "aluel.co.il", subject: "(מסמך ממוחשב) הדפסת חשבונית מרכזת - SI266000087" }, LINES)?.line).toBe("שכירות");
    expect(rentLineOf({ domain: "iec.co.il", subject: "חשבון החשמל שלך מוכן" }, LINES)?.line).toBe("חשמל");
    expect(rentLineOf({ domain: "gmail.com", subject: "הודעת תשלום ארנונה" }, LINES)?.line).toBe("ארנונה");
    expect(rentLineOf({ domain: "idan-shani.co.il", subject: "אישור תשלום מס'98336 - עבור דמי וועד בבניין ניצנה 11 , תל אביב" }, LINES)?.line).toBe("ועד בית");
  });

  it("never the owner's home building, nor a non-bill from a known sender", () => {
    expect(rentLineOf({ domain: "apoint.co.il", subject: "אישור תשלום מס'242936 - עבור דמי וועד בבניין ניצנה 20 , תל אביב" }, LINES)).toBeNull();
    expect(rentLineOf({ domain: "aluel.co.il", subject: "FW: פרוטוקול אסיפת בעלי נכסים - ניצנה 11" }, LINES)).toBeNull();
  });

  it("a sender the owner filed under a Rent line before", () => {
    expect(rentLineOf({ domain: "bezeq.co.il", subject: "your monthly statement", key: "bezeq.co.il" }, LINES, { "bezeq.co.il": "פרטנר" })?.line).toBe("פרטנר");
  });
});

describe("months", () => {
  const pairs = (line: string, starts: number[], amount = 500) =>
    starts.flatMap((m) => [
      { date: `2026-${String(m).padStart(2, "0")}-15`, gross: amount + m },
      { date: `2026-${String(m + 1).padStart(2, "0")}-15`, gross: amount + m },
    ]);

  it("a period named in the subject wins", () => {
    expect(periodIn("חשבון חשמל לתקופה 01/07/2026 - 31/08/2026")).toEqual(["2026-07", "2026-08"]);
    expect(periodIn("ארנונה 11/2026-12/2026")).toEqual(["2026-11", "2026-12"]);
    expect(periodIn("no period")).toBeNull();
  });

  it("rent is its own month; a two-month bill takes the line's pair", () => {
    expect(rentMonthsFor(src("שכירות"), "2026-10-19", "חשבונית מרכזת")).toEqual(["2026-10"]);
    // Electricity pairs Jan–Feb, Mar–Apr…: a September bill is for July–August.
    expect(rentMonthsFor(src("חשמל"), "2026-09-10", "חשבון חשמל", pairs("חשמל", [1, 3, 5]))).toEqual(["2026-07", "2026-08"]);
    // Arnona is billed ahead: a September bill is September–October.
    expect(rentMonthsFor(src("ארנונה"), "2026-09-03", "ארנונה", pairs("ארנונה", [1, 3, 5]))).toEqual(["2026-09", "2026-10"]);
    // Water pairs Feb–Mar, Apr–May…: an October bill is for the pair before October–November.
    expect(rentMonthsFor(src("מים"), "2026-10-05", "חשבון מים", pairs("מים", [2, 4, 6]))).toEqual(["2026-08", "2026-09"]);
  });

  it("looks back to the start of the year, or further in its first months", () => {
    expect(rentSince(Date.UTC(2026, 10, 9), 120).toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(rentSince(Date.UTC(2027, 0, 20), 120).toISOString().slice(0, 10)).toBe("2026-09-22");
  });

  it("splits a bill, the last month carrying the rounding", () => {
    expect(splitBill(1000.01, 2)).toEqual([500.01, 500]);
    expect(splitBill(15360, 1)).toEqual([15360]);
  });
});

describe("suggestions — Rent bills", () => {
  let n = 0;
  const rec = (domain: string, subject: string, date: string, amount: number | null): Receipt => ({
    id: `m${++n}`,
    vendor: null,
    suggestedVendor: domain,
    sender: `x <a@${domain}>`,
    domain,
    date,
    subject,
    account: "office@studionmore.com",
    amount,
    currency: "ILS",
  });
  const cell = (line: string, month: string, gross: number, state = "actual"): ExpenseLite => ({
    id: `c${++n}`,
    date: `${month}-15`,
    endDate: null,
    category: "rent",
    vendor: line,
    description: "",
    currency: "ILS",
    gross,
    renewMonths: null,
    state,
  });

  it("a bill for planned cells is suggested as Rent, with its line and months", () => {
    const rows = [cell("חשמל ", "2026-07", 500, "predicted"), cell("חשמל ", "2026-08", 500, "predicted"), cell("חשמל ", "2026-05", 390), cell("חשמל ", "2026-06", 390)];
    const [s] = suggestions([rec("iec.co.il", "חשבון החשמל שלך", "2026-09-10", 1210.4)], rows);
    expect(s).toMatchObject({ category: "rent", rentLine: "חשמל", rentMonths: ["2026-07", "2026-08"], rentNow: [500, 500] });
  });

  it("a bill the grid already holds puts its files on both cells", () => {
    const jul = cell("ארנונה", "2026-09", 3498.13);
    const aug = cell("ארנונה", "2026-10", 3498.13);
    const s = suggestions([rec("tel-aviv.gov.il", "הודעת תשלום ארנונה", "2026-09-03", 6996.26)], [jul, aug, cell("ארנונה", "2026-07", 3526.71), cell("ארנונה", "2026-08", 3526.71)]);
    expect(s).toHaveLength(0);
    expect(s.attach).toEqual([{ receiptId: expect.any(String), expenseId: jul.id, date: "2026-09-03", also: [{ expenseId: aug.id, month: "2026-10" }], rent: true }]);
  });

  it("rent's VAT comes off before it's set against the grid (Aluel, October)", () => {
    expect(rentNet(18297.95, true, "2026-10")).toBe(15506.74);
    expect(rentNet(3500, false, "2026-11")).toBe(3500);
    // A final cell at another amount: suggested, flagged final, for its file only.
    const [s] = suggestions([rec("aluel.co.il", "(מסמך ממוחשב) הדפסת חשבונית מרכזת - SI266000087", "2026-10-19", 18297.95)], [cell("שכירות", "2026-10", 15360, "final")]);
    expect(s).toMatchObject({ category: "rent", rentVat: true, rentFinal: [true], rentNow: [15360] });
    // The same cell holding the net: already there — the PDF goes on it.
    const done = suggestions([rec("aluel.co.il", "(מסמך ממוחשב) הדפסת חשבונית מרכזת - SI266000087", "2026-10-19", 18297.95)], [cell("שכירות", "2026-10", 15506.74, "final")]);
    expect(done).toHaveLength(0);
    expect(done.attach).toHaveLength(1);
  });

  it("Rent cells never cover an Expenses receipt", () => {
    const s = suggestions([rec("figma.com", "Your Figma receipt", "2026-10-02", 15360)], [cell("שכירות", "2026-10", 15360)]);
    expect(s).toHaveLength(1);
    expect(s[0].category).not.toBe("rent");
  });
});

describe("v1.24.4 — water, electricity, arnona, the building fee", () => {
  it("arnona's slip is a bill; Milgam's water payment is not a second bill", () => {
    expect(rentLineOf({ domain: "tel-aviv.gov.il", subject: "תלוש הארנונה שלך" }, LINES)?.line).toBe("ארנונה");
    const water = src("מים");
    expect(isPaymentNotice(water, { domain: "milgam.co.il", subject: "אישור תשלום מי אביבים" })).toBe(true);
    expect(isPaymentNotice(water, { domain: "meiavivim.co.il", subject: "חשבון מים תקופתי - מי אביבים" })).toBe(false);
    expect(water.loginOnly).toBeTruthy();
    expect(water.vat).toBe(false);
  });

  it("an electricity bill finds the pair the sheet booked it in", () => {
    const cells = [
      { date: "2026-01-15", gross: 383.08 },
      { date: "2026-02-15", gross: 383.08 },
      { date: "2026-03-15", gross: 292.25 },
      { date: "2026-04-15", gross: 292.25 },
      { date: "2026-05-15", gross: 390.34 },
      { date: "2026-06-15", gross: 390.34 },
    ];
    // May 12: ₪904.08 with VAT → 766.17 → 383.08 each = Jan–Feb.
    expect(monthsHolding(cells, splitBill(rentNet(904.08, true, "2026-05"), 2), "2026-05-12")).toEqual(["2026-01", "2026-02"]);
    expect(monthsHolding(cells, [999, 999], "2026-05-12")).toBeNull();
  });

  it("reads Idan Shani's shekel amount with no ₪ sign", () => {
    expect(receiptAmount("שלום ניצן רוזנברג, אישור תשלום מספר 98336 סכום ששולם 199 שולם לחודש אפריל - 2026")).toEqual({ amount: 199, currency: "ILS" });
  });
});

describe("suggestions — water", () => {
  it("a Mei Avivim notice is for the pair before it: filed when booked, asks when planned", () => {
    const cells = ["02", "03", "04", "05", "06", "07", "08", "09"].map((m, i) => ({
      id: `w${i}`,
      date: `2026-${m}-15`,
      endDate: null,
      category: "rent",
      vendor: "מים",
      description: "",
      currency: "ILS",
      gross: [39.85, 39.85, 65.14, 65.14, 61.83, 61.83, 80, 80][i],
      renewMonths: null,
      state: "final",
    }));
    const r = { id: "wb", vendor: null, suggestedVendor: "מי אביבים", sender: '"מי אביבים" <noreply@meiavivim.co.il>', domain: "meiavivim.co.il", date: "2026-10-28", subject: "חשבון מים תקופתי - מי אביבים", account: "office@studionmore.com", amount: null, currency: null };
    // Aug–Sep booked: nothing to ask — the notice goes on their cells.
    const booked = suggestions([r], cells);
    expect(booked).toHaveLength(0);
    expect(booked.attach?.[0]).toMatchObject({ expenseId: "w6", also: [{ expenseId: "w7", month: "2026-09" }], rent: true });
    // Still planned: it asks for the amount, without VAT, with the bill behind the login.
    const planned = cells.map((c) => (c.date >= "2026-08" ? { ...c, state: "predicted" } : c));
    const [s] = suggestions([r], planned);
    expect(s).toMatchObject({ category: "rent", rentLine: "מים", rentMonths: ["2026-08", "2026-09"], rentVat: false });
    expect(s.rentLogin?.site).toBe("Mei Avivim");
    // Booked, but still at the plan's ₪80 (Nov–Dec planned at ₪80 too): it asks for the real amount.
    const ahead = ["11", "12"].map((m, i) => ({ ...cells[0], id: `p${i}`, date: `2026-${m}-15`, gross: 80, state: "predicted" }));
    const [ask] = suggestions([r], [...cells, ...ahead], undefined, undefined, "2026-11-09");
    expect(ask).toMatchObject({ category: "rent", rentMonths: ["2026-08", "2026-09"], rentNow: [80, 80] });
    // Jun–Jul's bill: real figures (₪61.83), not the plan's — filed quietly.
    const june = suggestions([{ ...r, id: "wj", date: "2026-08-27" }], [...cells, ...ahead], undefined, undefined, "2026-11-09");
    expect(june).toHaveLength(0);
    expect(june.attach?.[0]).toMatchObject({ expenseId: "w4" });
  });
});

describe("Partner", () => {
  it("its bill comes from partner.net.il: ₪139.24 with VAT → its month's ₪118", () => {
    expect(rentLineOf({ domain: "partner.net.il", subject: "ניצן רוזנברג,החשבונית החודשית שלך מפרטנר" }, LINES)?.line).toBe("פרטנר");
    expect(rentQuery(300)).toContain("partner.net.il");
  });
  it("reads the total from its PDF, whose text comes out right-to-left", () => {
    const text = 'סה"כחיוביהחשבוïלאכוללמע"מ%)18(80.118{ מע"מ%1838.21{ סה"ככוללמע"מ18.140{ סה"כלתשלוí18.140{ תשלוíהחשבוï';
    expect(rtlPdfTotal(text)).toEqual({ amount: 140.18, currency: "ILS" });
    expect(rtlPdfTotal("Total paid ₪140.18")).toBeNull();
  });
  it("its bills land on the month they name, ₪140.18 → ₪118.80 against the ₪118 booked", () => {
    const cells = ["06", "07", "08", "09", "10", "11", "12"].map((m, i) => ({
      id: `pt${i}`, date: `2026-${m}-15`, endDate: null, category: "rent", vendor: "פרטנר", description: "", currency: "ILS", gross: 118, renewMonths: null, state: i < 5 ? "final" : "predicted",
    }));
    const bill = { id: "pb", vendor: null, suggestedVendor: "Partner", sender: "Partner <Thankyou@partner.net.il>", domain: "partner.net.il", date: "2026-10-26", subject: "היי סטודיו אנד מור בעמ ., החשבונית החודשית שלך לחודש ספטמבר 2026", account: "office@studionmore.com", amount: 140.18, currency: "ILS" };
    const out = suggestions([bill], cells, undefined, undefined, "2026-11-09");
    expect(out).toHaveLength(0);
    expect(out.attach?.[0]).toMatchObject({ expenseId: "pt3", rent: true });
  });
});

/*
 * The real 2026 bills, as their emails and PDFs read (Nitsan, 2026-11-09: "pay
 * attention to VAT on invoices, and read the mails carefully"). Each must land
 * where the grid books it, without VAT.
 */
describe("the real 2026 Rent bills", () => {
  let k = 0;
  const cell = (line: string, month: string, gross: number, state = "final"): ExpenseLite => ({
    id: `x${++k}`, date: `${month}-15`, endDate: null, category: "rent", vendor: line, description: "", currency: "ILS", gross, renewMonths: null, state,
  });
  const bill = (domain: string, subject: string, date: string, amount: number | null, more: Partial<Receipt> = {}): Receipt => ({
    id: `b${++k}`, vendor: null, suggestedVendor: domain, sender: `x <a@${domain}>`, domain, date, subject, account: "office@studionmore.com", amount, currency: amount == null ? null : "ILS", ...more,
  });

  it("Aluel's rent: the total with 18% VAT → the cell without it", () => {
    const rows = [cell("שכירות", "2026-07", 15360), cell("שכירות", "2026-08", 15360), cell("שכירות", "2026-09", 15404), cell("שכירות", "2026-10", 15360)];
    const s = suggestions(
      [
        bill("aluel.co.il", "(מסמך ממוחשב) הדפסת חשבונית מרכזת - SI266000061", "2026-07-15", 18125),
        bill("aluel.co.il", "(מסמך ממוחשב) הדפסת חשבונית מרכזת - SI266000071", "2026-08-19", 18125),
        bill("aluel.co.il", "(מסמך ממוחשב) הדפסת חשבונית מרכזת - SI266000079", "2026-09-17", 18176.89),
        bill("aluel.co.il", "(מסמך ממוחשב) הדפסת חשבונית מרכזת - SI266000087", "2026-10-19", 18297.95),
      ],
      rows,
    );
    // July–September already hold their bill: filed. October differs: suggested, ₪15,506.74 — never 18k.
    expect(s.attach?.map((a) => a.expenseId)).toEqual([rows[0].id, rows[1].id, rows[2].id]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ rentMonths: ["2026-10"], rentVat: true });
    expect(rentNet(s[0].amount!, s[0].rentVat!, "2026-10")).toBe(15506.74);
  });

  it("IEC: each bill to its period's pair, its own total without VAT", () => {
    // The bills' own totals (each PDF's "סה"כ כולל מע"מ לתקופת חשבון"), and the grid Nitsan keeps.
    const pairs: [string, number][] = [["2025-11", 353.94], ["2026-01", 383.08], ["2026-03", 292.25], ["2026-05", 390.34], ["2026-07", 790.18]];
    const rows = pairs.flatMap(([m, v]) => {
      const [y, mo] = m.split("-").map(Number);
      return [cell("חשמל", m, v, "actual"), cell("חשמל", `${y}-${String(mo + 1).padStart(2, "0")}`, v, "actual")];
    });
    const bills = [
      bill("iec.co.il", 'סטודיו אנד מור בע"מ  מספר חשבון חוזה 345579315  לתקופה - 07/01/2026 - 12/11/2025', "2026-01-08", 835.31),
      bill("iec.co.il", 'סטודיו אנד מור בע"מ  מספר חשבון חוזה 345579315  לתקופה - 12/03/2026 - 08/01/2026', "2026-03-15", 904.08),
      bill("iec.co.il", 'סטודיו אנד מור בע"מ  מספר חשבון חוזה 345579315  לתקופה - 07/05/2026 - 13/03/2026', "2026-05-12", 689.73),
      bill("iec.co.il", 'סטודיו אנד מור בע"מ  מספר חשבון חוזה 345579315  לתקופה - 29/06/2026 - 08/05/2026', "2026-06-30", 921.21),
      bill("iec.co.il", 'סטודיו אנד מור בע"מ  מספר חשבון חוזה 345579315  לתקופה - 08/09/2026 - 30/06/2026', "2026-09-09", 1864.83),
    ];
    const s = suggestions(bills, rows);
    expect(s).toHaveLength(0);
    expect(s.attach?.map((a) => rows.find((r) => r.id === a.expenseId)?.date.slice(0, 7))).toEqual(["2025-11", "2026-01", "2026-03", "2026-05", "2026-07"]);
    // Before the grid holds them, the period alone says where each goes.
    expect(bills.map((b) => periodPair(b.subject))).toEqual([
      ["2025-11", "2025-12"], ["2026-01", "2026-02"], ["2026-03", "2026-04"], ["2026-05", "2026-06"], ["2026-07", "2026-08"],
    ]);
  });

  it("IEC's PDF: its own total, not the previous bill's it mentions", () => {
    const text = 'ריכוז החשבון 1,497.28 חיוב בגין צריכה 1,580.36 סה"כ ללא מע"מ 284.47 18.00 % מע"מ 1,864.83 סה"כ כולל מע"מ לתקופת חשבון 1,864.83 סה"כ לתשלום )ש"ח( הודעות כלליות ח-ן 06/2026 בסך 921.21 ש"ח נשלח לגביה';
    expect(rtlPdfTotal(text)).toEqual({ amount: 1864.83, currency: "ILS" });
  });

  it("Idan Shani's building fee: the month it's paid FOR, no VAT", () => {
    const body = "שלום ניצן רוזנברג, תאריך 17/04/2026 שעה 05:33 בשם ועד הבית של ניצנה 11 , תל אביב מספר דירה 2, כניסה נחמה 13/לופט ב אישור תשלום מספר 98342 סכום ששולם 199 שולם לחודש מאי - 2026 לחץ כאן לצפיה והדפסת אישור";
    expect(receiptAmount(body)).toEqual({ amount: 199, currency: "ILS" });
    const item = receiptDescription(body);
    expect(item).toBe("לחודש מאי - 2026");
    const rows = [cell("ועד בית", "2026-04", 199), cell("ועד בית", "2026-05", 199)];
    const s = suggestions([bill("idan-shani.co.il", "אישור תשלום מס'98342 - עבור דמי וועד בבניין ניצנה 11 , תל אביב", "2026-04-17", 199, { itemDescription: item })], rows);
    expect(s.attach?.[0].expenseId).toBe(rows[1].id);
  });

  it("arnona's slip: the two months it opens, no VAT", () => {
    const [s] = suggestions([bill("tel-aviv.gov.il", "תלוש הארנונה שלך", "2026-11-01", null)], [cell("ארנונה", "2026-11", 3500, "predicted"), cell("ארנונה", "2026-12", 3500, "predicted"), cell("ארנונה", "2026-09", 3498.13), cell("ארנונה", "2026-10", 3498.13)]);
    expect(s).toMatchObject({ rentLine: "ארנונה", rentMonths: ["2026-11", "2026-12"], rentVat: false });
  });
});

describe("booked months are never asked about", () => {
  it("a bill with no amount for months the grid has booked goes on the cells; a planned month still asks", () => {
    const cell = (m: string, gross: number, state: string): ExpenseLite => ({ id: m, date: `${m}-15`, endDate: null, category: "rent", vendor: "ארנונה", description: "", currency: "ILS", gross, renewMonths: null, state });
    const rows = [cell("2026-09", 3498.13, "final"), cell("2026-10", 3498.13, "final"), cell("2026-11", 3500, "predicted"), cell("2026-12", 3500, "predicted")];
    const slip = (id: string, date: string): Receipt => ({ id, vendor: null, suggestedVendor: "", sender: "a <a@tel-aviv.gov.il>", domain: "tel-aviv.gov.il", date, subject: "תלוש הארנונה שלך", account: "office@studionmore.com", amount: null, currency: null });
    const s = suggestions([slip("sep", "2026-09-01"), slip("nov", "2026-11-01")], rows);
    expect(s.attach).toEqual([{ receiptId: "sep", expenseId: "2026-09", date: "2026-09-01", also: [{ expenseId: "2026-10", month: "2026-10" }], rent: true }]);
    expect(s.map((x) => x.id)).toEqual(["nov"]);
  });
});

describe("several months paid at once", () => {
  it("Idan Shani's ₪597 'for April' is February–April at ₪199 — booked, so it's filed", () => {
    expect(monthsPaid(597, [{ date: "2026-03-15", gross: 199 }], "2026-04")).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(monthsPaid(199, [{ date: "2026-03-15", gross: 199 }], "2026-04")).toBeNull();
    expect(monthsPaid(450, [{ date: "2026-03-15", gross: 199 }], "2026-04")).toBeNull();
    const cell = (m: string): ExpenseLite => ({ id: m, date: `${m}-15`, endDate: null, category: "rent", vendor: "ועד בית", description: "", currency: "ILS", gross: 199, renewMonths: null, state: "final" });
    const r: Receipt = { id: "p", vendor: null, suggestedVendor: "", sender: "office@idan-shani.co.il", domain: "idan-shani.co.il", date: "2026-04-16", subject: "אישור תשלום מס'98336 - עבור דמי וועד בבניין ניצנה 11 , תל אביב", account: "office@studionmore.com", amount: 597, currency: "ILS", itemDescription: "לחודש אפריל - 2026" };
    const s = suggestions([r], ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"].map(cell));
    expect(s).toHaveLength(0);
    expect(s.attach?.[0]).toMatchObject({ expenseId: "2026-02", also: [{ expenseId: "2026-03" }, { expenseId: "2026-04" }] });
  });
});

describe("only PAST booked months are filed without asking", () => {
  it("Nov–Dec's arnona, typed in as ₪3,500, still asks in November", () => {
    const cell = (m: string, gross: number): ExpenseLite => ({ id: m, date: `${m}-15`, endDate: null, category: "rent", vendor: "ארנונה", description: "", currency: "ILS", gross, renewMonths: null, state: "actual" });
    const rows = [cell("2026-09", 3498.13), cell("2026-10", 3498.13), cell("2026-11", 3500), cell("2026-12", 3500)];
    const slip = (id: string, date: string): Receipt => ({ id, vendor: null, suggestedVendor: "", sender: "a <a@tel-aviv.gov.il>", domain: "tel-aviv.gov.il", date, subject: "תלוש הארנונה שלך", account: "office@studionmore.com", amount: null, currency: null });
    const s = suggestions([slip("sep", "2026-09-01"), slip("nov", "2026-11-01")], rows, undefined, undefined, "2026-11-09");
    expect(s.attach?.map((a) => a.receiptId)).toEqual(["sep"]);
    expect(s.map((x) => x.id)).toEqual(["nov"]);
  });
});
