// Scenarios (v1.29.0) — the owner's what-if page. Shared types for the pure
// engine (engine.ts), the baseline built from the data (baseline.ts), the
// decision catalogue (decisions.ts) and the company facts (facts.ts).
//
// Nitsan, 2026-11-11: "we are not sure what will happen and we can't predict
// the future based on the past, not these times." So nothing here forecasts
// demand from history: the three futures are HIS inputs; the past only shows
// as reference marks beside them.

import type { RateTerms } from "@/lib/finance/freelance-rate";

/** "YYYY-MM" */
export type Ym = string;
export type Currency = "ILS" | "EUR" | "USD";

export type FutureId = "bad" | "mid" | "good";
export const FUTURE_IDS: FutureId[] = ["bad", "mid", "good"];
export const FUTURE_LABEL: Record<FutureId, string> = { bad: "Bad", mid: "Middle", good: "Good" };

/** One possible future for demand. Hours are "today's hours": what the work
 * coming in would be sold as today, before AI or pricing changes. */
export interface Future {
  /** Work coming in a month, in today's sold hours. */
  hours: number;
  /** Change a month (−0.02 = 2% less each month). */
  drift: number;
  /** Project (non-hourly) income a month, ₪. */
  projectIncome: number;
}
export type Futures = Record<FutureId, Future>;

/** How a freelancer is priced, per hour in their own currency. */
export type Price =
  | { kind: "flat"; rate: number; currency: Currency }
  | { kind: "terms"; terms: RateTerms; currency: Currency };

export type MemberKind = "designer" | "staff" | "owner" | "freelancer";

/** Someone on the team today, worked out from the last 3 finished months. */
export interface Member {
  id: string;
  name: string;
  /** What the advisor (Claude) is told instead of the name. */
  initials: string;
  kind: MemberKind;
  /** Employees (designer/staff/owner): employer cost a month, ₪. A freelancer
   * with no hours known: their average pay, kept as a fixed amount. */
  monthlyCost: number;
  /** Client-work hours a month they can take (logged hours, Keys included).
   * Owner and staff are 0 here — their client hours are personal levers. */
  capacity: number;
  /** Averages a month over the base months. */
  hours: number;
  billable: number;
  keys: number;
  studio: number;
  /** Freelancers with hours: how they're priced. */
  price?: Price;
  /** Paid for hours later written down to Keys (today's default: yes). */
  paidWritedowns?: boolean;
}

export interface Baseline {
  /** The first month of the forecast (the month in progress). */
  start: Ym;
  /** The finished months the averages come from. */
  basedOn: Ym[];
  /** ₪ per sold hour: hourly income ÷ hours (as the Overview's hours goal). */
  rate: number;
  /** Share of logged client work written down to Keys. */
  keysShare: number;
  /** Sold hours a month, average over basedOn (the P&L's hours). */
  soldHours: number;
  projectIncome: number;
  team: Member[];
  /** Salaries not linked to anyone (P&L salaries less the people's). */
  otherPayroll: number;
  /** The P&L's Rent line a month (rent + its bills). */
  office: number;
  /** Monthly, yearly, misc, accounting, lawyer, Gur a month. */
  otherFixed: number;
  /** The owner's profile, gross salary (payslips), and employer cost ÷ gross. */
  ownerId: string | null;
  ownerGross: number | null;
  employerRatio: number;
  /** Default client hours a month for the owner and for the other staff
   * (Nitsan, 2026-11-10: "about 30 together" with Michal). */
  ownerHours: number;
  staffHours: number;
  /** ₪ per unit, the official rate + the bank's markup (fx.ts). */
  fx: { EUR: number; USD: number };
  /** Past demand, for reference marks only. */
  references: { label: string; hours: number }[];
  /** What the P&L booked over basedOn, a month — the "Today" check. */
  actual: { revenue: number; costs: number; profit: number; freelance: number };
  /** P&L profit from the company facts' date up to the last finished month
   * (work-month basis) — carried into retained earnings. */
  profitSinceFacts: number;
}

export interface CompanyFacts {
  /** Cash in the company's bank, and the day it's from. */
  cashToday: number;
  cashAsOf: string;
  /** What the owner owes the company (shareholder loan), and its yearly interest. */
  loan: number;
  loanAsOf: string;
  loanInterest: number;
  /** Retained earnings at loanAsOf (the report's date). */
  retained: number;
  /** Leasehold improvements left on the books — written off the day the studio is left. */
  leaseholdLeft: number;
  /** Equipment's book value — selling it for less is a loss in the P&L. */
  equipmentBook: number;
  /** A company tax refund expected, and when. */
  taxRefund: number;
  taxRefundMonth: Ym;
  corporateTax: number;
  dividendTax: number;
  /** Net salary ÷ gross, roughly — for "net at home". */
  netShare: number;
  /** The top of the salary bracket where salary beats dividend, a month. */
  bracketTop: number;
  /** The least the company should hold, ₪. null = two months of costs. */
  cashFloor: number | null;
  /** The least the owner needs at home a month, net. null = not set. */
  takeHomeFloor: number | null;
}
