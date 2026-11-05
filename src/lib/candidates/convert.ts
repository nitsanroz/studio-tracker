// "Convert to…" a hired candidate (v1.90.0): into a team member (an account,
// through /api/admin/users) or a freelancer (a person with no login and a
// private log link, through /api/admin/freelancers "create"). Both routes take
// a `candidateId` and finish the hire server-side — `convert-server.ts`.
//
// Pure, so the page, the board and both routes read a conversion the same way.

import type { CandidateEvent } from "./types";

export type ConvertedAs = "member" | "freelancer";

/** The History event each conversion writes. `joined_team` predates this file (v1.85.0). */
export const CONVERT_EVENT: Record<ConvertedAs, string> = {
  member: "joined_team",
  freelancer: "became_freelancer",
};

/**
 * What a candidate was converted into, or null if they never were.
 *
 * ⚠️ THE EVENT IS READ FIRST, NOT THE PROFILE LINK, because 0061's
 * `candidates.profile_id` may not exist yet (unapplied as of 2026-11-05) and
 * the event is written either way. Without it, a converted candidate would
 * offer "Convert to…" again. The linked profile decides only when no event is
 * on hand: a person with no login (`hasAccount === false`) is a freelancer.
 * A profile not yet in the store (just made) reads as a member — the event
 * almost always settles it first.
 */
export function convertedAs(
  profileId: string | null,
  events: Pick<CandidateEvent, "kind">[],
  profile?: { hasAccount?: boolean } | null,
): ConvertedAs | null {
  for (const e of events) {
    if (e.kind === CONVERT_EVENT.member) return "member";
    if (e.kind === CONVERT_EVENT.freelancer) return "freelancer";
  }
  if (!profileId) return null;
  return profile?.hasAccount === false ? "freelancer" : "member";
}

/** Where the new record lives. */
export function convertedHref(as: ConvertedAs, profileId: string): string {
  return as === "freelancer" ? `/freelancers/${profileId}` : `/team/${profileId}`;
}

/**
 * The job title a new profile gets from the candidate's role, or null.
 *
 * ⚠️ NEVER "owner". `profiles.position = 'owner'` is what makes someone the
 * studio owner — the vacation approver (0058) and the only reader of &advice
 * (0059) — and these routes write with the service key, past the 0021 trigger.
 * A role named "Owner" on the hiring board must not hand that out.
 */
export function cleanPosition(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const p = raw.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!p || p.toLowerCase() === "owner") return null;
  return p;
}
