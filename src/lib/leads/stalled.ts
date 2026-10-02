// When a lead has gone quiet.
//
// ⚠️ STALLED IS A FLAG, NOT A STAGE — the PRD's rule. It turns on when a lead
// in an OPEN stage has had no activity for that stage's `stall_days`, and it
// clears itself the moment anything is logged, because `last_activity_at`
// moves. Nothing is stored; it is worked out on the page.
//
// ⚠️ BUSINESS DAYS ON THE STUDIO'S WEEK, Sun–Thu. Fri and Sat do not count —
// a lead that went quiet on Thursday afternoon has not been ignored for two
// days by Sunday morning. `isWorkDay` is the same rule the Timeline uses, so
// the two can never disagree about what a working day is.

import { isWorkDay, shiftDays } from "../gantt";
import type { Lead, LeadStage } from "./types";

const NO_OFF_DAYS = new Set<string>();

/** Midnight local time on the day `d` falls on. */
function dayOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Working days that have passed since `iso`, not counting the day itself.
 * Something logged this morning is 0. Something logged on Thursday is still 0
 * through the weekend and becomes 1 on Sunday.
 *
 * ⚠️ TODAY COUNTS AS SOON AS IT IS A WORKING DAY, not once it is over. For a
 * follow-up flag that is the useful reading: on Sunday morning you want to see
 * the lead you owe a reply to, not on Monday.
 */
export function quietWorkDays(iso: string, now: Date): number {
  const from = new Date(iso);
  if (Number.isNaN(from.getTime())) return 0;
  const start = dayOf(from);
  const end = dayOf(now);
  let n = 0;
  // 400 is more than a year of days — a hard stop for a bad timestamp.
  for (let d = shiftDays(start, 1), i = 0; d <= end && i < 400; d = shiftDays(d, 1), i++) {
    if (isWorkDay(d, NO_OFF_DAYS)) n++;
  }
  return n;
}

export function isStalled(lead: Lead, stage: LeadStage | undefined, now: Date): boolean {
  if (!stage || stage.kind !== "open" || !stage.stallDays) return false;
  return quietWorkDays(lead.lastActivityAt, now) >= stage.stallDays;
}

/** Whole calendar days since the lead entered its current stage. */
export function daysInStage(lead: Lead, now: Date): number {
  const from = new Date(lead.stageChangedAt);
  if (Number.isNaN(from.getTime())) return 0;
  return Math.max(0, Math.round((dayOf(now).getTime() - dayOf(from).getTime()) / 86_400_000));
}

/** A next step that is due today or earlier. */
export function isOverdue(lead: Lead, now: Date): boolean {
  if (!lead.nextStepDue) return false;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return lead.nextStepDue < today;
}
