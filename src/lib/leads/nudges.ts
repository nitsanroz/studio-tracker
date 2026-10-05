// Attention tips — the short, dark tooltips that float over a lead card on the
// board and over the matching tab on the lead page, saying what to do next:
// "Client waiting 5 days — reply", "Finish estimate v2".
//
// ⚠️ PURE. Which situations raise a tip and after how many days is Settings →
// Leads (`lead_settings.nudges`); `DEFAULT_NUDGES` is what applies before
// anything is saved. Dismissing is per viewer and per SITUATION (`key`): the tip
// comes back, full size, only when what it is about changes.

import type { Lead, LeadStage } from "./types";
import { isStalled, quietWorkDays } from "./stalled";

export type NudgeKind = "reply" | "overdue" | "offer" | "estimate" | "stalled" | "missing";

export interface NudgeRule {
  on: boolean;
  /** Days before it shows. Ignored by `stalled`, which uses each stage's own limit. */
  days: number;
}
export type NudgeSettings = Record<NudgeKind, NudgeRule>;

/** In priority order: the board shows only the first that applies. */
export const NUDGE_KINDS: { kind: NudgeKind; label: string; hint: string; hasDays: boolean }[] = [
  { kind: "reply", label: "Reply owed", hint: "The client wrote and nobody has answered", hasDays: true },
  { kind: "overdue", label: "Next step overdue", hint: "Days past the next step's due date", hasDays: true },
  { kind: "offer", label: "Offer waiting", hint: "An offer was sent and hasn't been answered", hasDays: true },
  { kind: "estimate", label: "Estimate unfinished", hint: "The newest estimate is still a draft, or waiting for approval", hasDays: true },
  { kind: "stalled", label: "Stalled", hint: "No activity past the stage's own limit (set per stage above)", hasDays: false },
  { kind: "missing", label: "No next step", hint: "Days in the stage without a next step", hasDays: true },
];

export const DEFAULT_NUDGES: NudgeSettings = {
  reply: { on: true, days: 2 },
  overdue: { on: true, days: 0 },
  offer: { on: true, days: 5 },
  estimate: { on: true, days: 3 },
  stalled: { on: true, days: 0 },
  missing: { on: true, days: 1 },
};

/** A saved value merged over the defaults, so a kind added later starts sensible. */
export function readNudgeSettings(v: unknown): NudgeSettings {
  const out = { ...DEFAULT_NUDGES };
  if (!v || typeof v !== "object") return out;
  for (const { kind } of NUDGE_KINDS) {
    const r = (v as Record<string, unknown>)[kind] as Partial<NudgeRule> | undefined;
    if (!r || typeof r !== "object") continue;
    out[kind] = {
      on: typeof r.on === "boolean" ? r.on : DEFAULT_NUDGES[kind].on,
      days: typeof r.days === "number" && Number.isFinite(r.days) && r.days >= 0 ? Math.round(r.days) : DEFAULT_NUDGES[kind].days,
    };
  }
  return out;
}

export interface Nudge {
  kind: NudgeKind;
  text: string;
  /** What the tip is about; a dismissal holds until this changes. */
  key: string;
  color: string;
}

export const NUDGE_COLOR: Record<NudgeKind, string> = {
  reply: "#e11d48",
  overdue: "#e11d48",
  offer: "#0b43ed",
  estimate: "#7c3aed",
  stalled: "#ca8a04",
  missing: "#ca8a04",
};

const DAY = 86_400_000;
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Whole calendar days from `iso` (a timestamp or a yyyy-mm-dd) to `now`. */
export function daysSince(iso: string, now: Date): number {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  if (Number.isNaN(t.getTime())) return 0;
  return Math.max(0, Math.round((midnight(now) - midnight(t)) / DAY));
}
const ago = (n: number) => (n === 0 ? "today" : n === 1 ? "1 day" : `${n} days`);
const clip = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Every tip that applies to one lead right now, most urgent first. Open stages only. */
export function nudgesFor(lead: Lead, stage: LeadStage | undefined, settings: NudgeSettings, now: Date): Nudge[] {
  if (lead.deletedAt || (stage && stage.kind !== "open")) return [];
  const out: Nudge[] = [];
  const add = (kind: NudgeKind, text: string, key: string) => out.push({ kind, text, key: `${kind}:${key}`, color: NUDGE_COLOR[kind] });
  const s = settings;

  if (s.reply.on && lead.replyOwedSince) {
    const n = daysSince(lead.replyOwedSince, now);
    if (n >= s.reply.days) add("reply", `Client waiting ${ago(n)} — reply`, lead.replyOwedSince);
  }
  if (s.overdue.on && lead.nextStep && lead.nextStepDue) {
    const n = daysSince(lead.nextStepDue, now);
    if (n > 0 && n >= s.overdue.days) add("overdue", `${n === 1 ? "1 day" : `${n} days`} late: ${clip(lead.nextStep)}`, lead.nextStepDue);
  }
  if (s.offer.on && lead.waitingOffer) {
    const n = daysSince(lead.waitingOffer.sentAt, now);
    if (n >= s.offer.days) add("offer", `Offer sent ${ago(n)} ago — follow up`, String(lead.waitingOffer.version));
  }
  if (s.estimate.on && lead.openEstimate) {
    const e = lead.openEstimate;
    if (daysSince(e.createdAt, now) >= s.estimate.days) {
      add("estimate", e.status === "draft" ? `Finish the estimate (v${e.version})` : `Estimate v${e.version} waits for approval`, `${e.version}:${e.status}`);
    }
  }
  if (s.stalled.on && isStalled(lead, stage, now)) {
    add("stalled", `Quiet ${quietWorkDays(lead.lastActivityAt, now)} work days — check in`, lead.lastActivityAt);
  }
  if (s.missing.on && !lead.nextStep && daysSince(lead.stageChangedAt, now) >= s.missing.days) {
    add("missing", "No next step — set one", lead.stageChangedAt);
  }
  return out;
}
