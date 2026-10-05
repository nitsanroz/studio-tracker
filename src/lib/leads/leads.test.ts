import { describe, expect, it } from "vitest";
import { isOverdue, isStalled, quietWorkDays } from "./stalled";
import { FX_FALLBACK_USD, isStale, latestRate, toIls, usdQuote } from "./fx";
import { domainOf, gmailThreadIdFromUrl, type Lead, type LeadStage } from "./types";
import { DEFAULT_NUDGES, daysSince, nudgesFor, readNudgeSettings } from "./nudges";

// 2026-10-01 is a Thursday; 10-02 Fri, 10-03 Sat, 10-04 Sun, 10-05 Mon.
const at = (d: string, t = "10:00") => new Date(`${d}T${t}:00`);

const lead = (lastActivityAt: string, extra: Partial<Lead> = {}): Lead => ({
  id: "l",
  company: "Acme",
  website: null,
  domain: null,
  source: null,
  stageId: "s",
  ownerId: null,
  estValue: null,
  currency: "ILS",
  askedFor: null,
  nextStep: null,
  nextStepDue: null,
  lostReasonId: null,
  lostNote: null,
  sheetRef: null,
  clientId: null,
  sectionId: null,
  wonAt: null,
  stageChangedAt: lastActivityAt,
  lastActivityAt,
  createdAt: lastActivityAt,
  primaryContact: null,
  gmailBackfilledAt: null,
  replyOwedSince: null,
  deletedAt: null,
  openEstimate: null,
  waitingOffer: null,
  ...extra,
});

const stage = (stallDays: number | null, kind: LeadStage["kind"] = "open"): LeadStage => ({
  id: "s",
  name: "Offer sent",
  position: 1,
  kind,
  stallDays,
  ruleKey: null,
  color: null,
  icon: null,
});

describe("quietWorkDays", () => {
  it("is 0 on the day of the activity", () => {
    expect(quietWorkDays(at("2026-10-01", "09:00").toISOString(), at("2026-10-01", "18:00"))).toBe(0);
  });

  it("skips Friday and Saturday", () => {
    const thu = at("2026-10-01").toISOString();
    expect(quietWorkDays(thu, at("2026-10-02"))).toBe(0);
    expect(quietWorkDays(thu, at("2026-10-03"))).toBe(0);
    expect(quietWorkDays(thu, at("2026-10-04"))).toBe(1);
    expect(quietWorkDays(thu, at("2026-10-05"))).toBe(2);
  });

  it("counts a full studio week as five", () => {
    expect(quietWorkDays(at("2026-10-01").toISOString(), at("2026-10-08"))).toBe(5);
  });

  it("is 0 for a bad timestamp", () => {
    expect(quietWorkDays("not a date", at("2026-10-08"))).toBe(0);
  });
});

describe("isStalled", () => {
  const thu = at("2026-10-01").toISOString();

  it("turns on at the stage's limit, not before", () => {
    expect(isStalled(lead(thu), stage(5), at("2026-10-07"))).toBe(false); // 4 days
    expect(isStalled(lead(thu), stage(5), at("2026-10-08"))).toBe(true); // 5 days
  });

  it("never fires in a stage without a limit", () => {
    expect(isStalled(lead(thu), stage(null), at("2026-12-01"))).toBe(false);
  });

  it("never fires on a won or lost lead", () => {
    expect(isStalled(lead(thu), stage(1, "won"), at("2026-12-01"))).toBe(false);
    expect(isStalled(lead(thu), stage(1, "lost"), at("2026-12-01"))).toBe(false);
  });

  it("is false when the stage is unknown", () => {
    expect(isStalled(lead(thu), undefined, at("2026-12-01"))).toBe(false);
  });
});

describe("isOverdue", () => {
  it("is overdue only from the day after the due date", () => {
    const l = lead(at("2026-10-01").toISOString(), { nextStepDue: "2026-10-04" });
    expect(isOverdue(l, at("2026-10-04"))).toBe(false);
    expect(isOverdue(l, at("2026-10-05"))).toBe(true);
  });

  it("is false with no due date", () => {
    expect(isOverdue(lead(at("2026-10-01").toISOString()), at("2027-01-01"))).toBe(false);
  });
});

describe("fx", () => {
  it("marks the official rate DOWN, because a lead is income", () => {
    const q = usdQuote({ official: 3.7, date: "2026-10-01" });
    expect(q.rate).toBeCloseTo(3.515);
    expect(toIls(1000, "USD", q)).toBeCloseTo(3515);
  });

  it("leaves shekels alone and null as null", () => {
    const q = usdQuote({ official: 3.7, date: "2026-10-01" });
    expect(toIls(1000, "ILS", q)).toBe(1000);
    expect(toIls(null, "USD", q)).toBeNull();
  });

  it("falls back to an already-bad rate with nothing stored", () => {
    expect(usdQuote(null).rate).toBe(FX_FALLBACK_USD);
    expect(usdQuote({ official: 0, date: "2026-10-01" }).rate).toBe(FX_FALLBACK_USD);
  });

  it("asks again only when the bank was last asked over half a day ago", () => {
    expect(isStale(null, at("2026-10-01"))).toBe(true);
    // Saturday: the newest rate is Thursday's, but we asked this morning.
    const sat = { official: 3.7, date: "2026-10-01", checkedAt: at("2026-10-03", "08:00").toISOString() };
    expect(isStale(sat, at("2026-10-03", "18:00"))).toBe(false);
    expect(isStale(sat, at("2026-10-04", "08:00"))).toBe(true);
    // An old row with no checkedAt falls back to the rate's own date.
    expect(isStale({ official: 3.7, date: "2026-10-01" }, at("2026-10-01", "10:00"))).toBe(false);
    expect(isStale({ official: 3.7, date: "2026-10-01" }, at("2026-10-02", "10:00"))).toBe(true);
  });

  it("reads the latest row of the Bank of Israel CSV", () => {
    const csv = [
      "SERIES_CODE,TIME_PERIOD,OBS_VALUE",
      "RER_USD_ILS,2026-09-29,3.71",
      "RER_USD_ILS,2026-10-01,3.69",
      "RER_USD_ILS,2026-09-30,3.70",
      "RER_USD_ILS,2026-10-02,",
    ].join("\n");
    expect(latestRate(csv)).toEqual({ official: 3.69, date: "2026-10-01" });
    expect(latestRate("nonsense")).toBeNull();
  });
});

