import { describe, expect, it } from "vitest";
import { matchVendor } from "./classify";
import { attachmentsOf, bodyText, covered, coveredBy, existingVendor, rowFill, storageName, htmlToText, invoiceLink, isPaidReceipt, receiptAmount, receiptDescription, receiptDetails, senderDomain, similarVendors, skeleton, suggestions, vendorFromSender, type ExpenseLite, type Known, type Receipt } from "./receipts";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

describe("reading a receipt's amount", () => {
  it("takes what was paid, not the subtotal or the tax", () => {
    const text = "Receipt #2433-1591\nClaude Max\nSubtotal $100.00\nTax $0.00\nTotal $100.00\nAmount paid $100.00";
    expect(receiptAmount(text)).toEqual({ amount: 100, currency: "USD" });
    const figma = "Description Qty Amount\nProfessional seat (Oct 25 – Jan 25) 1 $45.00\nSubtotal $45.00\nTotal $45.00";
    expect(receiptAmount(figma)).toEqual({ amount: 45, currency: "USD" });
  });

  it("reads table cells, thousands and Hebrew receipts", () => {
    const html = "<table><tr><td>Subtotal</td><td>€1,180.00</td></tr><tr><td>VAT</td><td>€0.00</td></tr><tr><td><b>Total</b></td><td>€1,180.00</td></tr></table>";
    expect(receiptAmount(htmlToText(html))).toEqual({ amount: 1180, currency: "EUR" });
    expect(receiptAmount('פריט 1 ₪100.00\nמע"מ ₪18.00\nסה"כ לתשלום ₪118.00')).toEqual({ amount: 118, currency: "ILS" });
    expect(receiptAmount("סה״כ 236.00 ש״ח")).toEqual({ amount: 236, currency: "ILS" });
  });

  it("reads a total stuck to its label, the currency elsewhere (Wolt's PDF)", () => {
    const wolt = "(מקור) חשבונית מס קבלה פירוטסכום נטומע״מ %מע״מסה״כ הזמנות114.411820.59135.00 דמי משלוח ושירות15.17182.7317.90 (₪) 18% סה״כ חייב במע״מ129.58 (₪) 18% מע״מ23.32 (₪) סה״כ כולל מע״מ152.90 1/3 פרטים לתשלום (₪) סה״כ לתשלום152.90 לתשלום עד10.10.2026";
    expect(receiptAmount(wolt)).toEqual({ amount: 152.9, currency: "ILS" });
  });

  it("falls back to the largest amount, and finds none in a receipt without one", () => {
    expect(receiptAmount("Your plan: $12.00 per seat, 3 seats, $36.00 charged on Nov 3")).toEqual({ amount: 36, currency: "USD" });
    expect(receiptAmount("View your receipt online")).toBeNull();
  });

  it("prefers the HTML part when the plain part is a stub", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("View it in your browser.") } },
        { mimeType: "text/html", body: { data: b64("<p>Thanks for your payment to Plnty.</p><table><tr><td>Amount paid</td><td>$110.00</td></tr></table><p>Questions? Reply to this email and we'll help.</p>") } },
      ],
    };
    expect(receiptAmount(bodyText(payload))).toEqual({ amount: 110, currency: "USD" });
  });
});

