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
 * The job titles a new profile may get — `profiles.position` is a KEY checked
 * by the database (`profiles_position_check`, added by hand), not free text:
 * "Designer" as typed is refused (hit on the first real conversion,
 * 2026-11-05). These are the keys profiles use today, minus "owner".
 */
export const POSITIONS = [
  { key: "designer", label: "Designer" },
  { key: "project_manager", label: "Project manager" },
  { key: "office_manager", label: "Office manager" },
] as const;
export type PositionKey = (typeof POSITIONS)[number]["key"];

/**
 * The position key a profile may be written with, or null.
 *
 * ⚠️ NEVER "owner". `profiles.position = 'owner'` is what makes someone the
 * studio owner — the vacation approver (0058) and the only reader of &advice
 * (0059) — and these routes write with the service key, past the 0021 trigger.
 * Anything not in `POSITIONS` is dropped, so the insert can't be refused.
 */
export function cleanPosition(raw: unknown): PositionKey | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim();
  return POSITIONS.some((p) => p.key === k) ? (k as PositionKey) : null;
}

/**
 * The position a candidate's role on the hiring board suggests — a guess the
 * form shows, which the admin can change. Null when nothing fits.
 */
export function positionFromRole(roleName: string | null | undefined): PositionKey | null {
  const r = (roleName ?? "").toLowerCase();
  if (/office/.test(r)) return "office_manager";
  if (/project|producer|account/.test(r)) return "project_manager";
  if (/design|art direct|illustrat|motion|brand/.test(r)) return "designer";
  return null;
}
