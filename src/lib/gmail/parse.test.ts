import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  extractText,
  externalParticipants,
  isRealMail,
  matchLead,
  parseAddresses,
  parseMessage,
  replyOwedBy,
  stripQuoted,
  type GmailMessage,
  type MatchCandidate,
} from "./parse";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const own = new Set(["nitsan@studionmore.com"]);

const msg = (over: Partial<GmailMessage> & { from: string; to?: string; date: string; text?: string; id?: string }): GmailMessage => ({
  id: over.id ?? "m1",
  threadId: "t1",
  labelIds: over.labelIds ?? ["INBOX"],
  internalDate: String(new Date(over.date).getTime()),
  snippet: "snip",
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: over.from },
      { name: "To", value: over.to ?? "nitsan@studionmore.com" },
      { name: "Subject", value: "Hello" },
      { name: "Message-ID", value: `<${over.id ?? "m1"}@mail>` },
    ],
    parts: [{ mimeType: "text/plain", body: { data: b64(over.text ?? "Hi there") } }],
  },
});

describe("parseAddresses", () => {
  it("reads names and bare addresses", () => {
    expect(parseAddresses('"Dana Cohen" <Dana@Acme.com>, bob@y.com')).toEqual([
      { email: "dana@acme.com", name: "Dana Cohen" },
      { email: "bob@y.com", name: null },
    ]);
  });

  it("does not split a quoted name with a comma", () => {
    expect(parseAddresses('"Cohen, Dana" <dana@acme.com>')).toEqual([{ email: "dana@acme.com", name: "Cohen, Dana" }]);
  });

  it("drops things that are not addresses", () => {
    expect(parseAddresses("undisclosed-recipients:;")).toEqual([]);
    expect(parseAddresses(null)).toEqual([]);
  });
});

describe("extractText", () => {
  it("prefers text/plain", () => {
    expect(
      extractText({
        parts: [
          { mimeType: "text/html", body: { data: b64("<p>html</p>") } },
          { mimeType: "text/plain", body: { data: b64("plain") } },
        ],
      }),
    ).toBe("plain");
  });

  it("falls back to stripped HTML", () => {
    expect(extractText({ mimeType: "text/html", body: { data: b64("<p>Hi&nbsp;<b>Dana</b></p><br>Bye") } })).toBe("Hi Dana\n\nBye");
  });

  it("never reads an attachment, even a text one", () => {
    expect(
      extractText({
        parts: [{ mimeType: "text/plain", filename: "notes.txt", body: { data: b64("secret") } }],
      }),
    ).toBe("");
  });
});

describe("stripQuoted", () => {
  it("cuts the quoted history", () => {
    expect(stripQuoted("Sounds good.\n\nOn Tue, 1 Oct 2026 at 10:00 Dana <d@x.com> wrote:\n> old")).toBe("Sounds good.");
  });

  it("cuts a Hebrew quote header", () => {
    expect(stripQuoted("מעולה\n\nבתאריך יום ג׳, 1 באוק׳ 2026 ב-10:00 מאת דנה <d@x.com>‏ כתבה:\n> ישן")).toBe("מעולה");
  });

  it("keeps a message that is only a forward", () => {
    expect(stripQuoted("-----Original Message-----\nhello")).toBe("-----Original Message-----\nhello");
  });
});

describe("parseMessage + replyOwedBy", () => {
  it("knows which side sent it", () => {
    expect(parseMessage(msg({ from: "Dana <dana@acme.com>", date: "2026-10-01T10:00:00Z" }), own).fromUs).toBe(false);
    expect(parseMessage(msg({ from: "michal@studionmore.com", date: "2026-10-01T10:00:00Z" }), own).fromUs).toBe(true);
    expect(parseMessage(msg({ from: "jobs@nmore.co", date: "2026-10-01T10:00:00Z" }), own).fromUs).toBe(true);
  });

  it("owes the reply to whoever did not write last", () => {
    const a = parseMessage(msg({ id: "a", from: "dana@acme.com", date: "2026-10-01T10:00:00Z" }), own);
    const b = parseMessage(msg({ id: "b", from: "nitsan@studionmore.com", to: "dana@acme.com", date: "2026-10-02T10:00:00Z" }), own);
    expect(replyOwedBy([a])).toBe("us");
    expect(replyOwedBy([b, a])).toBe("them");
    expect(replyOwedBy([])).toBeNull();
  });

  it("collects only outside participants", () => {
    const a = parseMessage(msg({ from: "dana@acme.com", to: "nitsan@studionmore.com, ron@acme.com", date: "2026-10-01T10:00:00Z" }), own);
    expect(externalParticipants([a], own).sort()).toEqual(["dana@acme.com", "ron@acme.com"]);
  });
});

