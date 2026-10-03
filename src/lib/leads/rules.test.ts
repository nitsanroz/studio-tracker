import { describe, expect, it } from "vitest";
import { afterMail, afterOfferStatus } from "./rules";
import type { LeadStage } from "./types";

const st = (id: string, position: number, kind: LeadStage["kind"], ruleKey: LeadStage["ruleKey"] = null): LeadStage => ({
  id,
  name: id,
  position,
  kind,
  stallDays: null,
  ruleKey,
  color: null,
  icon: null,
});
const stages = [
  st("rel", 1, "open", "relevant"),
  st("dis", 2, "open", "discovery"),
  st("prep", 3, "open", "offer_prep"),
  st("sent", 4, "open", "offer_sent"),
  st("neg", 5, "open", "negotiation"),
  st("won", 6, "won"),
  st("lost", 7, "lost"),
];
const s = (id: string) => stages.find((x) => x.id === id);

describe("afterOfferStatus", () => {
  it("suggests Offer sent when an offer goes out from an earlier stage", () => {
    expect(afterOfferStatus("sent", 2, s("prep"), stages)).toMatchObject({ rule: "offer_sent", toStageId: "sent" });
  });

  it("never points backwards", () => {
    expect(afterOfferStatus("sent", 2, s("neg"), stages)).toBeNull();
    expect(afterOfferStatus("sent", 2, s("sent"), stages)).toBeNull();
  });

  it("suggests Won / Lost from any open stage", () => {
    expect(afterOfferStatus("accepted", 1, s("neg"), stages)?.toStageId).toBe("won");
    expect(afterOfferStatus("declined", 1, s("sent"), stages)?.toStageId).toBe("lost");
  });

  it("says nothing on a closed lead or a draft", () => {
    expect(afterOfferStatus("accepted", 1, s("won"), stages)).toBeNull();
    expect(afterOfferStatus("draft", 1, s("prep"), stages)).toBeNull();
  });

  it("finds a renamed stage by its rule key", () => {
    const renamed = stages.map((x) => (x.id === "sent" ? { ...x, name: "Quote out" } : x));
    expect(afterOfferStatus("sent", 1, s("prep"), renamed)?.toStageId).toBe("sent");
  });
});

describe("afterMail", () => {
  it("suggests Negotiation when the client answers an offer", () => {
    expect(afterMail(s("sent"), stages, { replyFrom: "Dana", replyAt: "2026-10-01T10:00:00Z", meeting: null })).toMatchObject({
      rule: "client_replied",
      toStageId: "neg",
    });
  });

  it("suggests Discovery when a meeting is booked on a Relevant lead", () => {
    expect(afterMail(s("rel"), stages, { replyFrom: null, replyAt: null, meeting: "Invitation: Intro call" })?.toStageId).toBe("dis");
  });

  it("ignores mail in other stages", () => {
    expect(afterMail(s("dis"), stages, { replyFrom: "Dana", replyAt: null, meeting: "x" })).toBeNull();
  });
});
