import { describe, expect, it } from "vitest";
import { marksIn, maskAmounts, unmaskAmounts } from "@/lib/finance/advice/redact";
import { acceptable } from "./hebrew";
import { fixedHebrew, uiT } from "./he-ui";
import { viewTexts } from "./texts";
import type { AdviceRow } from "./merge";
import type { AdviceView } from "./run";

describe("amounts never reach the translator", () => {
  it("swaps every amount for a numbered mark and puts each back", () => {
    const src = "Acme owes ₪12,400 for October; the hours since are worth another 3,200 NIS.";
    const { masked, amounts } = maskAmounts(src);
    expect(masked).toBe("Acme owes {{1}} for October; the hours since are worth another {{2}}.");
    expect(amounts).toEqual(["₪12,400", "3,200 NIS"]);
    expect(masked).not.toMatch(/₪|NIS|12,400|3,200/);
    expect(unmaskAmounts(masked, amounts)).toBe(src);
  });

  it("leaves hours, percentages and dates alone", () => {
    const src = "93% of the pace, 46.5h logged, due 5 Dec";
    expect(maskAmounts(src)).toEqual({ masked: src, amounts: [] });
  });

  it("puts the amounts back where the marks landed, in whatever order the Hebrew needs", () => {
    const { amounts } = maskAmounts("₪100 now and ₪200 later");
    expect(unmaskAmounts("אחר כך {{2}} ועכשיו {{1}}", amounts)).toBe("אחר כך ₪200 ועכשיו ₪100");
  });
});

describe("a translation is used only when it is safe", () => {
  const masked = "Acme owes {{1}} for October";
  it("takes Hebrew that keeps the marks", () => {
    expect(acceptable(masked, "Acme חייבת {{1}} על אוקטובר")).toBe(true);
    expect(marksIn("Acme חייבת {{1}} על אוקטובר")).toBe("1");
  });
  it("refuses a dropped, invented or repeated mark", () => {
    expect(acceptable(masked, "Acme חייבת על אוקטובר")).toBe(false);
    expect(acceptable(masked, "Acme חייבת {{1}} ועוד {{2}}")).toBe(false);
    expect(acceptable(masked, "Acme חייבת {{1}}, כלומר {{1}}")).toBe(false);
  });
  it("refuses an amount the source did not have", () => {
    expect(acceptable(masked, "Acme חייבת {{1}} — בערך ₪12,000")).toBe(false);
    expect(acceptable("Hours ran over", "השעות חרגו ב־1,200 ש\"ח")).toBe(false);
  });
  it("reads Hebrew hours as hours, not as a price with cents", () => {
    expect(acceptable("5.25h logged 9–13 Nov", "5.25 שעות נרשמו ב-9–13 בנובמבר")).toBe(true);
    expect(acceptable("Paid late", "שולם באיחור: 152.90")).toBe(false);
  });
  it("lets a figure the source already had stay", () => {
    expect(acceptable("1,250h this year", "1,250 שעות השנה")).toBe(true);
  });
  it("refuses an answer with no Hebrew in it, unless there was nothing to translate", () => {
    expect(acceptable("Hours ran over", "Hours ran over, again")).toBe(false);
    expect(acceptable("Acme", "Acme")).toBe(true);
    expect(acceptable("Hours ran over", "  ")).toBe(false);
  });
});

describe("the interface's own Hebrew", () => {
  it("fills in values, and falls back to English for a string it does not have", () => {
    const t = uiT("he");
    expect(t("All {n}", { n: 7 })).toBe("הכול 7");
    expect(t("Not in the dictionary")).toBe("Not in the dictionary");
    expect(t.locale).toBe("he-IL");
    expect(uiT("en")("All {n}", { n: 7 })).toBe("All 7");
  });
  it("keeps its marks: every {name} in the English is in the Hebrew", () => {
    for (const en of ["Snoozed until {day}", "Show all {n}", "Here · {label}", "{at} of {n}", "Amber at {amber}%, red at {red}% — a rule of thumb", "Healthy range {low}–{high}% — a rule of thumb"]) {
      const he = fixedHebrew(en);
      expect(he, en).toBeDefined();
      const marks = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(marks(he!), en).toEqual(marks(en));
    }
  });
});

describe("what gets translated", () => {
  const row = (over: Partial<AdviceRow>): AdviceRow => ({
    id: "1",
    key: "k",
    signal: "s",
    kind: "now",
    area: "Clients",
    clientId: null,
    severity: 1,
    facts: {},
    title: "Rule title",
    body: "Rule body",
    wordedTitle: null,
    wordedBody: null,
    isReminder: false,
    firstSeen: "2026-11-01T08:00:00Z",
    lastSeen: "2026-11-01T08:00:00Z",
    resolvedAt: null,
    doneAt: null,
    snoozedUntil: null,
    snoozedAtSeverity: null,
    ...over,
  });
  const view = (items: AdviceRow[]): AdviceView => ({
    today: "2026-11-15",
    items,
    pulse: [{ label: "Pace", display: "93%", delta: null, series: [], good: true, note: "against the goal", help: "How it is counted", scope: "home", clientId: null }],
    hidden: 0,
    wordingOff: null,
    wordingDue: false,
    reviewOn: true,
    review: null,
    business: { at: "2026-11-15T09:00:00Z", summary: "The summary", questions: ["A question?"], error: null },
    businessReady: true,
    mailDue: false,
    mailboxes: null,
    checkedAt: "2026-11-15T09:00:00Z",
    wordedAt: null,
  });

  it("takes the wording that is shown, the link's label and the fix's, each once", () => {
    const texts = viewTexts(
      view([
        row({ wordedTitle: "Claude's title", facts: { action: "Open Rates", fix: JSON.stringify({ label: "Mark paid" }), figure: "₪12K" } }),
        row({ id: "2", facts: { action: "Open Rates" } }),
      ]),
    );
    expect(texts).toEqual(expect.arrayContaining(["Claude's title", "Rule body", "Rule title", "Clients", "Open Rates", "Mark paid", "Pace", "against the goal", "How it is counted", "The summary", "A question?"]));
    // The figure chip is the app's own number, never a sentence to translate.
    expect(texts).not.toContain("₪12K");
    expect(texts.filter((s) => s === "Open Rates")).toHaveLength(1);
  });
});