describe("who sent it", () => {
  it("names a new vendor from its display name, else its site", () => {
    expect(vendorFromSender('"Anthropic, PBC" <invoice+statements@mail.anthropic.com>')).toBe("Anthropic");
    expect(vendorFromSender("Figma Billing <billing@figma.com>")).toBe("Figma");
    // A person writing from a company's mail is the company (Nitsan, 2026-11-06).
    expect(vendorFromSender("Hadas Rozen <hadas@notraffic.tech>")).toBe("Notraffic");
    expect(vendorFromSender('"גלית" <galit@aluel.co.il>')).toBe("Aluel");
    // A payment processor writes in the seller's name; a free mailbox is the person's own.
    expect(vendorFromSender('"Framer B.V." <receipts@stripe.com>')).toBe("Framer");
    expect(vendorFromSender("AB Babaei <ab.babaei@gmail.com>")).toBe("AB Babaei");
    expect(vendorFromSender("no-reply@notion.so")).toBe("Notion");
    expect(senderDomain("X <a@mail.anthropic.com>")).toBe("anthropic.com");
    expect(senderDomain("X <a@billing.bezeq.co.il>")).toBe("bezeq.co.il");
  });

  it("only receipts the studio paid — not money coming in, not invoicing platforms", () => {
    expect(isPaidReceipt("Figma <billing@figma.com>", "Your receipt from Figma, Inc. #2723-1885")).toBe(true);
    expect(isPaidReceipt("Stripe <notifications@stripe.com>", "You received a payment of $500")).toBe(false);
    expect(isPaidReceipt("חשבונית ירוקה <noreply@greeninvoice.co.il>", "חשבונית מס קבלה מ-דנה")).toBe(false);
    expect(isPaidReceipt("Figma <billing@figma.com>", "Introducing Figma Sites")).toBe(false);
  });
});

