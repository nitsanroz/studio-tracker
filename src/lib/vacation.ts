// Vacation days: what an employee has left, and what a request would take.
//
// The balance comes from their latest payslip (finance-admin imports the
// payslips; `my_vacation()`, migration 0058, hands each person their own line).
// A payslip only knows the days taken up to its month, so requests after that
// month come off here — approved ones, and pending ones too, so nobody can ask
// for the same days twice. And every month after the payslip's credits its
// accrual (a day a month for a full position), so a request is judged against
// what they'll have BY ITS MONTH: 0 on September's payslip is 1 in October, 2 in
// November (Nitsan, 2026-10-13).
//
// ⚠️ `workdays` MUST COUNT EXACTLY AS THE DATABASE DOES (`vacation_workdays`,
// 0058): Sun–Thu, less the weekly plan's holiday day states. The database sets a
// request's `days` itself; this is only the preview in the form.

import { isWeekend, parseISO, shiftDays, toISODate } from "./format";
import type { DayState } from "./types";

export type VacationStatus = "pending" | "approved" | "declined" | "cancelled";

export interface VacationRequest {
  id: string;
  profileId: string;
  startDate: string;
  endDate: string;
  days: number;
  message: string;
  status: VacationStatus;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

/** A payslip's vacation account: days left after that month. */
export interface VacationBalance {
  year: number;
  month: number;
  balance: number;
  /** Days added a month (1 for full time). */
  accrued: number | null;
}

/** Workdays from `from` to `to`, inclusive: Sun–Thu, holidays out. */
export function workdays(from: string, to: string, dayStates: DayState[]): string[] {
  const out: string[] = [];
  if (!from || !to || to < from) return out;
  for (let d = parseISO(from); toISODate(d) <= to; d = shiftDays(d, 1)) {
    const iso = toISODate(d);
    if (isWeekend(d)) continue;
    if (dayStates.some((s) => iso >= s.dateFrom && iso <= s.dateTo)) continue;
    out.push(iso);
  }
  return out;
}

/** The last day of a payslip's month — what its balance already accounts for. */
export function balanceAsOf(b: Pick<VacationBalance, "year" | "month">): string {
  return toISODate(new Date(b.year, b.month, 0));
}

export interface Available {
  /** Left on the payslip. */
  balance: number;
  /** Credited each month after the payslip's (its own accrual: 1 for full time). */
  monthly: number;
  /** Approved days after the payslip's month, not on it yet — requests, and
   * vacation already marked in their plan column. */
  approved: number;
  /** Days asked for and not decided yet. */
  pending: number;
  /** What can be taken this month without leaving a later month short. */
  available: number;
}

const monthKey = (iso: string) => iso.slice(0, 7);
const monthIndex = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
const keyOf = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

/**
 * Month by month from the payslip on: what's been credited by the end of each
 * month (the balance, plus the monthly accrual for every month after the
 * payslip's) less every day taken by then — approved, waiting, and `extra`.
 * A month below zero is a month someone would be taking days they don't have.
 */
function room(
  balance: VacationBalance,
  requests: VacationRequest[],
  dayStates: DayState[],
  extra: string[],
  exceptId: string | undefined,
  today: Date,
  planned: string[] = [],
): { month: string; room: number }[] {
  const asOf = balanceAsOf(balance);
  const first = monthIndex(asOf) + 1;
  // A SET of days: an approved request's days are also vacation chips in the
  // plan, and must not count twice.
  const taken = new Set<string>();
  for (const r of requests) {
    if (r.id === exceptId || (r.status !== "approved" && r.status !== "pending")) continue;
    workdays(r.startDate, r.endDate, dayStates).forEach((d) => taken.add(d));
  }
  planned.forEach((d) => taken.add(d));
  extra.forEach((d) => taken.add(d));
  const perMonth = new Map<number, number>();
  for (const d of taken) {
    if (d <= asOf) continue;
    const i = monthIndex(monthKey(d));
    perMonth.set(i, (perMonth.get(i) ?? 0) + 1);
  }
  const last = Math.max(first, monthIndex(monthKey(toISODate(today))), ...perMonth.keys());
  const monthly = balance.accrued ?? 0;
  const out: { month: string; room: number }[] = [];
  let used = 0;
  for (let i = first; i <= last; i++) {
    used += perMonth.get(i) ?? 0;
    out.push({ month: keyOf(i), room: balance.balance + monthly * (i - first + 1) - used });
  }
  return out;
}

/** What's left to ask for this month: the payslip's balance, plus a month's
 * credit for each month since, less what's approved or waiting — and never more
 * than a later month can spare. */
export function availableDays(
  balance: VacationBalance,
  requests: VacationRequest[],
  dayStates: DayState[],
  /** Leave one request out — the one being decided or edited. */
  exceptId?: string,
  today = new Date(),
  /** Vacation days already in their plan column (see `plannedVacation`). */
  planned: string[] = [],
): Available {
  const asOf = balanceAsOf(balance);
  const approvedDays = new Set(planned.filter((d) => d > asOf));
  let pending = 0;
  for (const r of requests) {
    if (r.id === exceptId) continue;
    const days = workdays(r.startDate, r.endDate, dayStates).filter((d) => d > asOf);
    if (r.status === "approved") days.forEach((d) => approvedDays.add(d));
    else if (r.status === "pending") pending += days.length;
  }
  const approved = approvedDays.size;
  const now = monthKey(toISODate(today));
  const ahead = room(balance, requests, dayStates, [], exceptId, today, planned).filter((m) => m.month >= now);
  return {
    balance: balance.balance,
    monthly: balance.accrued ?? 0,
    approved,
    pending,
    available: ahead.length ? Math.min(...ahead.map((m) => m.room)) : balance.balance - approved - pending,
  };
}

export interface Fit {
  ok: boolean;
  /** The first month that would run short, and by how many days. */
  short: { month: string; by: number } | null;
  /** Days left at the end of the request's last month, with it taken. */
  leftAfter: number;
}

/** Whether `days` can be taken on top of everything approved or waiting. */
export function fitRequest(
  balance: VacationBalance,
  requests: VacationRequest[],
  dayStates: DayState[],
  days: string[],
  exceptId?: string,
  today = new Date(),
  planned: string[] = [],
): Fit {
  const months = room(balance, requests, dayStates, days, exceptId, today, planned);
  const bad = months.find((m) => m.room < -1e-9);
  const end = days.length ? monthKey(days[days.length - 1]) : monthKey(toISODate(today));
  const at = months.find((m) => m.month === end) ?? months[months.length - 1];
  return {
    ok: !bad,
    short: bad ? { month: bad.month, by: -bad.room } : null,
    leftAfter: at ? at.room : balance.balance,
  };
}

/** "9.5" / "10" / "−2.6" — days to one decimal, trailing zero dropped. */
export function formatDays(n: number): string {
  const r = Math.round(n * 10) / 10;
  return (r < 0 ? "−" : "") + String(Math.abs(r));
}

/** The vacation days already marked in a person's plan column — whether an
 * approved request put them there or someone typed them in before requests
 * existed. Either way they're days taken. */
export function plannedVacation(
  profileId: string | null,
  columns: { id: string; profileId: string | null; type: string }[],
  entries: { columnId: string; date: string | null; type: string; absenceType: string | null }[],
): string[] {
  const cols = new Set(columns.filter((c) => c.profileId === profileId && c.type === "member").map((c) => c.id));
  return entries
    .filter((e) => cols.has(e.columnId) && e.type === "absence" && e.absenceType === "vacation" && e.date)
    .map((e) => e.date!);
}
