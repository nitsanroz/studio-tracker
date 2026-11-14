import { describe, expect, it } from "vitest";
import type { AdviceData as MoneyData } from "@/lib/finance/advice/signals";
import { debtPace, freelancerMargin, lastMonthOf, scopeValue, type CrossFreelancer } from "./cross";
import type { Finding } from "./merge";
import type { AdviceData as StudioData } from "./signals";

// Made-up names and rates throughout.
const TODAY = "2026-11-14";

const studio = (over: Partial<StudioData> = {}): StudioData => ({
  today: TODAY,
  clients: [{ id: "lumen", name: "Lumen", billable: true, archived: false, hourCap: null, keysTaskId: null }],
  tasks: [
    { id: "t1", clientId: "lumen", sectionId: null, groupId: null, title: "Website", billable: true },
    { id: "keys", clientId: "lumen", sectionId: null, groupId: null, title: "Lumen keys", billable: false },
  ],
  sections: [],
  groups: [],
  entries: [],
  periods: [],
  reportLinks: [],
  estimates: [],
  pnl: [],
  pace: null,
  ...over,
});

const money = (rate: number | null = 300): MoneyData =>
  ({
    today: TODAY,
    rates: rate == null ? [] : [{ clientId: "lumen", clientCanon: "Lumen", rate, effectiveFrom: "2026-01-01", effectiveTo: null }],
  }) as unknown as MoneyData;

/** `hours` on `taskId` by `userId`, one entry a day from `from`. */
const logged = (taskId: string, userId: string, from: string, hours: number[]) =>
  hours.map((h, i) => ({ taskId, userId, date: `${from.slice(0, 8)}${String(Number(from.slice(8)) + i).padStart(2, "0")}`, minutes: h * 60 }));

describe("lastMonthOf", () => {
  it("is the last complete month, across a year's end too", () => {
    expect(lastMonthOf("2026-11-14")).toEqual({ key: "2026-10", name: "October" });
    expect(lastMonthOf("2027-01-03")).toEqual({ key: "2026-12", name: "December" });
  });
});

describe("scopeValue — work outside the estimate, in money", () => {
  const scope: Finding = {
    key: "scope:lumen:2026-09-01",
    signal: "scope",
    kind: "now",
    area: "Scope",
    clientId: "lumen",
    severity: 2,
    facts: { client: "Lumen", outsidePct: 22, outsideHours: 21, since: "2026-09-01", tasks: '"Investor deck"' },
    title: "Lumen: 22% of hours went to work outside the estimate",
    body: '"Investor deck" isn\'t in the published estimate — 21h since 2026-09-01.',
    reminder: true,
    href: "/clients/lumen",
    action: "Send an out-of-scope note",
  };

  it("adds what the hours are worth at the client's rate, on the same card", () => {
    const [f] = scopeValue([scope], money(300));
    expect(f.key).toBe(scope.key);
    expect(f.figure).toBe("₪6K");
    expect(f.facts).toMatchObject({ outsideHours: 21, rateIls: 300, valueIls: 6300 });
    expect(f.body).toContain("₪6,300");
    // The title is what Claude is sent: never an amount.
    expect(f.title).toBe(scope.title);
  });

  it("leaves the card as it was when the client has no rate, and other cards alone", () => {
    expect(scopeValue([scope], money(null))).toEqual([scope]);
    const cap = { ...scope, signal: "cap", key: "cap:lumen" };
    expect(scopeValue([cap], money(300))).toEqual([cap]);
  });
});