describe("which receipts need a row", () => {
  let n = 0;
  const receipt = (vendor: string | null, date: string, amount: number | null, more: Partial<Receipt> = {}): Receipt => ({
    id: `m${++n}`,
    vendor,
    suggestedVendor: vendor ?? "Notion",
    sender: `${vendor ?? "Notion"} <billing@${(vendor ?? "notion").toLowerCase().replace(/\s/g, "")}.com>`,
    domain: `${(vendor ?? "notion").toLowerCase().replace(/\s/g, "")}.com`,
    date,
    subject: "Your receipt",
    account: "nitsan@studionmore.com",
    amount,
    currency: amount == null ? null : "USD",
    ...more,
  });
  const row = (vendor: string, date: string, category: string, gross: number, more: Partial<ExpenseLite> = {}): ExpenseLite => ({
    id: `r${++n}`,
    date,
    endDate: null,
    category,
    vendor,
    description: "",
    currency: "USD",
    gross,
    renewMonths: category === "yearly" ? 12 : null,
    ...more,
  });

  it("a running monthly row, a payment that week, or the same amount covers it", () => {
    expect(covered(receipt("Plnty", "2026-10-03", 110), [row("Plnty", "2026-09-01", "monthly", 110)])).toBe(true);
    expect(covered(receipt("Figma", "2026-07-08", 1923), [row("Figma", "2026-07-08", "yearly", 1923)])).toBe(true);
    expect(covered(receipt(null, "2026-10-12", 48), [row("Notion Labs", "2026-10-10", "misc", 48)])).toBe(true);
    // Figma's extra seat mid-year isn't the yearly row.
    expect(covered(receipt("Figma", "2026-09-25", 45), [row("Figma", "2026-07-08", "yearly", 1923)])).toBe(false);
  });

  it("puts a covered receipt's files on the row that covers it (Anthropic, Plnty)", () => {
    const pro = row("Claude pro", "2026-08-01", "monthly", 75);
    const plntyOld = row("Plnty", "2026-09-01", "monthly", 110, { endDate: "2026-09-30" });
    const plnty = row("Plnty", "2026-10-03", "monthly", 175);
    const rows = [row("Claude max", "2026-06-01", "monthly", 100, { endDate: "2026-06-30" }), pro, plntyOld, plnty];
    expect(coveredBy(receipt("Claude max", "2026-08-03", 75), rows)?.id).toBe(pro.id);
    expect(coveredBy(receipt("Plnty", "2026-11-03", 175), rows)?.id).toBe(plnty.id);
    // The same amount from another vendor's row clears it, but nothing is moved there.
    expect(coveredBy(receipt(null, "2026-10-12", 48), [row("Notion Labs", "2026-10-10", "misc", 48)])).toBeNull();
    const s = suggestions([receipt("Claude max", "2026-09-03", 75), receipt("Plnty", "2026-10-03", 175)], rows);
    expect(s).toHaveLength(0);
    expect(s.attach?.map((a) => a.expenseId)).toEqual([pro.id, plnty.id]);
  });

  it("guesses the row: a monthly that ended continues, a renewal on its anniversary, else misc", () => {
    const rows = [row("Claude max", "2026-06-01", "monthly", 100, { endDate: "2026-06-30", description: "Max plan" }), row("Zoom", "2025-10-30", "yearly", 200)];
    const s = suggestions(
      [receipt("Claude max", "2026-07-03", 100), receipt("Claude max", "2026-08-03", 100), receipt("Zoom", "2026-10-31", 230), receipt(null, "2026-10-20", 16, { subject: "Your Notion receipt" })],
      rows,
    );
    expect(s.map((x) => [x.suggestedVendor, x.category, x.description, x.repeats])).toEqual([
      ["Claude max", "monthly", "Max plan", 1],
      ["Notion", "misc", "", 0],
      ["Zoom", "yearly", "", 0],
    ]);
    // Charged after its row ended (Nitsan, 2026-11-07, Framer): flagged against that row.
    expect(s[0].afterEnd).toEqual({ expenseId: rows[0].id, vendor: "Claude max", endDate: "2026-06-30" });
    expect(s[1].afterEnd).toBeNull();
    // Ended long before: a new product, not flagged.
    const old = suggestions([receipt("Claude max", "2026-07-03", 100)], [row("Claude max", "2024-06-01", "monthly", 100, { endDate: "2024-12-31" })]);
    expect(old[0].afterEnd).toBeNull();
  });

  it("a yearly renewal charged a few days early is still its renewal", () => {
    const zoom = row("Zoom", "2025-10-30", "yearly", 200);
    expect(suggestions([receipt("Zoom", "2026-10-27", 230)], [zoom])[0].category).toBe("yearly");
    // Half a year off is a one-off, early or late.
    expect(suggestions([receipt("Zoom", "2026-04-28", 230)], [zoom])[0].category).toBe("misc");
  });

  it("a vendor whose last one-off was an Investment is suggested as one again", () => {
    const s = suggestions(
      [receipt("iDigital", "2026-10-05", 4000), receipt("Notion", "2026-10-06", 16)],
      [row("iDigital", "2026-03-01", "misc", 200), row("iDigital", "2026-06-01", "investment", 6000), row("Notion", "2026-06-01", "misc", 16)],
    );
    expect(s.map((x) => [x.suggestedVendor, x.category])).toEqual([
      ["iDigital", "investment"],
      ["Notion", "misc"],
    ]);
  });

  it("matches a vendor spelled in the other script, and offers close names for a new one", () => {
    const known: Known = { vendors: ["וולט", "BuyMe", "Framer Basic", "Figma"], clients: [], freelancers: [], learned: {} };
    const s = suggestions(
      [
        receipt(null, "2026-10-01", 120, { suggestedVendor: "Wolt", sender: "Wolt <corporate.services.isr@wolt.com>", domain: "wolt.com", subject: "Wolt invoice for Studio and More LTD" }),
        receipt(null, "2026-10-02", 30, { suggestedVendor: "Framer", sender: "Framer <billing@framer.com>", domain: "framer.com", subject: "Your receipt" }),
      ],
      [],
      known,
    );
    expect(s.map((x) => [x.vendor, x.similar])).toEqual([
      ["וולט", []],
      [null, ["Framer Basic"]],
    ]);
  });

  // The real noise of 2026-11-06, cleared (Nitsan: "make sure to clear that noise").
  const known: Known = { vendors: ["Figma", "Claude pro", "LinkedIn", "Wolt"], clients: ["NoTraffic", "Anchor", "Visitt", "Checkmarx", "Studio"], freelancers: ["Abolfazi Babaei", "Makersteam", "one-v"], learned: {} };
  const mail = (sender: string, subject: string, date: string, more: Partial<Receipt> = {}): Receipt => ({
    id: `m${++n}`,
    vendor: null,
    suggestedVendor: vendorFromSender(sender),
    sender,
    domain: senderDomain(sender),
    date,
    subject,
    account: "office@studionmore.com",
    amount: null,
    currency: null,
    ...more,
  });

  it("clears the studio's own invoices, clients, freelancers, replies and Plan-line suppliers", () => {
    const s = suggestions(
      [
        mail("Hadas Rozen <hadas@notraffic.tech>", "Studio&more | September Invoice", "2026-09-15"),
        mail("Einav Maya <einav@sayanchor.com>", "Re: Studio&more | September Invoice", "2026-09-23"),
        mail("Checkmarx Accounts Payables <ap@checkmarx.com>", "Your invoice 401515 has been received by our AP team", "2026-07-19"),
        mail("Visitt Billing <billing@visitt.io>", "Visitt | October Invoice", "2026-11-03"),
        mail("AB Babaei <ab.babaei@gmail.com>", "AB Babaei Invoice - October 2026", "2026-11-01"),
        mail("MakersTeam <hi@makersteam.co>", "Makersteam | October Invoice", "2026-11-05"),
        mail("Anna Shydlovska <anna@one-v.co.il>", "One-V Report for September and Invoice", "2026-10-06"),
        mail('"בועז שרעבי" <b@gurg.co.il>', "(מסמך ממוחשב) הדפסת חשבונית מס/קבלה - OV265006217, דמי טיפול 09.26", "2026-10-28"),
        mail("Wolt <invoices@wolt.com>", "Wolt invoice for Studio and More LTD(2026-09-01 - 2026-09-30)", "2026-10-01"),
        mail("Cloudflare <noreply@cloudflare.com>", "Your invoice is available", "2026-10-22"),
      ],
      [],
      known,
      matchVendor,
    );
    expect(s.map((x) => x.suggestedVendor)).toEqual(["Wolt", "Cloudflare"]);
    expect(s.cleared).toEqual({ client: 3, reply: 1, freelance: 3, "plan-line": 1 });
  });

  it("one receipt in two mailboxes is one suggestion, with both mailboxes", () => {
    const a = mail("Cloudflare <noreply@cloudflare.com>", "Your invoice is available", "2026-10-22", { account: "nitsan@studionmore.com" });
    const b = mail("Cloudflare <noreply@cloudflare.com>", "Your invoice is available", "2026-10-22");
    const s = suggestions([a, b], [], known, matchVendor);
    expect(s).toHaveLength(1);
    expect(s[0].accounts).toEqual(["nitsan@studionmore.com", "office@studionmore.com"]);
    expect(s.cleared).toEqual({ duplicate: 1 });
  });

  it("recognises a supplier already on Expenses by its sender, family or a past approval", () => {
    const rows = [row("LinkedIn", "2026-10-08", "investment", 150, { currency: "ILS" }), row("Claude pro", "2026-08-01", "monthly", 75)];
    const s = suggestions(
      [
        mail("LinkedIn <billing@linkedin.com>", "We received your payment! Your receipt is attached.", "2026-10-03", { amount: 500, currency: "USD" }),
        mail('"Anthropic, PBC" <invoice@mail.anthropic.com>', "Your receipt from Anthropic, PBC #2994", "2026-10-03", { vendor: "Claude max", amount: 75, currency: "USD" }),
        mail('"גלית" <galit@aluel.co.il>', "(מסמך ממוחשב) הדפסת חשבונית מרכזת - SI266000087", "2026-10-19"),
      ],
      rows,
      { ...known, learned: { "aluel.co.il": "Aluel coffee" } },
      matchVendor,
    );
    expect(s.map((x) => [x.suggestedVendor, x.vendor])).toEqual([["Aluel coffee", "Aluel coffee"]]);
    expect(s.cleared).toEqual({ "on-expenses": 2 });
  });
});

