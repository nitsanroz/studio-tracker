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

/** 'replaced': an approved request whose change was approved (0060). */
export type VacationStatus = "pending" | "approved" | "declined" | "cancelled" | "replaced";

export interface VacationRequest {
  id: string;
  profileId: string;
  startDate: string;
  endDate: string;
  days: number;
  message: string;
  status: VacationStatus;
  /** The exact days, once one was moved in the plan (0060); null = every
   * workday from startDate to endDate. */
  dates: string[] | null;
  /** A change to this approved request, waiting for the owner (0060). */
  replacesId: string | null;
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
export function workdays(from: string, to: string, dayStates: Pick<DayState, "dateFrom" | "dateTo">[]): string[] {
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

/** A request's days: its exact list when a day was moved in the plan, else
 * every workday in its range. Weekend and holiday days in a list cost nothing,
 * as in the database. */
export function requestDays(
  r: Pick<VacationRequest, "startDate" | "endDate" | "dates">,
  dayStates: Pick<DayState, "dateFrom" | "dateTo">[],
): string[] {
  if (!r.dates) return workdays(r.startDate, r.endDate, dayStates);
  return [...r.dates].sort().filter((d) => workdays(d, d, dayStates).length > 0);
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

/** Requests to leave out — the one being decided or edited, and for a change,
 * the approved request it replaces. */
type Except = string | string[] | undefined;
const skip = (except: Except, id: string) => (Array.isArray(except) ? except.includes(id) : except === id);

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
  except: Except,
  today: Date,
  planned: string[] = [],
  /** Run the months out at least this far ("2027-03"). */
  until?: string,
): { month: string; room: number }[] {
  const asOf = balanceAsOf(balance);
  const first = monthIndex(asOf) + 1;
  // A SET of days: an approved request's days are also vacation chips in the
  // plan, and must not count twice.
  const taken = new Set<string>();
  for (const r of requests) {
    if (skip(except, r.id) || (r.status !== "approved" && r.status !== "pending")) continue;
    requestDays(r, dayStates).forEach((d) => taken.add(d));
  }
  planned.forEach((d) => taken.add(d));
  extra.forEach((d) => taken.add(d));
  const perMonth = new Map<number, number>();
  for (const d of taken) {
    if (d <= asOf) continue;
    const i = monthIndex(monthKey(d));
    perMonth.set(i, (perMonth.get(i) ?? 0) + 1);
  }
  const last = Math.max(
    first,
    monthIndex(monthKey(toISODate(today))),
    until ? monthIndex(until) : first,
    ...perMonth.keys(),
  );
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
  /** Leave requests out — the one being decided or edited (and what it replaces). */
  exceptId?: Except,
  today = new Date(),
  /** Vacation days already in their plan column (see `plannedVacation`). */
  planned: string[] = [],
): Available {
  const asOf = balanceAsOf(balance);
  const approvedDays = new Set(planned.filter((d) => d > asOf));
  let pending = 0;
  for (const r of requests) {
    if (skip(exceptId, r.id)) continue;
    let days = requestDays(r, dayStates).filter((d) => d > asOf);
    if (r.status === "approved") days.forEach((d) => approvedDays.add(d));
    else if (r.status === "pending") {
      // A change waits on top of the approved days it replaces: only the days
      // it adds are new.
      const old = r.replacesId ? requests.find((x) => x.id === r.replacesId && x.status === "approved") : null;
      if (old) {
        const had = new Set(requestDays(old, dayStates));
        days = days.filter((d) => !had.has(d));
      }
      pending += days.length;
    }
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

/** What can be asked for in `month` ("2027-03"): the payslip's balance plus a
 * month's credit for every month up to and including it, less what's approved
 * or waiting by then — and never more than a later month can spare. So −1.4 on
 * a full-time September payslip is 2.6 by January, with nothing else booked. */
export function availableIn(
  balance: VacationBalance,
  requests: VacationRequest[],
  dayStates: DayState[],
  month: string,
  exceptId?: Except,
  today = new Date(),
  planned: string[] = [],
): number {
  const from = month < monthKey(toISODate(today)) ? monthKey(toISODate(today)) : month;
  const ahead = room(balance, requests, dayStates, [], exceptId, today, planned, from).filter((m) => m.month >= from);
  return ahead.length ? Math.min(...ahead.map((m) => m.room)) : balance.balance;
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
  exceptId?: Except,
  today = new Date(),
  planned: string[] = [],
): Fit {
  const months = room(balance, requests, dayStates, days, exceptId, today, planned);
  // ⚠️ Only from the request's own first month on. A month BEFORE it can't be
  // changed by it, so one that is already overbooked must not be blamed on it:
  // a February day once read "By December you'd be 1.4 days short" when
  // December was short with or without it (2026-10-24).
  const start = days.length ? monthKey(days[0]) : monthKey(toISODate(today));
  const bad = months.find((m) => m.month >= start && m.room < -1e-9);
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
