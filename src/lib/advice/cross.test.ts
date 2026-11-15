import { describe, expect, it } from "vitest";
import type { AdviceData as MoneyData } from "@/lib/finance/advice/signals";
import { MIN_MONTH_HOURS, clientMargin, debtPace, freelancerMargin, lastMonthOf, oneCardEach, unbilledWork, withMoney, type CrossFreelancer } from "./cross";
import type { Finding } from "./merge";
import type { AdviceData as StudioData } from "./signals";

// Made-up names and rates throughout.
const TODAY = "2026-11-14";

const studio = (over: Partial<StudioData> = {}): StudioData => ({
  today: TODAY,
  entriesSince: "2026-05-01",
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

describe("withMoney — the studio's hour cards, in money", () => {
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
    const [f] = withMoney([scope], money(300));
    expect(f.key).toBe(scope.key);
    expect(f.figure).toBe("₪6K");
    expect(f.facts).toMatchObject({ outsideHours: 21, rateIls: 300, valueIls: 6300 });
    expect(f.body).toContain("₪6,300");
    // The title is what Claude is sent: never an amount.
    expect(f.title).toBe(scope.title);
  });

  it("leaves the card as it was when the client has no rate, and other cards alone", () => {
    expect(withMoney([scope], money(null))).toEqual([scope]);
    const overdue = { ...scope, signal: "overdue", key: "overdue:lumen" };
    expect(withMoney([overdue], money(300))).toEqual([overdue]);
  });

  const card = (signal: string, facts: Finding["facts"]): Finding => ({ ...scope, signal, key: `${signal}:lumen`, facts: { client: "Lumen", ...facts }, body: "Body." });

  it("prices last week's unreported hours", () => {
    const [f] = withMoney([card("report-due", { hours: 12.5 })], money(300));
    expect(f).toMatchObject({ figure: "₪4K", body: "Body. About ₪3,750 of work they haven't seen yet." });
  });

  it("prices only the hours OVER a cap, and nothing while under it", () => {
    // 120% of a 50h cap = 10h over.
    expect(withMoney([card("cap", { usedPct: 120, capHours: 50 })], money(300))[0].facts).toMatchObject({ valueIls: 3000 });
    const under = card("cap", { usedPct: 92, capHours: 50 });
    expect(withMoney([under], money(300))).toEqual([under]);
  });

  it("prices only the hours past the top of the estimate", () => {
    expect(withMoney([card("estimate", { hours: 46, estimated: "30–40h" })], money(300))[0].facts).toMatchObject({ valueIls: 1800 });
    expect(withMoney([card("estimate", { hours: 46, estimated: "40h" })], money(300))[0].figure).toBe("₪2K");
    const inside = card("estimate", { hours: 36, estimated: "30–40h" });
    expect(withMoney([inside], money(300))).toEqual([inside]);
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
    // On net+30 August (invoiced 1 Sep) is due 5 Nov — 9 days late — and September
    // (invoiced 1 Oct) is due 5 Dec, not late at all. One period, under 45 days: quiet.
    // The same two periods on 14-day terms are both late, and that fires (above).
    const net = studio({ entries: work, periods: [aug, sep] });
    net.clients[0] = { ...net.clients[0], paymentTermsDays: 30, paymentTermsNet: true };
    expect(debtPace(net, money(300))).toEqual([]);
    expect(debtPace(studio({ entries: work, periods: [aug, sep] }), money(300))).toHaveLength(1);
  });

  it("counts a long period that ended lately, and skips one whose hours aren't all loaded", () => {
    // June–August in one period: 78 days late on 14 Nov, started 166 days ago.
    const long = period("Summer 2026", "2026-06-01", "2026-08-31");
    expect(debtPace(studio({ entries: work, periods: [long] }), money(300))[0].facts).toMatchObject({ periods: 1, debtIls: 6000 });
    expect(debtPace(studio({ entries: work, periods: [long], entriesSince: "2026-07-01" }), money(300))).toEqual([]);
  });

  it("is worse with three periods or more than 60 days late", () => {
    const jul = period("July 2026", "2026-07-01", "2026-07-31");
    const three = studio({ entries: [...logged("t1", "dana", "2026-07-06", [5]), ...work], periods: [jul, aug, sep] });
    expect(debtPace(three, money(300))[0].severity).toBe(3);
    expect(debtPace(studio({ entries: work, periods: [aug, sep] }), money(300))[0].severity).toBe(2);
  });
});