describe("a receipt's paperwork", () => {
  it("finds the invoice number and the card", () => {
    expect(receiptDetails("Paid with Visa ending in 3562\nInvoice number: 70860076")).toEqual({ invoice: "70860076", paidWith: "Visa ••3562" });
    expect(receiptDetails("Amount paid $75.00\nMastercard •••• 1234", "Your receipt from Anthropic, PBC #2433-1591-6260")).toEqual({ invoice: "2433-1591-6260", paidWith: "Mastercard ••1234" });
    expect(receiptDetails('סה"כ לתשלום ₪1,256.23\nשולם בכרטיס אשראי המסתיים ב-3562', "(מסמך ממוחשב) הדפסת חשבונית מס/קבלה - OV265006217")).toEqual({ invoice: "OV265006217", paidWith: "Card ••3562" });
    expect(receiptDetails("Payment method: bank transfer", "Wolt invoice for Studio and More LTD")).toEqual({ invoice: null, paidWith: "Bank transfer" });
    expect(receiptDetails("Thanks!")).toEqual({ invoice: null, paidWith: null });
  });
});

describe("a receipt's documents", () => {
  it("keeps the PDF and real scans, never the logo or the signature", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/html", body: { data: "" } },
        { mimeType: "application/pdf", filename: "Invoice-70860076.pdf", body: { attachmentId: "a1", size: 84_000 } },
        { mimeType: "image/png", filename: "image001.png", body: { attachmentId: "a2", size: 120_000 } },
        { mimeType: "image/png", filename: "logo.png", body: { attachmentId: "a3", size: 9_000 } },
        { mimeType: "image/jpeg", filename: "scan.jpg", headers: [{ name: "Content-Disposition", value: 'inline; filename="scan.jpg"' }], body: { attachmentId: "a4", size: 500_000 } },
        { mimeType: "image/jpeg", filename: "קבלה.jpg", body: { attachmentId: "a5", size: 400_000 } },
        { mimeType: "application/zip", filename: "files.zip", body: { attachmentId: "a6", size: 50_000 } },
        { mimeType: "application/pdf", filename: "huge.pdf", body: { attachmentId: "a7", size: 40_000_000 } },
      ],
    };
    expect(attachmentsOf(payload).map((a) => a.filename)).toEqual(["Invoice-70860076.pdf", "קבלה.jpg"]);
  });
});

