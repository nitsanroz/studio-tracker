import { describe, expect, it } from "vitest";
import { addMonths, chainsOf, liveTools, type Subscription } from "./tools";
import { fxFee, mailNotice, planNameOf, priceUp, receiptMismatch, renewalSoon, toolOverlap, type AdviceData, type ToolMail } from "./signals";
import { acceptReview, reviewPrompt } from "./review-prompt";
import { hasAmount } from "./redact";

const TODAY = "2026-11-05";
let n = 0;
/** One expense row: yearly by default, ₪ net = gross unless given. */
function sub(vendor: string, date: string, v: Partial<Subscription> = {}): Subscription {
  const gross = v.gross ?? v.netIls ?? 1000;
  return { id: `r${++n}`, vendor, description: "", category: "yearly", currency: "ILS", renewMonths: 12, date, endDate: null, netIls: v.netIls ?? gross, gross, ...v };
}
const data = (subscriptions: Subscription[]) => ({ today: TODAY, subscriptions }) as unknown as AdviceData;

describe("chains", () => {
  it("links each year's renewal and keeps parallel subscriptions of one vendor apart", () => {
    const rows = [
      sub("Wix", "2025-06-07", { description: "nmore" }),
      sub("Wix", "2025-09-03", { description: "portfolio" }),
      sub("Wix", "2026-06-07", { description: "nmore" }),
      sub("Wix", "2026-09-03", { description: "portfolio" }),
    ];
    const chains = chainsOf(rows, TODAY);
    expect(chains.map((c) => c.rows.length)).toEqual([2, 2]);
    expect(chains.map((c) => c.nextRenewal).sort()).toEqual(["2027-06-07", "2027-09-03"]);
  });

  it("uses a renewal already entered for a later date, and its price", () => {
    const [c] = chainsOf([sub("Everhour", "2025-12-18", { endDate: "2026-12-17", netIls: 2900 }), sub("Everhour", "2026-12-18", { netIls: 3200 })], TODAY);
    expect(c.nextRenewal).toBe("2026-12-18");
    expect(c.upcoming?.netIls).toBe(3200);
    expect(c.yearIls).toBe(3200);
    expect(c.priceChange).toBeCloseTo(3200 / 2900 - 1);
  });

  it("an ended subscription is not live and doesn't renew", () => {
    const rows = [sub("Framer Basic", "2026-06-01", { category: "monthly", renewMonths: 1, endDate: "2026-07-31" })];
    expect(liveTools(rows, TODAY)).toEqual([]);
  });

  it("a yearly renewal never entered, 45 days on, has lapsed (Envato's payment failed)", () => {
    const [envato] = chainsOf([sub("Envato", "2024-06-08", { currency: "USD", gross: 198 })], TODAY);
    expect(envato.live).toBe(false);
    expect(envato.nextRenewal).toBeNull();
    // Within the 45 days it may just not be entered yet.
    const [late] = chainsOf([sub("GoodSync", "2025-10-01")], TODAY);
    expect(late.live).toBe(true);
    expect(late.nextRenewal).toBe("2027-10-01");
  });

  it("one ending mid-term won't renew", () => {
    const [c] = chainsOf([sub("Vimeo", "2026-03-14", { endDate: "2026-12-01" })], TODAY);
    expect(c.live).toBe(true);
    expect(c.nextRenewal).toBeNull();
  });

  it("adds months, clamping the day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2025-12-18", 12)).toBe("2026-12-18");
  });
});

