// The logged hours one &advice check reads — fetched ONCE and handed to both
// sides. Each loader used to page `time_entries` for itself (the studio side
// six months in parallel, the money side four in series), which was most of
// what a pane open waited for.
//
// One query from whichever side reaches back furthest; each side then keeps
// exactly the rows its own query used to return (`studioEntries`,
// `moneyEntries`), so no rule sees a different set than before.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/db";
import { parseISO, shiftDays, toISODate } from "@/lib/format";

export interface EntryRow {
  task_id: string;
  user_id: string | null;
  date: string;
  minutes: number;
  legacy: boolean | null;
}

const shift = (today: string, n: number) => toISODate(shiftDays(parseISO(today), n));

/** Six whole months back plus this one: the pulse's billable-share line and the 90-day unpaid window. */
export function studioEntriesFrom(today: string): string {
  const d = parseISO(today);
  return toISODate(new Date(d.getFullYear(), d.getMonth() - 6, 1));
}

/** How far back a billing period may have ended and still be read by the money rules (net+30: 1 + 30 + 45 = 76, with room). */
export const PERIOD_REACH_DAYS = 100;

/**
 * Where the money side's hours start: four months back (the P&L's hours), 120
 * days (the per-day set), or the start of the earliest period it reads —
 * whichever is first.
 */
export function moneyEntriesFrom(today: string, periodStarts: string[]): string {
  const d = parseISO(today);
  const hoursFrom = toISODate(new Date(d.getFullYear(), d.getMonth() - 4, 1));
  const daysFrom = shift(today, -120);
  return periodStarts.reduce((min, from) => (from < min ? from : min), hoursFrom < daysFrom ? hoursFrom : daysFrom);
}

export interface SharedEntries {
  rows: EntryRow[];
  /** the date the fetch started from — a side asking for earlier rows must fetch its own */
  from: string;
}

/** Every entry either side reads, in one paged fetch. */
export async function loadSharedEntries(sb: SupabaseClient, today: string): Promise<SharedEntries> {
  // The money side reaches back to the start of any period that ended lately; a
  // long period can start before the studio side's six months.
  const periods = await fetchAll<{ date_from: string }>(sb, "client_billing_periods", "date_from", (q) => q.gte("date_to", shift(today, -PERIOD_REACH_DAYS)));
  const studioFrom = studioEntriesFrom(today);
  const moneyFrom = moneyEntriesFrom(
    today,
    periods.map((p) => String(p.date_from)),
  );
  const from = studioFrom < moneyFrom ? studioFrom : moneyFrom;
  // ~25 pages: in parallel, as boot does.
  const rows = await fetchAll<EntryRow>(sb, "time_entries", "task_id, user_id, date, minutes, legacy", (q) => q.gte("date", from).not("minutes", "is", null), { parallel: 4 });
  return { rows, from };
}

/** The studio side's set: its six months, logged hours only (recovered history is never put on a person). */
export function studioEntries(shared: SharedEntries, today: string): EntryRow[] {
  const from = studioEntriesFrom(today);
  return shared.rows.filter((e) => e.legacy === false && String(e.date) >= from);
}

/** The money side's set: everything from its own start, recovered history included — as its query always read. */
export function moneyEntries(shared: SharedEntries, from: string): EntryRow[] {
  return shared.rows.filter((e) => String(e.date) >= from);
}
