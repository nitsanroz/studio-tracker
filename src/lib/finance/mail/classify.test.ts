import { describe, expect, it } from "vitest";
import { amountIn, classify, matchVendor, searchQuery, vendorTerms } from "./classify";

const VENDORS = ["Figma", "Claude pro", "Claude max", "ls.graphics", "Cloud ways", "Digital River", "Google", "חשבונית ירוקה", "Wix"];

describe("matching a sender to an Expenses vendor", () => {
  it("by name, squashed name, first word or alias", () => {
    expect(matchVendor("Figma <billing@figma.com>", VENDORS)).toBe("Figma");
    expect(matchVendor("ls.graphics <hello@ls.graphics>", VENDORS)).toBe("ls.graphics");
    expect(matchVendor("Cloudways <billing@cloudways.com>", VENDORS)).toBe("Cloud ways");
    expect(matchVendor("Maxon <noreply@maxon.net>", VENDORS)).toBe("Digital River");
    expect(matchVendor("Wix.com <billing@wix.com>", VENDORS)).toBe("Wix");
    expect(matchVendor("Wixel Studio <hi@wixel.io>", VENDORS)).toBeNull();
    expect(matchVendor("Anthropic <invoice+statements@mail.anthropic.com>", VENDORS)).toBe("Claude pro");
    // Equal matches: the first listed wins — scan.ts lists the vendor's latest row first.
    expect(matchVendor("Anthropic <invoice+statements@mail.anthropic.com>", ["Claude", "Claude max", "Claude pro"])).toBe("Claude");
  });

  it("Google only from its billing senders, never a shared doc", () => {
    expect(matchVendor("Google Payments <payments-noreply@google.com>", VENDORS)).toBe("Google");
    expect(matchVendor("Dana (via Google Sheets) <drive-shares-dm-noreply@google.com>", VENDORS)).toBeNull();
  });

  it("never an invoicing platform other businesses send through", () => {
    expect(vendorTerms("חשבונית ירוקה")).toEqual({ match: [], search: [] });
    expect(matchVendor("חשבונית ירוקה <noreply@greeninvoice.co.il>", VENDORS)).toBeNull();
  });

  it("the search names each vendor once, quoted when it needs to be", () => {
    const q = searchQuery(VENDORS, null);
    expect(q).toContain("from:(figma OR claude OR anthropic OR ls.graphics OR cloudways OR digitalriver OR maxon OR payments-noreply@google.com OR workspace-noreply@google.com OR wix)");
    expect(q).toContain("newer_than:400d");
    expect(searchQuery(["Figma"], new Date("2026-11-01T00:00:00Z"))).toContain("after:1793491200");
  });
});

describe("what an email is", () => {
  it.each([
    ["Your payment to Figma failed", "", "failed"],
    ["Your payment couldn't be processed", "", "failed"],
    ["Your payment was declined - 1st Attempt", "", "failed"],
    ["Your Plan Will Be Suspended in 10 Days", "", "failed"],
    ["[Action needed] Your Claude API access is turned off", "", "failed"],
    ["Maxon Cancellation Request received 867764", "", "cancel"],
    ["Your subscription has changed to Plnty Pro (Monthly)", "", "plan"],
    ["Your Plnty Pro (Monthly) subscription has been renewed", "", "receipt"],
    ["Renewal receipt for order #4125923060.", "", "receipt"],
    ["[Action required] Your Figma subscription is about to renew", "", "renewal"],
    ["Please review: Your upcoming quarterly invoice", "", "renewal"],
    ["Your payment has been received.", "", "receipt"],
    ["Upcoming Price Change", "", "price"],
    ["Action required: update your payment method", "", "failed"],
    ["Your Dropbox subscription has been cancelled", "", "cancel"],
    ["Changes to our pricing", "Starting January, the Professional plan will cost", "price"],
    ["Your trial ends in 3 days", "", "trial"],
    ["Your Webflow site plan renews on Dec 20", "", "renewal"],
    ["Your receipt from Anthropic, PBC #2841-1102", "Receipt $75.00 Paid November 1", "receipt"],
    ["חשבונית מס קבלה 10234", "", "receipt"],
    ["Join us for a webinar on new pricing", "", "price"],
    ["Introducing Figma Sites", "Plans and invoices are easier now", null],
    ["Invitation: Weekly sync", "", null],
  ])("%s → %s", (subject, snippet, kind) => {
    expect(classify(subject, snippet)).toBe(kind);
  });
});

describe("the amount", () => {
  it.each([
    ["Receipt $75.00 Paid", { amount: 75, currency: "USD" }],
    ["Total: US$1,620.00", { amount: 1620, currency: "USD" }],
    ["סה״כ 2,967.36 ₪", { amount: 2967.36, currency: "ILS" }],
    ["Amount 46.10 EUR", { amount: 46.1, currency: "EUR" }],
    ["Your plan renews soon", null],
  ])("%s", (text, want) => {
    expect(amountIn(text)).toEqual(want);
  });
});
