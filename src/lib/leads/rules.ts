// The stage-suggestion rules — Phase 3 without AI.
//
// Pure: given what just happened and where the lead stands, return the move
// worth suggesting, or null. The callers write the suggestion; the owner
// accepts or dismisses it. NOTHING HERE MOVES A LEAD.
//
// ⚠️ A SUGGESTION ONLY EVER POINTS FORWARD. Suggesting "Offer sent" to a lead
// already in Negotiation would be a step back dressed up as advice; every rule
// checks the target sits later on the board than the lead does now.

import type { LeadStage, StageRuleKey, SuggestionRule } from "./types";

export interface Suggestion {
  rule: SuggestionRule;
  toStageId: string;
  reason: string;
}

const byKey = (stages: LeadStage[], key: StageRuleKey) => stages.find((s) => s.ruleKey === key);
const byKind = (stages: LeadStage[], kind: "won" | "lost") => stages.find((s) => s.kind === kind);

/** Is `to` a real move forward from `from` among the open stages? */
function forward(from: LeadStage | undefined, to: LeadStage | undefined): to is LeadStage {
  if (!to) return false;
  if (!from) return true;
  if (from.id === to.id) return false;
  if (from.kind !== "open") return false;
  if (to.kind !== "open") return true; // won / lost are always reachable from an open stage
  return to.position > from.position;
}

/** An offer's status just changed (or an offer was added with this status). */
export function afterOfferStatus(
  status: string,
  version: number,
  current: LeadStage | undefined,
  stages: LeadStage[],
): Suggestion | null {
  if (status === "sent") {
    const to = byKey(stages, "offer_sent");
    if (forward(current, to) && to.kind === "open") {
      return { rule: "offer_sent", toStageId: to.id, reason: `Offer v${version} was marked as sent.` };
    }
  }
  if (status === "accepted") {
    const to = byKind(stages, "won");
    if (forward(current, to)) {
      return { rule: "offer_accepted", toStageId: to.id, reason: `Offer v${version} was accepted.` };
    }
  }
  if (status === "declined") {
    const to = byKind(stages, "lost");
    if (forward(current, to)) {
      return { rule: "offer_declined", toStageId: to.id, reason: `Offer v${version} was declined.` };
    }
  }
  return null;
}

export interface MailEvent {
  /** The client wrote after the lead entered its current stage (not a calendar notice). */
  replyFrom: string | null;
  replyAt: string | null;
  /** A calendar invite arrived on the thread (subject of the first one). */
  meeting: string | null;
}

/** New mail just landed on one of the lead's threads. */
export function afterMail(current: LeadStage | undefined, stages: LeadStage[], e: MailEvent): Suggestion | null {
  if (current?.ruleKey === "offer_sent" && e.replyFrom) {
    const to = byKey(stages, "negotiation");
    if (forward(current, to)) {
      return {
        rule: "client_replied",
        toStageId: to.id,
        reason: `${e.replyFrom} replied after the offer went out${e.replyAt ? ` (${e.replyAt.slice(0, 10)})` : ""}.`,
      };
    }
  }
  if (current?.ruleKey === "relevant" && e.meeting) {
    const to = byKey(stages, "discovery");
    if (forward(current, to)) {
      return { rule: "meeting_booked", toStageId: to.id, reason: `Meeting booked: ${e.meeting.slice(0, 120)}` };
    }
  }
  return null;
}