describe("isRealMail", () => {
  it("skips drafts and spam", () => {
    expect(isRealMail(msg({ from: "x@y.com", date: "2026-10-01", labelIds: ["DRAFT"] }))).toBe(false);
    expect(isRealMail(msg({ from: "x@y.com", date: "2026-10-01", labelIds: ["SPAM"] }))).toBe(false);
    expect(isRealMail(msg({ from: "x@y.com", date: "2026-10-01", labelIds: ["INBOX"] }))).toBe(true);
  });
});

describe("matchLead", () => {
  const cand = (over: Partial<MatchCandidate>): MatchCandidate => ({
    leadId: "L",
    emails: [],
    domain: null,
    open: true,
    lastActivityAt: "2026-09-01",
    ...over,
  });

  it("matches a contact's email first", () => {
    const r = matchLead(["dana@acme.com"], [cand({ leadId: "A", domain: "acme.com" }), cand({ leadId: "B", emails: ["dana@acme.com"] })]);
    expect(r).toEqual({ leadId: "B", by: "email" });
  });

  it("falls back to the company domain", () => {
    expect(matchLead(["ron@acme.com"], [cand({ leadId: "A", domain: "acme.com" })])).toEqual({ leadId: "A", by: "domain" });
  });

  it("never matches on a personal domain", () => {
    expect(matchLead(["someone@gmail.com"], [cand({ leadId: "A", domain: "gmail.com" })])).toBeNull();
  });

  it("prefers the open lead, then the most recent", () => {
    const r = matchLead(
      ["dana@acme.com"],
      [
        cand({ leadId: "old-lost", emails: ["dana@acme.com"], open: false, lastActivityAt: "2026-09-30" }),
        cand({ leadId: "open", emails: ["dana@acme.com"], open: true, lastActivityAt: "2026-01-01" }),
      ],
    );
    expect(r?.leadId).toBe("open");
  });

  it("respects a thread unlinked by hand", () => {
    expect(matchLead(["dana@acme.com"], [cand({ leadId: "A", emails: ["dana@acme.com"] })], new Set(["A"]))).toBeNull();
  });
});

describe("calendar and snippets", () => {
  it("does not let an invite decide who owes the reply", () => {
    const ours = parseMessage(msg({ id: "a", from: "nitsan@studionmore.com", to: "dana@acme.com", date: "2026-10-01T10:00:00Z" }), own);
    const invite = msg({ id: "b", from: "dana@acme.com", date: "2026-10-02T10:00:00Z" });
    invite.payload!.headers!.find((h) => h.name === "Subject")!.value = "Invitation: Studio &more / Acme @ Wed 29 Apr";
    const inv = parseMessage(invite, own);
    expect(inv.isCalendar).toBe(true);
    expect(replyOwedBy([ours, inv])).toBe("them");
    expect(replyOwedBy([inv])).toBeNull();
  });

  it("spots a text/calendar part whatever the subject", () => {
    const m = msg({ id: "c", from: "dana@acme.com", date: "2026-10-02T10:00:00Z" });
    m.payload!.parts!.push({ mimeType: "text/calendar", body: { data: b64("BEGIN:VCALENDAR") } });
    expect(parseMessage(m, own).isCalendar).toBe(true);
  });

  it("decodes Gmail's escaped snippets", () => {
    expect(decodeEntities("Studio &amp;more &lt;nitsan@x.com&gt; it&#39;s")).toBe("Studio &more <nitsan@x.com> it's");
  });
});