describe("renewalSoon", () => {
  it("flags a renewal in the next 45 days, with what does the same job; do now in the last ten", () => {
    const rows = [sub("Webflow", "2025-12-20", { netIls: 615 }), sub("Framer", "2026-08-04", { netIls: 1044 })];
    const [f] = renewalSoon(data(rows));
    expect(f.title).toBe("Webflow renews on 20 Dec");
    expect(f.kind).toBe("heads");
    expect(f.body).toContain("Framer does the same job");
    expect(f.focus).toBe(`row:${rows[0].id}`);
    expect(f.href).toBe("/finance/expenses?tab=yearly&year=2025");
    const late = renewalSoon({ ...data(rows), today: "2026-12-14" });
    expect(late[0].kind).toBe("now");
    expect(late[0].severity).toBeGreaterThan(f.severity);
  });

  it("says when the job is done in-house", () => {
    const [f] = renewalSoon(data([sub("Everhour", "2025-12-18", { netIls: 2967 })]));
    expect(f.body).toContain("studio tracker");
  });

  it("stays quiet past 45 days and under ₪200", () => {
    expect(renewalSoon(data([sub("Figma", "2026-07-08", { netIls: 4919 })]))).toEqual([]);
    expect(renewalSoon(data([sub("GoDaddy", "2025-12-01", { netIls: 58 })]))).toEqual([]);
  });

  it("offers to turn it off: the period ends the day before, a renewal entered for later goes", () => {
    // Wix's Happy Keto plan (Nitsan, 2026-11-06: "can't be turned off").
    const rows = [sub("Wix", "2024-12-01", { netIls: 3569, renewMonths: 24 })];
    const [f] = renewalSoon(data(rows));
    expect(f.title).toBe("Wix renews on 1 Dec");
    expect(f.fix).toEqual({ label: "Won't renew", done: "Wix won't renew — it ends 30 Nov", end: [{ id: rows[0].id, date: "2026-11-30" }] });
    // Once it ends before the renewal, it isn't renewing any more.
    expect(renewalSoon(data([{ ...rows[0], endDate: "2026-11-30" }]))).toEqual([]);
    const entered = [sub("Webflow", "2025-12-20", { netIls: 615, endDate: "2026-12-19" }), sub("Webflow", "2026-12-20", { netIls: 615 })];
    expect(renewalSoon(data(entered))[0].fix).toEqual({ label: "Won't renew", done: "Webflow won't renew — it ends 19 Dec", end: [{ id: entered[0].id, date: "2026-12-19" }], remove: [entered[1].id] });
    expect(renewalSoon(data([sub("Wix", "2024-12-01", { netIls: 3569, renewMonths: 24, state: "final" })]))[0].fix).toBeUndefined();
  });

  it("titles never carry an amount — they go to Claude", () => {
    const f = renewalSoon(data([sub("Digital River", "2025-12-11", { netIls: 2621, description: "Cinema 4D + Redshift — $650" })]));
    expect(hasAmount(f[0].title)).toBe(false);
  });
});

describe("toolOverlap", () => {
  const builders = [sub("Wix", "2026-06-07", { netIls: 3000 }), sub("Framer", "2026-08-04", { netIls: 1044 }), sub("Webflow", "2026-03-20", { netIls: 615 })];

  it("one card per job, figured as what keeping only the biggest saves", () => {
    const [f] = toolOverlap(data(builders));
    expect(f.title).toBe("Three website builders at once");
    expect(f.figure).toBe("up to ₪1,659/yr");
    expect(f.focus?.split(" ")).toHaveLength(3);
  });

  it("one paid tool is enough when the job is done in-house — unless its renewal card says it", () => {
    const far = toolOverlap(data([sub("Everhour", "2026-03-18", { netIls: 2967 })]));
    expect(far[0].title).toContain("done in-house");
    expect(toolOverlap(data([sub("Everhour", "2025-12-18", { netIls: 2967 })]))).toEqual([]);
  });

  it("leaves out what lapsed or won't renew (Nitsan, 2026-11-09: Artlist, ls.graphics, Envato)", () => {
    const stock = [
      sub("Artlist", "2025-12-02", { endDate: "2026-12-01", netIls: 650, description: "Music & SFX Pro" }),
      sub("Artlist", "2026-12-02", { netIls: 650, description: "Music & SFX Pro" }),
      sub("ls.graphics", "2025-12-01", { endDate: "2026-11-30", netIls: 430, description: "Mockups" }),
      sub("Envato", "2024-06-08", { netIls: 700 }),
    ];
    expect(toolOverlap(data(stock))).toEqual([]);
    // Still renewing, the same three are a card.
    const renewing = [stock[0], stock[1], sub("ls.graphics", "2026-02-01", { netIls: 430 }), sub("Envato", "2026-06-08", { netIls: 700 })];
    expect(toolOverlap(data(renewing))[0].title).toBe("Three stock libraries at once");
  });

  it("skips a set of tools another card already names", () => {
    const rows = [
      sub("Google", "2026-01-01", { category: "monthly", renewMonths: 1, netIls: 1000, description: "Google Workspace Business Plus" }),
      sub("Microsoft", "2026-08-25", { netIls: 419, description: "Microsoft 365 Family" }),
      sub("Dropbox", "2026-03-30", { netIls: 825 }),
    ];
    const titles = toolOverlap(data(rows)).map((f) => f.title);
    expect(titles).toContain("Three file storage and sharing tools at once");
    expect(titles).not.toContain("Two office suites at once");
  });
});