describe("one vendor, however it's spelled", () => {
  it("gives a Hebrew and an English name the same consonants", () => {
    expect(skeleton("Wolt")).toBe(skeleton("וולט"));
    expect(skeleton("BuyMe")).toBe(skeleton("ביימי"));
    expect(skeleton("באיימי")).toBe(skeleton("buyme"));
    expect(skeleton("Figma")).toBe(skeleton("פיגמה"));
    expect(skeleton("Wolt")).not.toBe(skeleton("Wix"));
  });

  it("matches surely only on the same name or a long-enough skeleton; suggests the near ones", () => {
    expect(existingVendor("wolt", ["Wolt"])).toBe("Wolt");
    expect(existingVendor("Wolt", ["וולט"])).toBe("וולט");
    // Two consonants are too few to be sure — offered, not matched.
    expect(existingVendor("BuyMe", ["באיימי"])).toBeNull();
    expect(similarVendors("BuyMe", ["באיימי", "Wolt", "Bumble"])).toEqual(["באיימי"]);
    expect(similarVendors("Adobe", ["Adobe Creative Cloud", "Adobi", "Figma"])).toEqual(["Adobi", "Adobe Creative Cloud"]);
    expect(similarVendors("Notion", ["Figma", "Wolt"])).toEqual([]);
  });
});