describe("freelancerMargin — a freelancer's cost against what their hours bring in", () => {
  const ab = (over: Partial<CrossFreelancer> = {}): CrossFreelancer => ({
    profileId: "ab",
    name: "Avi Bar",
    // Flat for the test: 250 an hour whatever the month's hours.
    terms: { currency: "ILS", rateHigh: 250, rateLow: 250, hoursLow: 50, hoursHigh: 150 },
    fx: 1,
    monthHours: 40,
    ...over,
  });
  const october = (taskId = "t1") => studio({ entries: logged(taskId, "ab", "2026-10-05", [8, 8, 4]) });

  it("is a heads-up from 75% of the income, with what is left", () => {
    // 20h × 250 = 5,000 cost; 20h × 300 = 6,000 billed → 83%.
    const [f] = freelancerMargin(october(), money(300), [ab()]);
    expect(f).toMatchObject({ key: "freelancer-margin:lumen:2026-10", signal: "freelancer-margin", kind: "heads", severity: 2, clientId: "lumen", figure: "₪1K left" });
    expect(f.facts).toMatchObject({ hours: 20, billableHours: 20, sharePct: 83, costIls: 5000, incomeIls: 6000 });
    expect(f.title).toBe("Lumen: freelance hours cost 83% of what they brought in (October)");
    expect(f.title).not.toMatch(/₪/);
    expect(f.body).toContain("Avi logged 20h");
  });

  it("is 'do now' when each hour loses money", () => {
    const [f] = freelancerMargin(october(), money(200), [ab()]);
    expect(f).toMatchObject({ kind: "now", severity: 3, figure: "−₪1K" });
  });

  it("prices in the freelancer's currency, at the month's sliding rate", () => {
    // 60 an hour at 100h+, in a currency worth 4 → 240 an hour: 4,800 against 6,000 → 80%.
    const euro = ab({ terms: { currency: "EUR", rateHigh: 70, rateLow: 60, hoursLow: 50, hoursHigh: 100 }, fx: 4, monthHours: 120 });
    expect(freelancerMargin(october(), money(300), [euro])[0].facts).toMatchObject({ costIls: 4800, sharePct: 80 });
  });

  it("stays quiet when the margin is healthy, the hours are few, there is no rate, or it isn't last month", () => {
    expect(freelancerMargin(october(), money(400), [ab()])).toEqual([]); // 63%
    expect(freelancerMargin(studio({ entries: logged("t1", "ab", "2026-10-05", [4]) }), money(200), [ab()])).toEqual([]);
    expect(freelancerMargin(october(), money(null), [ab()])).toEqual([]);
    expect(freelancerMargin(studio({ entries: logged("t1", "ab", "2026-11-02", [8, 8, 4]) }), money(200), [ab()])).toEqual([]);
    expect(freelancerMargin(october(), money(200), [])).toEqual([]);
  });

  it("counts hours written down to a non-billable task as cost with no income", () => {
    // 10h billable + 10h on the keys task: cost 5,000 against 3,000 billed.
    const data = studio({ entries: [...logged("t1", "ab", "2026-10-05", [5, 5]), ...logged("keys", "ab", "2026-10-12", [5, 5])] });
    expect(freelancerMargin(data, money(300), [ab()])[0].facts).toMatchObject({ hours: 20, billableHours: 10, costIls: 5000, incomeIls: 3000, sharePct: 167 });
  });

  it("ignores hours by people who aren't freelancers", () => {
    expect(freelancerMargin(studio({ entries: logged("t1", "dana", "2026-10-05", [8, 8, 8]) }), money(100), [ab()])).toEqual([]);
  });
});

describe("debtPace — the pace of hours against open debt", () => {
  const period = (label: string, dateFrom: string, dateTo: string, paid = false) => ({ clientId: "lumen", label, dateFrom, dateTo, hourCap: null, paid });
  const work = [
    ...logged("t1", "dana", "2026-08-03", [8, 8, 4]), // August: 20h
    ...logged("t1", "dana", "2026-09-07", [8, 8, 8, 6]), // September: 30h
    ...logged("t1", "dana", "2026-11-02", [6, 6]), // the last 30 days: 12h
  ];
  const aug = period("August 2026", "2026-08-01", "2026-08-31");
  const sep = period("September 2026", "2026-09-01", "2026-09-30");

  it("fires on two unpaid periods past their payment date while work goes on", () => {
    const [f] = debtPace(studio({ entries: work, periods: [aug, sep] }), money(300));
    expect(f).toMatchObject({ key: "debt:lumen", signal: "debt", kind: "now", clientId: "lumen", figure: "₪15K" });
    // 50h × 300 owed; 12h × 300 since.
    expect(f.facts).toMatchObject({ periods: 2, debtIls: 15000, recentHours: 12, recentIls: 3600 });
    expect(f.title).toBe("Lumen: 2 periods unpaid while the work goes on");
    expect(f.body).toContain("August 2026 and September 2026 are past their payment date");
  });

  it("fires on one period more than 45 days late — where the unpaid card has gone quiet", () => {
    // August, due 15 Sep on 14-day terms: 60 days late on 14 Nov.
    const [f] = debtPace(studio({ entries: work, periods: [aug] }), money(300));
    expect(f.facts).toMatchObject({ periods: 1, daysLate: 60, debtIls: 6000 });
    expect(f.title).toBe("Lumen: August 2026 is 60 days late and the work goes on");
  });

  it("leaves one period under 45 days late to the unpaid card", () => {
    expect(debtPace(studio({ entries: work, periods: [{ ...aug, paid: true }, sep] }), money(300))).toEqual([]);
  });

  it("stays quiet once the work has stopped, when a period has no rate, and for paid periods", () => {
    expect(debtPace(studio({ entries: work.slice(0, 7), periods: [aug, sep] }), money(300))).toEqual([]);
    expect(debtPace(studio({ entries: work, periods: [aug, sep] }), money(null))).toEqual([]);
    expect(debtPace(studio({ entries: work, periods: [{ ...aug, paid: true }, { ...sep, paid: true }] }), money(300))).toEqual([]);
  });

  it("gives a client on net+30 its own payment date", () => {
    // September on net+30: invoiced 1 Oct, due 5 Dec — not late on 14 Nov, so only August counts.
    const net = studio({ entries: work, periods: [aug, sep] });
    net.clients[0] = { ...net.clients[0], paymentTermsDays: 30, paymentTermsNet: true };
    const found = debtPace(net, money(300));
    expect(found.map((f) => f.facts.periods)).toEqual(found.length ? [1] : []);
  });

  it("is worse with three periods or more than 60 days late", () => {
    const jul = period("July 2026", "2026-07-01", "2026-07-31");
    const three = studio({ entries: [...logged("t1", "dana", "2026-07-06", [5]), ...work], periods: [jul, aug, sep] });
    expect(debtPace(three, money(300))[0].severity).toBe(3);
    expect(debtPace(studio({ entries: work, periods: [aug, sep] }), money(300))[0].severity).toBe(2);
  });
});
