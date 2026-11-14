"use server";

import { createClient } from "@/lib/supabase/server";
import {
  fetchAll,
  mapClientMonthly,
  mapClientRate,
  mapExpense,
  mapFreelance,
  mapIncome,
  mapSalary,
  type ClientMonthlyRow,
  type ClientRateRow,
  type ExpenseRowDb,
  type FreelanceRowDb,
  type IncomeRowDb,
  type SalaryRowDb,
} from "@/lib/finance/db";
import { LINE, isForecastMonth, rollupCurrentYear, round2, type HoursCell } from "@/lib/finance/finance";
import { getFinanceAccess } from "@/lib/finance/finance-access";
import { studioToday } from "@/lib/finance/format";
import { EXPENSE_LINES, planHoursCells } from "@/lib/finance/plan-model";
import { buildFxTable, monthEndRates, type FxRow } from "@/lib/finance/fx";
import { billFor } from "@/lib/freelance-rate";
import type { GoalInputs } from "@/lib/hours-goal";
import { goalInputs, slidingRateFreelancers } from "@/lib/hours-goal-server";

const BOI_SERIES = (currency: "USD" | "EUR", from: string, to: string) =>
  `https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_${currency}_ILS?startperiod=${from}&endperiod=${to}&format=csv`;

/**
 * Fetch the Bank of Israel representative rates for `year` (month-end, or the
 * latest so far for the current month) and store them in fx_rates as the
 * OFFICIAL rate — fx.ts adds the bank/card markup when converting.
 * Best-effort by design: a failed fetch or write is reported, never thrown,
 * so a recompute still runs on whatever rates are already stored.
 */