describe("unbilledWork — hours with no billing period to invoice them from", () => {
  const period = (label: string, dateFrom: string, dateTo: string) => ({ clientId: "lumen", label, dateFrom, dateTo, hourCap: null, paid: true });
  const october = period("October 2026", "2026-10-01", "2026-10-31");
  const since = logged("t1", "dana", "2026-11-02", [6, 6]); // 12h since October ended

  it("fires once a week has passed since the last period and nothing covers today", () => {
    const [f] = unbilledWork(studio({ entries: since, periods: [october] }), money(300));
    expect(f).toMatchObject({ key: "unbilled:lumen", signal: "unbilled", kind: "heads", severity: 2, figure: "₪4K" });
    expect(f.facts).toMatchObject({ hours: 12, daysSince: 14, lastPeriod: "October 2026", valueIls: 3600 });
    expect(f.title).toBe("Lumen: 12h since October 2026 and no billing period open");
    expect(f.title).not.toMatch(/₪/);
  });

  it("is 'do now' from 30 days", () => {
    const september = period("September 2026", "2026-09-01", "2026-09-30");
    expect(unbilledWork(studio({ entries: since, periods: [september] }), money(300))[0]).toMatchObject({ kind: "now", severity: 3 });
  });

  it("stays quiet while a period is open, in the first week, under 10 hours, and with no rate", () => {
    const november = period("November 2026", "2026-11-01", "2026-11-30");
    expect(unbilledWork(studio({ entries: since, periods: [october, november] }), money(300))).toEqual([]);
    expect(unbilledWork(studio({ entries: since, periods: [period("Early Nov", "2026-11-01", "2026-11-10")] }), money(300))).toEqual([]);
    expect(unbilledWork(studio({ entries: since.slice(0, 1), periods: [october] }), money(300))).toEqual([]);
    expect(unbilledWork(studio({ entries: since, periods: [october] }), money(null))).toEqual([]);
  });

  it("speaks up for a client who never had a period", () => {
    const [f] = unbilledWork(studio({ entries: since }), money(300));
    expect(f).toMatchObject({ kind: "heads", title: "Lumen: 12h logged and no billing period at all" });
    expect(f.facts.daysSince).toBeNull();
  });

  it("counts only what a report would — the keys task is out", () => {
    const data = studio({ entries: [...since, ...logged("keys", "dana", "2026-11-04", [8])], periods: [october] });
    expect(unbilledWork(data, money(300))[0].facts.hours).toBe(12);
  });
});

