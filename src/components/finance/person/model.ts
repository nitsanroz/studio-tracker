// What the person page works out once (page.tsx) and every tab reads.

import { studioDay } from "@/lib/finance/format";
import type { RateTerms } from "@/lib/freelance-rate";
import type { Advice, Efficiency, FactorLevels, GrossPay, HrNoteKind, Ledger, PayAdvice, PayslipMonth, Person, RaisePlan } from "@/lib/finance/people";

/** HR details the studio keeps in the tracker (member_hr, admin-only by RLS). */
export interface Hr {
  national_id: string | null;
  street: string | null;
  house_no: string | null;
  floor: string | null;
  apartment: string | null;
  zip: string | null;
  gender: string | null;
  birth_date: string | null;
  marital_status: string | null;
  city: string | null;
  phone: string | null;
  personal_email: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
}

/** One entry of their HR history (person_hr_notes): a dated event, a review
 * talk, or a note/comment carried over from the old Asana HR cards. */
export interface HrNote {
  id: string;
  kind: HrNoteKind;
  date: string | null;
  body: string;
  source: string;
}

export type PeriodId = "last" | "last3" | "last12";

/** One window of recent finished months, worked out every way the page needs. */
export interface Period {
  id: PeriodId;
  label: string;
  /** "YYYY-MM" keys, oldest first. */
  keys: string[];
  eff: Efficiency;
  pay: PayAdvice | null;
  gross: GrossPay | null;
}

export interface Recent {
  periods: Record<PeriodId, Period>;
  /** The 9 months before the last 3 — what recent months are compared with. */
  earlier: Efficiency;
  freelancer: boolean;
  /** Their average job share on the last 3 months' payslips. */
  jobShare: number | null;
  /** What their work supported each month they were paid ("YYYY-MM"), in
   * payslip salary — or, without payslips, cost (see supportedPayByMonth). */
  supported: { basis: "salary" | "cost"; byMonth: Map<string, number> };
  /** Whether, when and how much to raise their salary. */
  raise: RaisePlan | null;
  advice: Advice[];
}

export interface PersonModel {
  id: string;
  person: Person;
  /** Their logged hours are their own work (a designer), so efficiency and
   * pay-vs-work apply. */
  own: boolean;
  ledger: Ledger | undefined;
  /** The last finished month, "YYYY-MM". */
  upTo: string;
  slips: PayslipMonth[];
  notes: HrNote[];
  hr: Hr | null | undefined;
  /** Null while the studio's figures load. */
  recent: Recent | null;
  /** Their sliding hourly rate, if they're on one (Dima). */
  terms?: RateTerms;
  factors: Factors;
}

/** What they bring beyond their hours, as the owner rates it. */
export interface Factors {
  levels: FactorLevels;
  /** missing: reference/0009 hasn't run — the levels still work, unsaved. */
  state: "loading" | "ready" | "saving" | "saved" | "error" | "missing";
  set: (factor: keyof FactorLevels, level: number) => void;
}

/** The tracker, for links out of the person page (its team page, vacation). */
export const TRACKER_URL = "";

/** "2026-03" → "March 2026". */
export const MONTH_LONG = (key: string) =>
  new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

// `new Date("2024-03-01")` is UTC midnight, which a browser west of UTC shows as 29 Feb — so the
// date is built from its own parts (a timestamp is taken to its studio day first).
export const fmtDate = (iso: string | null) => {
  if (!iso) return null;
  const day = studioDay(iso);
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

/** The latest payslip, if any. */
export const latestSlip = (slips: PayslipMonth[]) => [...slips].sort((a, b) => a.year - b.year || a.month - b.month).at(-1);