describe("priceUp and fxFee", () => {
  it("a renewal paid in the last 60 days for 25%+ more", () => {
    const rows = [sub("WeTransfer", "2025-10-17", { netIls: 400 }), sub("WeTransfer", "2026-10-17", { netIls: 900 })];
    const [f] = priceUp(data(rows));
    expect(f.title).toBe("WeTransfer's price went up at renewal");
    expect(f.figure).toBe("+₪500/yr");
  });

  it("the 5% card charge over foreign subscriptions, from ₪300 a year", () => {
    const rows = [sub("Google", "2026-01-01", { category: "monthly", renewMonths: 1, currency: "USD", gross: 306, netIls: 1050 })];
    const [f] = fxFee(data(rows));
    expect(f.figure).toBe("₪600/yr");
    expect(fxFee(data([sub("Mobbin", "2026-02-17", { currency: "USD", gross: 100, netIls: 400 })]))).toEqual([]);
  });
});

describe("the tools review", () => {
  const rows = [
    sub("Claude pro", "2026-08-01", { category: "monthly", renewMonths: 1, currency: "USD", gross: 75, netIls: 190, description: "Claude — 3 seats ($50 + $21.90)" }),
    sub("Everhour", "2025-12-18", { netIls: 2967 }),
  ];
  const tools = liveTools(rows, TODAY);

  it("Claude is sent names, plans, ranks and dates — never an amount", () => {
    const p = reviewPrompt(tools, { loggingTime: 9, onPayroll: 8 }, TODAY);
    expect(p).not.toMatch(/2967|2,967|190|\$50|21\.90/);
    expect(p).toContain("[amount]");
    const j = JSON.parse(p);
    expect(j.subscriptions[0]).toMatchObject({ vendor: "Everhour", costRank: 1, renews: "2026-12-18", job: ["Time tracking"] });
    expect(j.studio.doneInHouse[0]).toContain("studio tracker");
  });

  it("keeps only answers about a real tool, once each, with no amount", () => {
    const [everhour, claude] = [tools.find((t) => t.vendor === "Everhour")!, tools.find((t) => t.vendor === "Claude pro")!];
    const ok = { title: "Cancel Everhour", body: "The tracker replaced it.", alternative: "" };
    const kept = acceptReview(
      {
        summary: "",
        items: [
          { ref: everhour.id, verdict: "cancel", ...ok },
          { ref: everhour.id, verdict: "cancel", ...ok },
          { ref: "made-up", verdict: "cancel", ...ok },
          { ref: claude.id, verdict: "switch", title: "Move to Team", body: "Team is usually $25 a seat.", alternative: "Claude Team" },
        ],
      },
      tools,
    );
    expect(kept.map((k) => k.tool.vendor)).toEqual(["Everhour"]);
  });
});