async function refreshFxRates(sb: Sb, year: number): Promise<{ months: number; error?: string }> {
  const today = studioToday();
  if (`${year}-01-01` > today) return { months: 0 };
  const to = `${year}-12-31` < today ? `${year}-12-31` : today;
  try {
    const [usd, eur] = await Promise.all(
      (["USD", "EUR"] as const).map(async (c) => {
        const res = await fetch(BOI_SERIES(c, `${year}-01-01`, to), { cache: "no-store" });
        if (!res.ok) throw new Error(`Bank of Israel ${c}: HTTP ${res.status}`);
        return monthEndRates(await res.text(), year);
      }),
    );
    const months = [...new Set([...usd.keys(), ...eur.keys()])];
    if (months.length === 0) return { months: 0, error: "Bank of Israel returned no rates" };
    const rows = months.map((month) => ({
      year,
      month,
      usd_ils: usd.get(month) ?? null,
      eur_ils: eur.get(month) ?? null,
      fetched_at: new Date().toISOString(),
    }));
    const { error } = await sb.from("fx_rates").upsert(rows, { onConflict: "year,month" });
    if (error) return { months: 0, error: `fx_rates: ${error.message}` };
    return { months: months.length };
  } catch (e) {
    return { months: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

type Sb = Awaited<ReturnType<typeof createClient>>;

/** Assert the caller is the finance "super admin"; return their Supabase
 * client. Every action here is Plan-page-only (rollup, tracker hours, gap
 * fixes) — none of it belongs to an expenses-only tracker admin. See
 * lib/finance-access.ts for why this checks `finance_full_access` and not
 * just `profiles.role` — a bare role==='admin' check would pass for anyone
 * with tracker admin (e.g. Michal), and since Server Actions are
 * independently callable POST endpoints regardless of which page rendered
 * the button, that would let an expenses-only admin bypass the whole point
 * of finance_full_access. */
async function adminClient() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { isAdmin } = await getFinanceAccess(sb, user.id);
  if (!isAdmin) throw new Error("Finance is owner-only");
  return { sb, userId: user.id };
}

interface TaskLite {
  id: string;
  client_id: string | null;
  billable: boolean;
}
interface ClientLite {
  id: string;
  name: string;
  billable: boolean;
}
interface EntryLite {
  task_id: string;
  date: string;
  minutes: number | null;
}

/** A month's first and last day ("YYYY-MM-DD"). */
function monthBounds(year: number, month: number): { first: string; last: string } {
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  return { first: `${ym}-01`, last: `${ym}-${new Date(year, month, 0).getDate()}` };
}

/**
 * Live-year hours from the tracker, bucketed by client + month.
 * Only billable tasks of billable clients count (mirrors the tracker's revenue
 * definition). Returns HoursCell[] — the exact shape rollupCurrentYear expects.
 * clientCanon = the client's name (the analysis key that matches client_rates).
 */
export async function getTrackerHoursForYear(year: number): Promise<HoursCell[]> {
  const { sb } = await adminClient();
  return trackerHoursBetween(sb, year);
}

/** Hours logged in the tracker so far in one month, per client (tracker
 * name) — the "(13)" beside the current month's Plan cells. Billable work
 * only, the same hours "Sync tracker hours" would bring in. */
export async function getTrackerHoursForMonth(year: number, month: number): Promise<Record<string, number>> {
  const { sb } = await adminClient();
  const out: Record<string, number> = {};
  for (const e of await billableEntriesForMonth(sb, year, month)) out[e.client] = (out[e.client] ?? 0) + e.hours;
  return out;
}

/**
 * What the Overview's hours goal needs from the tracker for one month:
 * - `absent`: designers away on each day, from the weekly plan ("2026-10-18" →
 *   1) — any absence (vacation, sick, day off) in a designer's column, counted
 *   once per designer per day;
 * - `freelancers`: freelancers paid by the hour they log in the tracker (a
 *   finance_freelance row linked to a tracker profile), with their pay and
 *   hours in the 3 months before, their hours so far this month and their own
 *   days away — so the goal can cost them at their pace, not the flat plan.
 */
export async function getGoalInputs(year: number, month: number): Promise<GoalInputs> {
  const { sb } = await adminClient();
  // The queries themselves are the tracker's (lib/hours-goal-server.ts) — one copy,
  // run here with the viewer's own session. Today's billable hours ride along:
  // the pace leaves them out until 17:30.
  const today = studioToday();
  const thisMonth = today.startsWith(monthBounds(year, month).first.slice(0, 7));
  const [inputs, hoursToday] = await Promise.all([
    goalInputs(sb, year, month),
    thisMonth
      ? billableEntriesForMonth(sb, year, month).then((es) => es.filter((e) => e.date === today).reduce((t, e) => t + e.hours, 0))
      : 0,
  ]);
  return { ...inputs, hoursToday };
}

/**
 * This month so far for each freelancer kept in the tracker (AB, Milica, Dima):
 * hours logged and what they come to in ₪ — their sliding rate plus charges, at
 * the month's official rate, the same figure the hours goal costs them at. The
 * Freelance page shows it in brackets beside the planned amount. Matched to a
 * row by profile, else by name (AB's rows aren't linked).
 */
export async function getFreelanceTracked(
  year: number,
  month: number,
): Promise<{ profileId: string; name: string; hours: number; cost: number }[]> {
  const { sb } = await adminClient();
  const { first, last } = monthBounds(year, month);
  const people = await slidingRateFreelancers(sb, year, month, first, last, new Map());
  return people.map((f) => ({
    profileId: f.profileId ?? "",
    name: f.name,
    hours: f.soFar,
    cost: (billFor(f.soFar, f.terms) + f.charges) * f.fx,
  }));
}

/** One month's time entries that count as billable work (billable task of a
 * billable client), with the client's tracker name. */
async function billableEntriesForMonth(
  sb: Sb,
  year: number,
  month: number,
): Promise<{ client: string; date: string; hours: number }[]> {
  // Polled every minute while the Plan is open, so it reads only this month's
  // entries and the tasks/clients they touch — not the tracker's whole task list.
  const { first, last } = monthBounds(year, month);
  const entries = await fetchAll<EntryLite>(sb, "time_entries", "task_id, date, minutes", (q) =>
    q.gte("date", first).lte("date", last).not("minutes", "is", null),
  );
  const taskIds = [...new Set(entries.map((e) => e.task_id))];
  const chunks: string[][] = [];
  for (let i = 0; i < taskIds.length; i += 100) chunks.push(taskIds.slice(i, i + 100));
  const tasks = (
    await Promise.all(chunks.map((chunk) => fetchAll<TaskLite>(sb, "tasks", "id, client_id, billable", (q) => q.in("id", chunk))))
  ).flat();
  const clientIds = [...new Set(tasks.map((t) => t.client_id).filter((c): c is string => !!c))];
  const clientRows = clientIds.length
    ? await fetchAll<ClientLite>(sb, "clients", "id, name, billable", (q) => q.in("id", clientIds))
    : [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const clientById = new Map(clientRows.map((c) => [c.id, c]));
  const out: { client: string; date: string; hours: number }[] = [];
  for (const e of entries) {
    const task = taskById.get(e.task_id);
    if (!task || !task.billable || !task.client_id) continue;
    const client = clientById.get(task.client_id);
    if (!client || !client.billable) continue;
    out.push({ client: client.name, date: e.date, hours: (e.minutes ?? 0) / 60 });
  }
  return out;
}

/** The whole of `year`'s billable tracker hours, by client + month. */
async function trackerHoursBetween(sb: Sb, year: number): Promise<HoursCell[]> {
  const [tasks, clients, entries] = await Promise.all([
    fetchAll<TaskLite>(sb, "tasks", "id, client_id, billable"),
    fetchAll<ClientLite>(sb, "clients", "id, name, billable"),
    fetchAll<EntryLite>(sb, "time_entries", "task_id, date, minutes", (q) =>
      q.gte("date", `${year}-01-01`).lte("date", `${year}-12-31`).not("minutes", "is", null),
    ),
  ]);

  const clientById = new Map(clients.map((c) => [c.id, c]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // (clientId|month) → minutes
  const acc = new Map<string, { clientId: string; canon: string; month: number; minutes: number }>();
  for (const e of entries) {
    if (e.minutes == null) continue;
    const task = taskById.get(e.task_id);
    if (!task || !task.billable || !task.client_id) continue;
    const client = clientById.get(task.client_id);
    if (!client || !client.billable) continue;
    const month = Number(e.date.slice(5, 7));
    const key = `${client.id}|${month}`;
    const cur = acc.get(key);
    if (cur) cur.minutes += e.minutes;
    else acc.set(key, { clientId: client.id, canon: client.name, month, minutes: e.minutes });
  }

  return [...acc.values()].map((r) => ({
    year,
    month: r.month,
    clientId: r.clientId,
    clientCanon: r.canon,
    hours: r.minutes / 60,
  }));
}

/**
 * The tasks behind one client's hours in one month — for the Plan grid's hover
 * card. Same definition as the synced hours: billable tasks of that client
 * (by name, so an old duplicate client record still counts), minutes logged in
 * that month. Returns the biggest tasks first.
 */
export async function getClientMonthTasks(
  clientCanon: string,
  year: number,
  month: number,
): Promise<{ title: string; hours: number }[]> {
  const { sb } = await adminClient();
  const clients = await fetchAll<ClientLite>(sb, "clients", "id, name, billable", (q) => q.eq("name", clientCanon));
  const ids = clients.filter((c) => c.billable).map((c) => c.id);
  if (ids.length === 0) return [];
  const tasks = await fetchAll<{ id: string; title: string; billable: boolean }>(sb, "tasks", "id, title, billable", (q) =>
    q.in("client_id", ids),
  );
  const billable = tasks.filter((t) => t.billable);
  if (billable.length === 0) return [];
  const { first, last } = monthBounds(year, month);
  // The month's entries studio-wide (a few hundred rows), filtered here — an
  // .in() over every task id of a big client would make the URL too long.
  const entries = await fetchAll<EntryLite>(sb, "time_entries", "task_id, date, minutes", (q) =>
    q.gte("date", first).lte("date", last).not("minutes", "is", null),
  );
  const ours = new Set(billable.map((t) => t.id));
  const byTask = new Map<string, number>();
  for (const e of entries) {
    if (ours.has(e.task_id)) byTask.set(e.task_id, (byTask.get(e.task_id) ?? 0) + (e.minutes ?? 0));
  }
  const title = new Map(billable.map((t) => [t.id, t.title]));
  return [...byTask.entries()]
    .map(([id, minutes]) => ({ title: title.get(id) ?? "(task)", hours: minutes / 60 }))
    .filter((t) => t.hours > 0)
    .sort((a, b) => b.hours - a.hours);
}

/** Human-readable label for a P&L line-item code, for gap notifications. */
const LINE_LABELS: Record<string, string> = {
  total_revenues: "Total revenues",
  total_expenses: "Total expenses",
  profit: "Profit",
  profit_pct: "Profit %",
  total_hours: "Total hours",
  total_hours_income: "Hours income",
  total_project_income: "Project income",
  average_taarif: "Average rate",
  salaries: "Salaries",
  freelance_salaries: "Freelance",
  rent_expenses: "Rent expenses",
  expenses_other: "Other expenses",
  expenses_monthly: "Monthly expenses",
  expenses_yearly: "Yearly expenses",
  expenses_misc: "Misc expenses",
  expenses_accounting: "Accounting",
  expenses_lawyer: "Lawyer",
  expenses_gur: "Gur",
  investments: "Investments",
  min_hours_to_be: "Min hours to break even",
  income_in_hours: "Income in hours",
};

export interface LockedGap {
  month: number;
  lineItem: string;
  lineLabel: string;
  storedValue: number;
  freshValue: number;
  delta: number;
}

/** Are this year's stored exchange rates missing or over 12 hours old? */
async function fxStale(sb: Sb, year: number): Promise<boolean> {
  const { data } = await sb
    .from("fx_rates")
    .select("fetched_at")
    .eq("year", year)
    .order("fetched_at", { ascending: false })
    .limit(1);
  const last = (data?.[0] as { fetched_at?: string } | undefined)?.fetched_at;
  return !last || Date.now() - new Date(last).getTime() > 12 * 3600_000;
}

/**
 * Recompute the current year's finance_pnl_monthly rows from the granular entry
 * tables + tracker hours, and upsert them.
 *
 * SAFETY (HANDOFF gotcha #1): only rolls up months that HAVE granular data, and
 * NEVER overwrites rows whose source='import' AND state='final' (a genuinely
 * locked, reviewed row). Rows are written with source='rollup'. average_taarif
 * is derived, never input.
 *
 * Locked rows are skipped for the WRITE, but still checked: if the fresh
 * computation disagrees with what's stored (e.g. underlying entries changed
 * after the month was locked), that's reported back as a `gap` so the UI can
 * show it and offer to update it — rather than silently going stale forever.
 */
export async function runRollup(
  year: number,
  opts: { auto?: boolean } = {},
): Promise<{ monthsWritten: number; gaps: LockedGap[]; fxError?: string }> {
  // A closed year is kept as booked: recounting it from detail rows that were
  // never meant to add up to the books (old sheets' combined lines, grants,
  // their own formulas) only writes noise over it.
  if (year < new Date().getFullYear()) return { monthsWritten: 0, gaps: [] };
  const { sb } = await adminClient();
  // Fresh exchange rates first (this year, plus last year for yearly renewals
  // paid then that still cover months of this year). An automatic run (page
  // open, after an edit) asks the Bank of Israel only when the stored rates
  // are over 12 hours old.
  let fxResult: { months: number; error?: string } = { months: 0 };
  if (!opts.auto || (await fxStale(sb, year))) {
    [fxResult] = await Promise.all([refreshFxRates(sb, year), year - 1 >= 2026 ? refreshFxRates(sb, year - 1) : null]);
  }
  const fxRows = await fetchAll<FxRow>(sb, "fx_rates", "*", (q) => q.gte("year", year - 3).lte("year", year));

  const expenseCols =
    "id, date, end_date, category, vendor, description, amount_gross, amount_no_vat, currency, vat_included, renew_months, recurrence, link, notes, state";
  const [ratesRows, incomeRows, salaryRows, freelanceRows, expenseRows, priorYearlyRows, runningMonthlyRows, planRows] = await Promise.all([
    fetchAll<ClientRateRow>(sb, "client_rates", "id, client_id, client_canon, rate, effective_from, effective_to, note"),
    fetchAll<IncomeRowDb>(sb, "finance_income", "id, date, client_id, source, amount, description, state", (q) =>
      q.gte("date", `${year}-01-01`).lte("date", `${year}-12-31`),
    ),
    fetchAll<SalaryRowDb>(sb, "finance_salaries", "id, profile_id, employee_name, year, month, gross_amount, state, notes", (q) =>
      q.eq("year", year),
    ),
    fetchAll<FreelanceRowDb>(sb, "finance_freelance", "id, person_name, role, year, month, amount, rate_note, state, notes", (q) =>
      q.eq("year", year),
    ),
    fetchAll<ExpenseRowDb>(sb, "finance_expenses", expenseCols, (q) =>
      q.gte("date", `${year}-01-01`).lte("date", `${year}-12-31`),
    ),
    // Yearly renewals paid in earlier years still cover some of this year's
    // months once spread (up to a 3-year plan) — rollupCurrentYear keeps only
    // the share that lands in `year`.
    fetchAll<ExpenseRowDb>(sb, "finance_expenses", expenseCols, (q) =>
      q.eq("category", "yearly").gte("date", `${year - 3}-01-01`).lte("date", `${year - 1}-12-31`),
    ),
    // A monthly subscription entered in an earlier year that still runs into
    // this one counts every month it runs (rollupCurrentYear's window) — left
    // out, a subscription started in 2026 would cost ₪0 in 2027's P&L. These
    // rows don't mark months as "having data": only the rows above do.
    fetchAll<ExpenseRowDb>(sb, "finance_expenses", expenseCols, (q) =>
      q.eq("category", "monthly").lte("date", `${year - 1}-12-31`).or(`end_date.is.null,end_date.gte.${year}-01-01`),
    ),
    // ⚠️ The hours and hourly income come from the PLAN, not the tracker's log
    // (Nitsan, 2026-11-10): what was approved or typed there is what counts, so
    // the Plan's Total income and the P&L agree. `planHoursCells` prices each
    // client-month as the Plan's rollup does (booked revenue on a final month).
    fetchAll<ClientMonthlyRow>(sb, "finance_client_monthly", "id, year, month, client_id, client_canon, discipline, sub_account, hours, rate, revenue_gross, state, comment", (q) =>
      q.eq("year", year),
    ),
  ]);
  const hours = planHoursCells(planRows.map(mapClientMonthly), ratesRows.map(mapClientRate), year);

  const rollup = rollupCurrentYear({
    year,
    hours,
    rates: ratesRows.map(mapClientRate),
    income: incomeRows.map(mapIncome),
    salaries: salaryRows.map(mapSalary),
    freelance: freelanceRows.map(mapFreelance),
    expenses: [...priorYearlyRows, ...runningMonthlyRows, ...expenseRows].map(mapExpense),
    fx: buildFxTable(fxRows),
  });

  // Which months actually have granular data? (guard: don't zero empty months)
  const monthsWithData = new Set<number>();
  for (const s of salaryRows) monthsWithData.add(s.month);
  for (const f of freelanceRows) monthsWithData.add(f.month);
  for (const e of expenseRows) monthsWithData.add(Number(e.date.slice(5, 7)));
  for (const i of incomeRows) monthsWithData.add(Number(i.date.slice(5, 7)));
  for (const h of hours) if (h.hours > 0) monthsWithData.add(h.month);

  // Existing rows for this year: never touch a row that's genuinely locked
  // (source='import' AND state='final'). A seeded row that's still 'predicted'
  // is forecast filler, not reviewed data — it must stay refreshable, or the
  // Plan/Overview would freeze at whatever the original seed guessed forever.
  const existing = await fetchAll<{ year: number; month: number; line_item: string; value: number; source: string; state: string }>(
    sb,
    "finance_pnl_monthly",
    "year, month, line_item, value, source, state",
    (q) => q.eq("year", year),
  );
  const lockedRows = existing.filter((r) => r.source === "import" && r.state === "final");
  const importedKeys = new Set(lockedRows.map((r) => `${r.month}|${r.line_item}`));

  // Re-derive each month's totals over the same lines the Plan grid sums
  // (EXPENSE_LINES). The ledger alone is not the whole picture: some lines
  // (Accounting, Gur) exist only as P&L rows with no ledger behind them, and
  // totalling the ledger alone left them out — every recomputed month stored a
  // Total expenses ₪2,457 short of the grid's own total. A line the ledger DOES
  // produce uses the fresh value even when its stored row is locked, so the
  // totals stay consistent with the per-line gaps reported below.
  const stored = new Map(existing.map((r) => [`${r.month}|${r.line_item}`, r]));
  for (const [month, lines] of rollup) {
    const valueOf = (lineItem: string): number => {
      if (lines.has(lineItem)) return lines.get(lineItem)!;
      // A stored row the ledger doesn't produce counts only if somebody entered
      // or imported it; an old rollup value nothing produces any more is stale.
      const row = stored.get(`${month}|${lineItem}`);
      return row && row.source !== "rollup" ? Number(row.value) : 0;
    };
    const exp = EXPENSE_LINES.reduce((sum, l) => sum + valueOf(l.key), 0);
    const rev = valueOf(LINE.totalRevenues);
    const rate = valueOf(LINE.avgRate);
    const profit = rev - exp;
    lines.set(LINE.totalExpenses, exp);
    lines.set(LINE.profit, profit);
    lines.set(LINE.profitPct, rev ? profit / rev : 0);
    lines.set(LINE.minHoursBE, rate ? exp / rate : 0);
    lines.set(LINE.incomeInHours, rate ? rev / rate : 0);
  }

  const upserts: {
    year: number;
    month: number;
    line_item: string;
    value: number;
    state: string;
    source: string;
  }[] = [];
  for (const [month, lines] of rollup) {
    if (!monthsWithData.has(month)) continue;
    // The ONE definition of "is this month still a plan" — see finance.ts's
    // isForecastMonth doc comment. It must stay excluded from "actuals"
    // aggregations (summarizeYear etc.) until reviewed/finalized.
    const state = isForecastMonth(year, month) ? "predicted" : "actual";
    for (const [lineItem, value] of lines) {
      if (importedKeys.has(`${month}|${lineItem}`)) continue; // preserve locked (final) rows
      upserts.push({
        year,
        month,
        line_item: lineItem,
        value: round2(value),
        state,
        source: "rollup",
      });
    }
  }

  if (upserts.length > 0) {
    const { error } = await sb
      .from("finance_pnl_monthly")
      .upsert(upserts, { onConflict: "year,month,line_item" });
    if (error) throw new Error(`rollup upsert: ${error.message}`);
  }

  // Check every locked row against what the fresh computation would say. A
  // gap here means the underlying entries changed since the month was locked
  // (e.g. a corrected expense, a rate fix) — surface it instead of leaving the
  // locked figure quietly stale.
  const gaps: LockedGap[] = [];
  for (const row of lockedRows) {
    const lines = rollup.get(row.month);
    if (!lines || !lines.has(row.line_item)) continue;
    const fresh = round2(lines.get(row.line_item)!);
    const stored = round2(Number(row.value));
    const delta = round2(fresh - stored);
    if (Math.abs(delta) >= 0.01) {
      gaps.push({
        month: row.month,
        lineItem: row.line_item,
        lineLabel: LINE_LABELS[row.line_item] ?? row.line_item,
        storedValue: stored,
        freshValue: fresh,
        delta,
      });
    }
  }

  return { monthsWritten: new Set(upserts.map((u) => u.month)).size, gaps, fxError: fxResult.error };
}

const VALID_LINE_ITEMS = new Set<string>(Object.values(LINE));

/**
 * Apply one locked-row gap fix found by runRollup: push the fresh value into a
 * row that's currently `final` (the guard trigger only allows an update that
 * drops OUT of 'final', so this is a two-step write — set the value while
 * briefly 'actual', then restore 'final' right after, same as a manual admin
 * correction would). Only ever called on a gap the UI has shown the admin.
 */
export async function applyLockedGapFix(
  year: number,
  month: number,
  lineItem: string,
  newValue: number,
): Promise<void> {
  const { sb } = await adminClient();
  // This is a network-callable server action, not just a UI button — the
  // caller only ever passes a `LockedGap.lineItem` that runRollup itself
  // produced, but nothing stops a direct call with an arbitrary string, so
  // pin it to the same canonical set every other P&L line write uses.
  if (!VALID_LINE_ITEMS.has(lineItem)) {
    throw new Error(`Unknown P&L line item: ${lineItem}`);
  }
  const value = round2(newValue);
  const { error: e1 } = await sb
    .from("finance_pnl_monthly")
    .update({ value, state: "actual" })
    .eq("year", year)
    .eq("month", month)
    .eq("line_item", lineItem);
  if (e1) throw new Error(`gap fix (step 1): ${e1.message}`);
  const { error: e2 } = await sb
    .from("finance_pnl_monthly")
    .update({ state: "final" })
    .eq("year", year)
    .eq("month", month)
    .eq("line_item", lineItem);
  if (e2) throw new Error(`gap fix (step 2, re-lock): ${e2.message}`);
}