describe("what was bought", () => {
  it("reads the item from a Hebrew receipt and a Stripe one", () => {
    const buyme = 'הופק ב 22/10/2026 16:23 | קבלה 9532993 | עמוד 1 מתוך 1 ביי מי טכנולוגיות בע"מ לכבוד: סטודיו אנד מור קבלה 9532993 העתק נאמן למקור קבלה בגין רכישת יום פינוק עם עיסוי - זוגי - Kedem Spa פרטי תשלומים סכום תאריך פירוט אמצעי תשלום ₪990.00';
    expect(receiptDescription(buyme)).toBe("יום פינוק עם עיסוי - זוגי - Kedem Spa");
    const figma = "$24.00 paid on July 25, 2026 Description Qty Unit price Amount Figma Weave Starter (per Seats) Jul 25 Aug 25, 2026 1 $24.00 $24.00 Subtotal $24.00";
    expect(receiptDescription(figma)).toBe("Figma Weave Starter (per Seats)");
    expect(receiptDescription("Item: Pro plan Total $10.00")).toBe("Pro plan");
    expect(receiptDescription("Thanks for your payment. Total $10.00")).toBeNull();
  });

  it("never takes who was billed — the PDF's item beats a label in the email", () => {
    const email = "קבלה עבור: סטודיו אנד מור ח.פ/ת.ז/ע.מ: 040855744 קבלה מספר 9019488 סה״כ 236.00 ש״ח";
    expect(receiptDescription(email)).toBeNull();
    expect(receiptDescription("קבלה בגין רכישת שובר BUYME ALL פרטי תשלומים", email)).toBe("שובר BUYME ALL");
  });

  it("puts it in the suggestion's description, before the vendor's usual one", () => {
    const s = suggestions(
      [{ id: "x", vendor: "BuyMe", suggestedVendor: "BuyMe", sender: "BUYME <info@buyme.co.il>", domain: "buyme.co.il", date: "2026-10-22", subject: "קבלה עבור רכישה מ - BUYME", account: "office@studionmore.com", amount: 990, currency: "ILS", itemDescription: "יום פינוק עם עיסוי - זוגי - Kedem Spa" }],
      [],
    );
    expect(s[0].description).toBe("יום פינוק עם עיסוי - זוגי - Kedem Spa");
  });

  it("leaves out a payment request — only the tax invoice counts", () => {
    const subject = "דרישת תשלום קבלה דיגיטלית מביימי DBC.85.2655300: studio&more 515815884";
    expect(isPaidReceipt("NO-REPLY@buyme.co.il", subject)).toBe(false);
    const s = suggestions([{ id: "y", vendor: "BuyMe", suggestedVendor: "BuyMe", sender: "NO-REPLY@buyme.co.il", domain: "buyme.co.il", date: "2026-09-16", subject, account: "office@studionmore.com", amount: null, currency: null }], []);
    expect(s).toHaveLength(0);
    expect(s.cleared).toEqual({ request: 1 });
  });
});

describe("files sent as octet-stream", () => {
  it("keeps a PDF by its name, inline or by id, once per name and size", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "application/octet-stream", filename: "Wolt_invoice_2026-09.pdf", body: { attachmentId: "w1", size: 60_000 } },
        { mimeType: "application/octet-stream", filename: "Wolt_invoice_2026-09.pdf", body: { attachmentId: "w2", size: 60_000 } },
        { mimeType: "application/octet-stream", filename: "data.bin", body: { attachmentId: "w3", size: 60_000 } },
        { mimeType: "application/pdf", filename: "small.pdf", body: { data: "JVBERi0=", size: 5 } },
      ],
    };
    expect(attachmentsOf(payload).map((a) => [a.filename, a.mime, !!a.data])).toEqual([
      ["Wolt_invoice_2026-09.pdf", "application/pdf", false],
      ["small.pdf", "application/pdf", true],
    ]);
  });
});