describe("domainOf", () => {
  it("strips scheme, www and path", () => {
    expect(domainOf("https://www.Unibeam.com/about?x=1")).toBe("unibeam.com");
    expect(domainOf("unibeam.co.il")).toBe("unibeam.co.il");
  });

  it("takes the domain of an email address", () => {
    expect(domainOf("dana@unibeam.com")).toBe("unibeam.com");
  });

  it("refuses personal mail domains", () => {
    expect(domainOf("someone@gmail.com")).toBeNull();
    expect(domainOf("walla.co.il")).toBeNull();
  });

  it("refuses things that are not hosts", () => {
    expect(domainOf("")).toBeNull();
    expect(domainOf("Acme Ltd")).toBeNull();
    expect(domainOf(null)).toBeNull();
  });
});

describe("gmailThreadIdFromUrl", () => {
  it("reads the id after the folder", () => {
    expect(gmailThreadIdFromUrl("https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJWDsKvGbbbHbHlvJ")).toBe(
      "FMfcgzQXJWDsKvGbbbHbHlvJ",
    );
    expect(gmailThreadIdFromUrl("https://mail.google.com/mail/u/1/#label/Leads/18c2a9f0b1d2e3f4")).toBe(
      "18c2a9f0b1d2e3f4",
    );
  });

  it("is null for anything else", () => {
    expect(gmailThreadIdFromUrl("https://example.com/x")).toBeNull();
    expect(gmailThreadIdFromUrl("https://mail.google.com/mail/u/0/#inbox")).toBeNull();
  });
});

describe("nudgesFor", () => {
  const now = at("2026-10-05");
  const kinds = (l: Lead, st = stage(null)) => nudgesFor(l, st, DEFAULT_NUDGES, now).map((n) => n.kind);

  it("counts calendar days from a date or a timestamp", () => {
    expect(daysSince("2026-10-01", now)).toBe(4);
    expect(daysSince(at("2026-10-05", "08:00").toISOString(), now)).toBe(0);
  });

  it("puts a reply owed first", () => {
    const l = lead(at("2026-10-05").toISOString(), {
      nextStep: "Call",
      nextStepDue: "2026-10-01",
      replyOwedSince: at("2026-09-30").toISOString(),
      primaryContact: "Dana Levi",
    });
    const n = nudgesFor(l, stage(null), DEFAULT_NUDGES, now);
    expect(n.map((x) => x.kind)).toEqual(["reply", "overdue"]);
    expect(n[0].text).toBe("Client waiting 5 days — reply");
  });

  it("waits the configured days before a reply tip", () => {
    const l = lead(at("2026-10-05").toISOString(), { nextStep: "x", replyOwedSince: at("2026-10-04").toISOString() });
    expect(kinds(l)).toEqual([]);
  });

  it("flags an unfinished estimate and a sent offer after their days", () => {
    const l = lead(at("2026-10-05").toISOString(), {
      nextStep: "x",
      openEstimate: { version: 2, status: "draft", createdAt: at("2026-10-01").toISOString() },
      waitingOffer: { version: 1, sentAt: at("2026-09-28").toISOString() },
    });
    const n = nudgesFor(l, stage(null), DEFAULT_NUDGES, now);
    expect(n.map((x) => x.kind)).toEqual(["offer", "estimate"]);
    expect(n[1].text).toBe("Finish the estimate (v2)");
  });

  it("says nothing on a won or lost lead, or when a kind is off", () => {
    const l = lead(at("2026-09-01").toISOString());
    expect(kinds(l, stage(3, "won"))).toEqual([]);
    expect(kinds(l, stage(3))).toEqual(["stalled", "missing"]);
    const off = { ...DEFAULT_NUDGES, missing: { on: false, days: 1 } };
    expect(nudgesFor(l, stage(3), off, now).map((n) => n.kind)).toEqual(["stalled"]);
  });

  it("changes its key when the situation changes", () => {
    const a = nudgesFor(lead("2026-10-05", { nextStep: "x", nextStepDue: "2026-10-01" }), stage(null), DEFAULT_NUDGES, now);
    const b = nudgesFor(lead("2026-10-05", { nextStep: "x", nextStepDue: "2026-10-02" }), stage(null), DEFAULT_NUDGES, now);
    expect(a[0].key).not.toBe(b[0].key);
  });

  it("merges saved settings over the defaults", () => {
    const s = readNudgeSettings({ reply: { on: false, days: 4 }, offer: { days: -1 } });
    expect(s.reply).toEqual({ on: false, days: 4 });
    expect(s.offer).toEqual(DEFAULT_NUDGES.offer);
    expect(s.missing).toEqual(DEFAULT_NUDGES.missing);
  });
});