describe("billing mail", () => {
  const mail = (vendor: string, kind: ToolMail["kind"], date: string, more: Partial<ToolMail> = {}): ToolMail => ({
    id: `m${++n}`,
    account: "office@studionmore.com",
    vendor,
    kind,
    date,
    subject: `${vendor} ${kind}`,
    amount: null,
    currency: null,
    ...more,
  });
  const withMail = (subscriptions: Subscription[], toolMail: ToolMail[]) => ({ ...data(subscriptions), toolMail }) as AdviceData;

  it("a failed payment is do-now; a price change names the renewal", () => {
    const rows = [sub("Figma", "2026-07-08", { netIls: 4919 })];
    const f = mailNotice(withMail(rows, [mail("Figma", "failed", "2026-11-02"), mail("Figma", "price", "2026-10-20")]));
    expect(f.map((x) => [x.kind, x.title])).toEqual([
      ["now", "Figma: billing needs attention"],
      ["heads", "Figma is changing its price"],
    ]);
    expect(f[1].body).toContain("before the renewal on 8 Jul");
    expect(f[0].focus).toBe(`row:${rows[0].id}`);
  });

  it("billing trouble a later receipt settled is quiet; only the latest receipt is priced", () => {
    const rows = [sub("Figma", "2026-07-08", { netIls: 4919 })];
    expect(mailNotice(withMail(rows, [mail("Figma", "failed", "2026-10-08"), mail("Figma", "receipt", "2026-10-11")]))).toEqual([]);
    const live = [sub("Supabase", "2026-01-01", { category: "monthly", renewMonths: 1, currency: "USD", gross: 25, netIls: 90 })];
    const usage = [mail("Supabase", "receipt", "2026-11-04", { amount: 25.13, currency: "USD" }), mail("Supabase", "receipt", "2026-10-04", { amount: 33.98, currency: "USD" })];
    expect(receiptMismatch(withMail(live, usage))).toEqual([]);
  });

  it("a cancellation Expenses still renews offers to remove the renewal, however old the mail", () => {
    // Everhour: cancelled in August, its December renewal still entered (the real case, 2026-11-05).
    const rows = [sub("Everhour", "2025-12-18", { endDate: "2026-12-17", netIls: 2967 }), sub("Everhour", "2026-12-18", { netIls: 2967 })];
    const [f, ...rest] = mailNotice(withMail(rows, [mail("Everhour", "cancel", "2026-08-05")]));
    expect(rest).toEqual([]);
    expect(f.title).toBe("Everhour was cancelled — Expenses still counts it");
    expect(f.body).toContain("renews it on 18 Dec");
    expect(f.figure).toBe("₪2,967");
    expect(f.fix).toEqual({
      label: "Remove the 18 Dec renewal",
      done: "Everhour's renewal is removed",
      remove: [rows[1].id],
      end: [{ id: rows[0].id, date: "2026-08-05" }],
    });
    expect(f.focus).toBe(`row:${rows[1].id}`);
    // …and the renewal card doesn't say it again.
    expect(renewalSoon(withMail(rows, [mail("Everhour", "cancel", "2026-08-05")]))).toEqual([]);
    expect(renewalSoon(data(rows)).length).toBe(1);
    // The fix rides in the card's facts, and never reaches Claude.
    expect(hasAmount(f.title)).toBe(false);
  });

  it("a yearly tool with no renewal entered is marked ended; a monthly one ends on the mail's day", () => {
    const yearly = [sub("Dropbox", "2026-03-30", { netIls: 825 })];
    const [y] = mailNotice(withMail(yearly, [mail("Dropbox", "cancel", "2026-09-01")]));
    expect(y.fix).toEqual({ label: "Mark it ended", done: "Dropbox is marked ended", end: [{ id: yearly[0].id, date: "2026-09-01" }] });
    const monthly = [sub("Plnty", "2026-09-01", { category: "monthly", renewMonths: 1, netIls: 400 })];
    const [m] = mailNotice(withMail(monthly, [mail("Plnty", "cancel", "2026-10-20")]));
    expect(m.fix).toEqual({ label: "End it on 20 Oct", done: "Plnty ends 20 Oct", end: [{ id: monthly[0].id, date: "2026-10-20" }] });
    expect(m.figure).toBe("₪400/mo");
    expect(mailNotice(withMail([], [mail("Dropbox", "cancel", "2026-11-01")]))).toEqual([]);
  });

  it("a monthly tool already ended after the cancellation mail (paid through the month) is not flagged", () => {
    // ls.graphics: mail on 8 Nov, end date 30 Nov entered on purpose (2026-11-20).
    const rows = [sub("ls.graphics", "2026-10-01", { category: "monthly", renewMonths: 1, endDate: "2026-11-30", netIls: 300 })];
    const on = (r: Subscription[]) => ({ ...withMail(r, [mail("ls.graphics", "cancel", "2026-11-08")]), today: "2026-11-20" }) as AdviceData;
    expect(mailNotice(on(rows))).toEqual([]);
    // …but without an end date it still offers one.
    const open = [sub("ls.graphics", "2026-10-01", { category: "monthly", renewMonths: 1, netIls: 300 })];
    expect(mailNotice(on(open)).length).toBe(1);
  });

  it("no fix when it was taken up again, is locked, or the vendor has several subscriptions", () => {
    const later = [sub("Plnty", "2026-09-01", { category: "monthly", renewMonths: 1 })];
    // A receipt after the cancellation: it's still being paid, so the plain card says so (recent mail only).
    const paid = mailNotice(withMail(later, [mail("Plnty", "cancel", "2026-10-20"), mail("Plnty", "receipt", "2026-11-03")]));
    expect(paid.map((x) => [x.title, x.fix])).toEqual([["Plnty says the subscription ended", undefined]]);
    // A period that started after the mail: renewed after all.
    const renewed = [sub("Wix", "2025-06-07"), sub("Wix", "2026-06-07")];
    expect(mailNotice(withMail(renewed, [mail("Wix", "cancel", "2026-06-02")]))).toEqual([]);
    const locked = [sub("Zoom", "2026-03-01", { state: "final" })];
    expect(mailNotice(withMail(locked, [mail("Zoom", "cancel", "2026-07-01")]))).toEqual([]);
    const two = [sub("Wix", "2026-06-07", { description: "nmore" }), sub("Wix", "2026-09-03", { description: "portfolio" })];
    expect(mailNotice(withMail(two, [mail("Wix", "cancel", "2026-10-20")])).map((x) => x.fix)).toEqual([undefined]);
  });

  it("billing trouble links to the vendor's own billing page when it's known", () => {
    const rows = [sub("Zoom", "2026-10-30", { netIls: 600 })];
    const [f] = mailNotice(withMail(rows, [mail("Zoom", "failed", "2026-10-31")]));
    expect([f.href, f.action]).toEqual(["https://zoom.us/billing", "Open Zoom's billing"]);
  });

  it("a renewal notice already on a renewal card isn't said twice", () => {
    const soon = [sub("Webflow", "2025-12-20", { netIls: 615 })];
    expect(mailNotice(withMail(soon, [mail("Webflow", "renewal", "2026-11-03")]))).toEqual([]);
    const ended = [sub("Vimeo", "2025-03-14", { netIls: 336, endDate: "2026-03-13" })];
    expect(mailNotice(withMail(ended, [mail("Vimeo", "renewal", "2026-11-03")]))[0].body).toContain("being paid for without being counted");
  });

  it("a receipt after the rows ended, or 10%+ over the row's price", () => {
    const ended = [sub("Framer Basic", "2026-06-01", { category: "monthly", renewMonths: 1, endDate: "2026-07-31", gross: 45 })];
    const [after] = receiptMismatch(withMail(ended, [mail("Framer Basic", "receipt", "2026-10-01", { amount: 45, currency: "ILS" })]));
    expect(after.title).toBe("Framer Basic charged after its subscription ended");
    expect(after.kind).toBe("now");

    const live = [sub("Claude pro", "2026-08-01", { category: "monthly", renewMonths: 1, currency: "USD", gross: 75, netIls: 280 })];
    const [over] = receiptMismatch(withMail(live, [mail("Claude pro", "receipt", "2026-11-01", { amount: 100, currency: "USD" })]));
    expect(over.title).toBe("Claude pro charged more than Expenses expects");
    expect(over.figure).toBe("+33%");
    // The same price, or a yearly charge against a monthly row, is no news.
    expect(receiptMismatch(withMail(live, [mail("Claude pro", "receipt", "2026-11-01", { amount: 75, currency: "USD" })]))).toEqual([]);
    expect(receiptMismatch(withMail(live, [mail("Claude pro", "receipt", "2026-11-01", { amount: 900, currency: "USD" })]))).toEqual([]);
  });

  it("a bigger plan is explained from the mail, with a fix from its first charge", () => {
    // The real case (2026-11-08): Plnty moved to 20,500 credits on 7 Sep; $175 on 3 Oct and 3 Nov against the $110 row.
    const rows = [sub("Plnty", "2026-09-01", { category: "monthly", renewMonths: 1, currency: "USD", gross: 110, netIls: 348.57 })];
    const box = { account: "nitsan@studionmore.com" };
    const toolMail = [
      mail("Plnty", "plan", "2026-09-07", { ...box, subject: "Your subscription has changed to Plnty Pro (Monthly) 20,500 credits" }),
      mail("Plnty", "receipt", "2026-10-03", { ...box, subject: "Your Plnty Pro (Monthly) 20,500 credits subscription has been renewed", amount: 175, currency: "USD" }),
      mail("Plnty", "receipt", "2026-11-03", { ...box, subject: "Your Plnty Pro (Monthly) 20,500 credits subscription has been renewed", amount: 175, currency: "USD" }),
    ];
    const [f, ...rest] = receiptMismatch(withMail(rows, toolMail));
    expect(rest).toEqual([]);
    expect(f.title).toBe("Plnty moved to a bigger plan — Expenses has the old price");
    expect(hasAmount(f.title)).toBe(false);
    expect(f.body).toContain('On 7 Sept Plnty wrote that the plan changed — to "Plnty Pro (Monthly) 20,500 credits"');
    expect(f.body).toContain("Since 3 Oct it charges $175 a month instead of the $110 on its row (2 charges so far)");
    expect(f.facts).toMatchObject({ since: "2026-10-03", charges: 2, planChanged: "yes", plan: "Plnty Pro (Monthly) 20,500 credits" });
    expect(f.fix).toEqual({
      label: "Change it to $175 from 3 Oct",
      done: "Plnty is $175 a month from 3 Oct",
      end: [{ id: rows[0].id, date: "2026-09-30" }],
      add: { like: rows[0].id, date: "2026-10-03", amount: 175, description: "Plnty Pro (Monthly) 20,500 credits" },
    });
    // A higher charge with no word of a new plan keeps the plain card, and no fix in the row's first month.
    const [plain] = receiptMismatch(withMail(rows, [mail("Plnty", "receipt", "2026-09-20", { amount: 175, currency: "USD" })]));
    expect(plain.title).toBe("Plnty charged more than Expenses expects");
    expect(plain.fix).toBeUndefined();
  });

  it("reads a plan's name from the vendor's subject lines", () => {
    expect(planNameOf("Your subscription has changed to Plnty Pro (Monthly) 20,500 credits")).toBe("Plnty Pro (Monthly) 20,500 credits");
    expect(planNameOf("Your Plnty Pro (Monthly) 20,500 credits subscription has been renewed")).toBe("Plnty Pro (Monthly) 20,500 credits");
    expect(planNameOf("You've upgraded to the Team plan")).toBe("Team");
    expect(planNameOf("Your receipt from Anthropic, PBC #2433")).toBeNull();
  });

  it("a receipt filed under a plan that ended is the vendor's plan still running", () => {
    // The real case (2026-11-08): Anthropic's mail matched "Claude max" (one month, June); the studio pays Pro seats since.
    const rows = [
      sub("Claude max", "2026-06-01", { category: "monthly", renewMonths: 1, currency: "USD", gross: 100, endDate: "2026-06-30" }),
      sub("Claude pro", "2026-08-01", { category: "monthly", renewMonths: 1, currency: "USD", gross: 75, netIls: 280 }),
    ];
    expect(receiptMismatch(withMail(rows, [mail("Claude max", "receipt", "2026-11-03", { amount: 75, currency: "USD" })]))).toEqual([]);
    // …and its price is still checked against the running plan.
    const [over] = receiptMismatch(withMail(rows, [mail("Claude max", "receipt", "2026-11-03", { amount: 100, currency: "USD" })]));
    expect(over.figure).toBe("+33%");
  });

  it("the review sees each vendor's latest mail, amounts stripped", () => {
    const tools = liveTools([sub("Figma", "2026-07-08", { netIls: 4919 })], TODAY);
    const p = JSON.parse(reviewPrompt(tools, { loggingTime: 9, onPayroll: 8 }, TODAY, [{ vendor: "Figma", kind: "receipt", date: "2026-10-11", subject: "Receipt for 3 seats — $1,923.16" }]));
    expect(p.subscriptions[0].recentMail).toEqual([{ kind: "receipt", date: "2026-10-11", subject: "Receipt for 3 seats — [amount]" }]);
  });
});
