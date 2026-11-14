import { describe, expect, it } from "vitest";
import { hasAmount, plainFacts, promptFor, stripAmounts } from "./redact";
import type { AdviceRow } from "@/lib/advice/merge";

const row = (over: Partial<AdviceRow> = {}): AdviceRow => ({
  id: "r1",
  key: "unpaid:lumen:2026-09-01",
  signal: "unpaid",
  kind: "heads",
  area: "Clients",
  clientId: "lumen",
  severity: 2,
  facts: { client: "Lumen", hours: 10, rateIls: 300, amountIls: 3000, figure: "₪3K", href: "/x", action: "Open" },
  title: "Lumen: September isn't marked paid",
  body: "It ended 24 days ago: 10h × ₪300 = ₪3,000 before VAT.",
  wordedTitle: null,
  wordedBody: null,
  isReminder: true,
  firstSeen: "2026-10-24T05:00:00Z",
  lastSeen: "2026-10-24T05:00:00Z",
  resolvedAt: null,
  doneAt: null,
  snoozedUntil: null,
  snoozedAtSeverity: null,
  ...over,
});

describe("what Claude is sent", () => {
  it("replaces every amount", () => {
    expect(stripAmounts("10h × ₪300 = ₪3,000; −₪12K short; €46.10/h; 5,000 NIS")).toBe(
      "10h × [amount] = [amount]; [amount] short; [amount]/h; [amount]",
    );
  });

  it("replaces amounts written after the number, with codes first, and in Hebrew", () => {
    expect(stripAmounts("Receipt 152.90 ₪")).toBe("Receipt [amount]");
    expect(stripAmounts("Total: 1,234.00₪.")).toBe("Total: [amount].");
    expect(stripAmounts("12 € per seat")).toBe("[amount] per seat");
    expect(stripAmounts("USD 46.10 charged")).toBe("[amount] charged");
    expect(stripAmounts("NIS 99 a month, EUR 12/month")).toBe("[amount] a month, [amount]/month");
    expect(stripAmounts('קבלה על סך 120 ש"ח')).toBe("קבלה על סך [amount]");
    expect(stripAmounts("חשבונית 1,450.50 ש״ח")).toBe("חשבונית [amount]");
    expect(stripAmounts("סה״כ 99 שקלים")).toBe("סה״כ [amount]");
    expect(stripAmounts("US$20 / 3 euros / 5 dollars / £8")).toBe("[amount] / [amount] / [amount] / [amount]");
    expect(stripAmounts("At 40h the rate is RSD 35/h")).toBe("At 40h the rate is [amount]/h");
  });

  it("leaves hours, shares, dates and counts alone", () => {
    const plain = "Lumen logged 46.75h over 3 months for 12 days; 93% of target, 18% VAT, since 2026-09-01.";
    expect(stripAmounts(plain)).toBe(plain);
    expect(stripAmounts("Shahar (שחר) sent 3 receipts")).toBe("Shahar (שחר) sent 3 receipts");
  });

  it("drops money facts, the figure and links", () => {
    expect(plainFacts(row().facts)).toEqual({ client: "Lumen", hours: 10 });
  });

  it("holds no currency anywhere in the prompt", () => {
    const prompt = promptFor([row()], [{ label: "Oct profit (est.)", display: "−₪12K", note: "−4% margin on ₪1.2M" }], "2026-10-24");
    expect(prompt).not.toMatch(/[₪€$]/);
    expect(prompt).not.toContain("3,000");
    expect(prompt).toContain("[amount]");
  });
});

describe("what Claude sends back", () => {
  it("is refused when it carries an amount", () => {
    expect(hasAmount("You're owed ₪3,000")).toBe(true);
    expect(hasAmount("About 12K short of break-even")).toBe(true);
    expect(hasAmount("Owed 3,000 since September")).toBe(true);
    expect(hasAmount("Lumen's September is 24 days unpaid — send a reminder")).toBe(false);
    expect(hasAmount("Hours are at 93% of the 15% target pace")).toBe(false);
    expect(hasAmount('The receipt says 120 ש"ח')).toBe(true);
    expect(hasAmount("Charged 152.90 last week")).toBe(true);
    expect(hasAmount("Charged 46 euros")).toBe(true);
    expect(hasAmount("Logged 46.75h, 12.50% of the month")).toBe(false);
  });
});