describe("where to get an invoice that isn't attached", () => {
  const html = (h: string) => ({ mimeType: "text/html", body: { data: b64(h) } });
  it("takes the invoice button over a log-in, never unsubscribe or help", () => {
    const cloudflare = html(
      '<p>Your invoice is available.</p><a href="https://www.cloudflare.com/unsubscribe?x=1">Unsubscribe</a><a href="https://dash.cloudflare.com/login">Log in</a><a href="https://dash.cloudflare.com/billing/invoices?id=IN-1&amp;a=2"><b>View invoice</b></a><a href="https://support.cloudflare.com">Help</a>',
    );
    expect(invoiceLink(cloudflare)).toBe("https://dash.cloudflare.com/billing/invoices?id=IN-1&a=2");
    expect(invoiceLink(html('<a href="https://app.example.com/account">Sign in to your account</a>'))).toBe("https://app.example.com/account");
  });
  it("finds none without a button, and never a plain-http one", () => {
    expect(invoiceLink(html('<a href="http://x.com/invoice">View invoice</a><a href="https://x.com/blog">Our blog</a>'))).toBeNull();
    expect(invoiceLink({ mimeType: "text/plain", body: { data: b64("View your invoice at https://x.com") } })).toBeNull();
  });
});

describe("rowFill (v1.23.0)", () => {
  const rec = (date: string, invoiceNumber: string | null, paidWith: string | null, item: string | null) => ({ date, invoiceNumber, paidWith, item });
  const anthropic = [
    rec("2026-08-03", "2750-7898-4527", "Mastercard ••5065", "Team plan - Standard"),
    rec("2026-08-21", "2107-2624-0303", "Mastercard ••5065", "One-time credit purchase"),
    rec("2026-11-03", "2433-1591-6260", "Mastercard ••5065", "Team plan - Standard"),
  ];

  it("a Monthly row takes the card and the usual item, not one month's invoice number", () => {
    expect(rowFill({ category: "monthly", invoiceNumber: null, paidWith: null, description: "" }, anthropic)).toEqual({
      paid_with: "Mastercard ••5065",
      description: "Team plan - Standard",
    });
  });

  it("any other row takes the latest invoice number too", () => {
    expect(rowFill({ category: "misc", invoiceNumber: "", paidWith: null, description: "Claude" }, anthropic)).toEqual({
      paid_with: "Mastercard ••5065",
      invoice_number: "2433-1591-6260",
    });
  });

  it("never over what's typed, never a locked row; a cut-off period is trimmed", () => {
    expect(rowFill({ category: "misc", invoiceNumber: "A1", paidWith: "Visa ••1041", description: "x" }, anthropic)).toEqual({});
    expect(rowFill({ category: "misc", state: "final", invoiceNumber: null, paidWith: null, description: "" }, anthropic)).toEqual({});
    expect(rowFill({ category: "monthly", invoiceNumber: null, paidWith: "Visa", description: "" }, [rec("2026-10-03", null, null, "Plnty Pro (Monthly) 20,500 credits — From")])).toEqual({
      description: "Plnty Pro (Monthly) 20,500 credits",
    });
  });
});

describe("storageName (v1.24.2)", () => {
  it("keeps a Storage key ASCII, with its extension", () => {
    expect(storageName("(מסמך ממוחשב) הדפסת חשבונית מרכזת - SI266000087.pdf")).toBe("SI266000087.pdf");
    expect(storageName("חשבונית.PDF", "receipt")).toBe("receipt.pdf");
    expect(storageName("Invoice-PHXZCFLN-0007.pdf")).toBe("Invoice-PHXZCFLN-0007.pdf");
    expect(storageName("GoodSync receipt 2407110278.png")).toBe("GoodSync-receipt-2407110278.png");
    expect(storageName("קבלה")).toBe("document");
  });
});

describe("receiptDetails — Aluel's consolidated invoice", () => {
  it("reads the number after חשבונית מרכזת", () => {
    expect(receiptDetails("", "(מסמך ממוחשב) הדפסת חשבונית מרכזת - SI266000087").invoice).toBe("SI266000087");
  });
});