describe("clientMargin — what a client leaves after the people who worked on it", () => {
  // Dana cost 16,000 in October and logged 160h → 100 an hour. Made-up figures.
  const dana = { profileId: "dana", costIls: 16_000 };
  const full = [...logged("t1", "dana", "2026-10-05", [8, 8, 8, 8, 8]), ...logged("other", "dana", "2026-10-12", [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8])];
  const withOther = (over: Partial<StudioData> = {}) => {
    const d = studio(over);
    d.tasks.push({ id: "other", clientId: "halo", sectionId: null, groupId: null, title: "Other client", billable: true });
    d.clients.push({ id: "halo", name: "Halo", billable: true, archived: false, hourCap: null, keysTaskId: null });
    return d;
  };

  it("is a heads-up when under a quarter is left", () => {
    // 40h × 100 = 4,000 of people's time; 40h × 120 = 4,800 billed → 17% left.
    const [f] = clientMargin(withOther({ entries: full }), money(120), [], [dana]);
    expect(f).toMatchObject({ key: "client-margin:lumen:2026-10", signal: "client-margin", kind: "heads", severity: 2, figure: "₪800 left" });
    expect(f.facts).toMatchObject({ hours: 40, billableHours: 40, leftPct: 17, incomeIls: 4800, costIls: 4000, freelanceIls: 0 });
    expect(f.title).toBe("Lumen left 17% after the people who worked on it (October)");
  });

  it("is 'do now' when the people cost more than the client paid", () => {
    const [f] = clientMargin(withOther({ entries: full }), money(80), [], [dana]);
    expect(f).toMatchObject({ kind: "now", severity: 3, figure: "−₪800", title: "Lumen cost more in people than it paid (October)" });
  });

  it("stays quiet with a healthy margin, under 20 hours, and with no rate", () => {
    expect(clientMargin(withOther({ entries: full }), money(300), [], [dana])).toEqual([]);
    expect(clientMargin(withOther({ entries: full.slice(0, 2) }), money(80), [], [dana])).toEqual([]);
    expect(clientMargin(withOther({ entries: full }), money(null), [], [dana])).toEqual([]);
  });

  it("never prices a thin month by its few hours", () => {
    // 24h logged in a month mostly away: 16,000 ÷ 24 would be 667 an hour; the floor makes it 200.
    const thin = withOther({ entries: logged("t1", "dana", "2026-10-05", [8, 8, 8]) });
    const [f] = clientMargin(thin, money(220), [], [dana]);
    expect(f.facts.costIls).toBe(Math.round((24 * 16_000) / MIN_MONTH_HOURS));
  });

  it("stays quiet when too many of the hours belong to someone whose cost isn't known", () => {
    const mixed = withOther({ entries: [...full, ...logged("t1", "owner", "2026-10-19", [8, 8])] }); // 16 of 56h unknown
    expect(clientMargin(mixed, money(80), [], [dana])).toEqual([]);
    const mostly = withOther({ entries: [...full, ...logged("t1", "owner", "2026-10-19", [4])] }); // 4 of 44h
    expect(clientMargin(mostly, money(80), [], [dana])).toHaveLength(1);
  });

  it("prices a sliding-rate freelancer at their rate, and says how much of the cost they are", () => {
    const ab: CrossFreelancer = { profileId: "ab", name: "Avi Bar", terms: { currency: "ILS", rateHigh: 250, rateLow: 250, hoursLow: 50, hoursHigh: 150 }, fx: 1, monthHours: 20 };
    const data = withOther({ entries: [...full, ...logged("t1", "ab", "2026-10-20", [8, 8, 4])] });
    // 4,000 (Dana) + 5,000 (AB) against 60h × 120 = 7,200.
    const [f] = clientMargin(data, money(120), [ab], [dana]);
    expect(f.facts).toMatchObject({ costIls: 9000, freelanceIls: 5000, incomeIls: 7200 });
    expect(f.body).toContain("of it freelancers");
  });

  it("carries the client's totals only — nothing that names or prices one person", () => {
    const [f] = clientMargin(withOther({ entries: full }), money(120), [], [dana]);
    expect(JSON.stringify(f)).not.toMatch(/dana|16000|16,000/i);
  });
});

describe("oneCardEach", () => {
  const f = (signal: string, clientId: string | null) => ({ signal, clientId, key: `${signal}:${clientId}` }) as Finding;
  it("drops a client's unpaid card when the debt card already counts that period", () => {
    const all = [f("unpaid", "lumen"), f("debt", "lumen"), f("unpaid", "halo"), f("cap", "lumen")];
    expect(oneCardEach(all).map((x) => x.key)).toEqual(["debt:lumen", "unpaid:halo", "cap:lumen"]);
  });
  it("drops a client's freelancer card when the client-margin card already counts them", () => {
    const all = [f("freelancer-margin", "lumen"), f("client-margin", "lumen"), f("freelancer-margin", "halo")];
    expect(oneCardEach(all).map((x) => x.key)).toEqual(["client-margin:lumen", "freelancer-margin:halo"]);
  });
});
