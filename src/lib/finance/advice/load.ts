// &advice's MONEY side: what the finance rules read (signals.ts here), and the
// names of the one store both sides write. The engine itself — run the rules,
// merge, write — is src/lib/advice/run.ts since the finance merge (stage 4).
//
// ⚠️ SERVER ONLY, with the OWNER's own session (lib/advice/owner.ts checks
// first): the finance tables, the tracker tables it reads and the advice tables
// are all readable by the owner under RLS. Never the service key.

import { termsFromClientRow, type ClientTerms } from "@/lib/payment-terms";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, mapClientRate, mapPnl, type ClientRateRow, type PnlRow } from "@/lib/finance/db";
import { buildFxTable, type FxRow } from "@/lib/finance/fx";
import { getGoalInputs } from "@/lib/finance/actions";
import { SYNTHETIC_YEARLY_MARKER } from "@/lib/finance/finance";
import { studioToday } from "@/lib/finance/format";
import { monthKey, monthsBack, type AdviceData, type ToolMail } from "./signals";
import { TOOL_MAIL } from "@/lib/finance/mail/scan";
import { loadSuggestions } from "@/lib/finance/mail/receipts-data";
import { shiftIso, subscriptionsOf } from "./tools";
import { monthsPaidFromPlan } from "@/lib/finance-paid";
import { ACCOUNTANT_YEARS } from "@/lib/finance/accountant-years";
import { DEFAULT_FACTS } from "@/lib/finance/scenarios/facts";

type Row = Record<string, unknown>;

export const ITEMS = "finance_advice_items";
export const RUNS = "finance_advice_runs";
/** The tools review's runs in RUNS: their `model` starts with this. */
export const REVIEW_RUN = "tools-review/";
/** How often the billing mail is read again (v1.13.0): the pane's peek asks on any page once this has passed. */
export const MAIL_EVERY_MS = 6 * 3_600_000;

export { studioToday };

/** Throws on a Supabase error instead of reading it as "no rows". */
function rows<T = Row>(table: string, res: { data: unknown; error: { message: string } | null }): T[] {
  if (res.error) throw Object.assign(new Error(`${table}: ${res.error.message}`), res.error);
  return (res.data ?? []) as T[];
}

/** Last month's rows of a salary or freelance table, with when each was paid (reference/0011). */
const lastMonth = (sb: SupabaseClient, table: string, cols: string, y: number, m: number): Promise<Row[]> =>
  Promise.resolve(sb.from(table).select(`${cols}, paid_at`).eq("year", y).eq("month", m)).then((r) => rows(table, r));

export async function loadAdviceData(sb: SupabaseClient, today: string): Promise<AdviceData> {
  const [y, m] = today.split("-").map(Number);
  const [ly, lm] = monthsBack(y, m, 1);
  const [fy, fm] = monthsBack(y, m, 4);
  const hoursFrom = `${monthKey(fy, fm)}-01`;
  const lastFrom = `${monthKey(ly, lm)}-01`;

  // Older unpaid: the twelve months before last month.
  const [oy, om] = monthsBack(y, m, 13);
  const olderFrom = monthKey(oy, om);
  const [pnl, clients, tasks, rates, periods, salaries, freelance, income, payslips, fx, monthly, freelancers, leads, stages, goalInputs, olderSalaries, olderFreelance, planPaid, subs, fxAll, toolMail, receipts] = await Promise.all([
    fetchAll<PnlRow>(sb, "finance_pnl_monthly", "*", (q) => q.gte("year", y - 2)),
    fetchAll<Row>(sb, "clients", "id, name, billable, archived, keys_task_id"),
    fetchAll<Row>(sb, "tasks", "id, client_id, billable, pending"),
    fetchAll<ClientRateRow>(sb, "client_rates", "id, client_id, client_canon, rate, effective_from, effective_to, note"),
    // Only periods that can be "the last one, up to 45 days late" need their hours —
    // 100 days covers net+30 (1 + 30 + 45 = 76) with room.
    fetchAll<Row>(sb, "client_billing_periods", "client_id, label, date_from, date_to, paid", (q) => q.gte("date_to", shiftIso(today, -100))),
    lastMonth(sb, "finance_salaries", "id, employee_name, state, gross_amount", ly, lm),
    lastMonth(sb, "finance_freelance", "id, person_name, state, amount", ly, lm),
    sb.from("finance_income").select("id, state, amount").gte("date", lastFrom).lt("date", `${monthKey(y, m)}-01`).then((r) => rows("finance_income", r)),
    // Counted, never read: payslips are personal (CLAUDE.md, PII).
    sb.from("finance_payslips").select("id", { count: "exact", head: true }).eq("year", ly).eq("month", lm).then((r) => {
      if (r.error) throw new Error(`finance_payslips: ${r.error.message}`);
      return r.count ?? 0;
    }),
    sb.from("fx_rates").select("year, month, usd_ils, eur_ils").gte("year", ly).then((r) => rows("fx_rates", r)),
    // The Expenses page's Monthly tab exactly: this year's rows, not the synthetic yearly total.
    fetchAll<Row>(sb, "finance_expenses", "date, end_date, filed_at, description", (q) =>
      q.eq("category", "monthly").gte("date", `${y}-01-01`).lte("date", `${y}-12-31`),
    ),
    sb.from("freelancers").select("profile_id, currency").then((r) => (r.error ? [] : (r.data as Row[]))),
    // Open leads, counted the digest's way (no stage = open) — for "concentration".
    // A failed load is null, not "no leads" — the card then says nothing about leads.
    fetchAll<Row>(sb, "leads", "stage_id", (q) => q.is("deleted_at", null)).catch(() => null),
    fetchAll<Row>(sb, "lead_stages", "id, kind").catch(() => null),
    // The hours goal's tracker inputs, exactly as the Overview's card gets them.
    // A hiccup there must not take the pane down: the pace checks just stay quiet.
    getGoalInputs(y, m).catch(() => null),
    // Final and unpaid before last month (olderUnpaid); filtered to the window below.
    fetchAll<Row>(sb, "finance_salaries", "id, employee_name, year, month, gross_amount", (q) => q.eq("state", "final").is("paid_at", null).gte("year", oy)),
    fetchAll<Row>(sb, "finance_freelance", "id, person_name, year, month, amount", (q) => q.eq("state", "final").is("paid_at", null).gte("year", oy)),
    // Every Plan row of the client months periodUnpaid may ask about — paid AND
    // unpaid: a month counts as paid only when ALL of its rows (sub-accounts) are,
    // so the unpaid ones have to be here to say no. Periods reach back 60 days at most.
    fetchAll<Row>(sb, "finance_client_monthly", "client_id, client_canon, year, month, paid_at", (q) => q.gte("year", y - 1)),
    // The Tools checks: every monthly and yearly row from two years back, so a
    // renewal has the one before it. A failed load leaves them quiet, not the pane down.
    fetchAll<Row>(sb, "finance_expenses", "id, date, end_date, category, vendor, description, amount_gross, amount_no_vat, currency, vat_included, renew_months, state", (q) =>
      q.in("category", ["monthly", "yearly"]).gte("date", `${y - 2}-01-01`),
    ).catch(() => null),
    // Every month's rate (one row a month): a renewal is converted at the month it was paid.
    fetchAll<FxRow>(sb, "fx_rates", "year, month, usd_ils, eur_ils").catch(() => [] as FxRow[]),
    // Billing mail (reference/0015): absent before it's run, and the mail checks stay quiet.
    fetchAll<Row>(sb, TOOL_MAIL, "id, account_email, vendor, kind, sent_at, subject, amount, currency", (q) => q.gte("sent_at", `${shiftIso(today, -400)}T00:00:00Z`)).catch(() => null),
    // Receipts waiting to be added (reference/0016, v1.14.0): null before it's run.
    loadSuggestions(sb).catch(() => null),
  ]);
  const inWindow = (r: Row) => {
    const k = monthKey(Number(r.year), Number(r.month));
    return k >= olderFrom && k < monthKey(ly, lm);
  };

  // Billable hours per client and month (the P&L's), per client and day (the
  // tracker's &advice set), and the periods' report hours — one pass over the
  // entries, from whichever starts first.
  const daysFrom = shiftIso(today, -120);
  const earliest = periods.reduce((min, p) => (String(p.date_from) < min ? String(p.date_from) : min), hoursFrom < daysFrom ? hoursFrom : daysFrom);
  const entries = await fetchAll<Row>(sb, "time_entries", "task_id, date, minutes", (q) => q.gte("date", earliest).not("minutes", "is", null));
  const billableClient = new Set(clients.filter((c) => c.billable !== false).map((c) => String(c.id)));
  const keysTasks = new Set(clients.map((c) => c.keys_task_id).filter(Boolean).map(String));
  const byDay = new Map<string, number>();
  const taskOf = new Map(tasks.map((t) => [String(t.id), t]));
  const byMonth = new Map<string, number>();
  const reportEntries: { clientId: string; date: string; hours: number }[] = [];
  for (const e of entries) {
    const t = taskOf.get(String(e.task_id));
    if (!t?.client_id || t.billable === false) continue;
    const clientId = String(t.client_id);
    const hours = Number(e.minutes) / 60;
    const date = String(e.date);
    // The P&L's own definition: a billable task of a billable client.
    if (billableClient.has(clientId) && date >= hoursFrom) {
      const k = `${clientId}|${date.slice(0, 7)}`;
      byMonth.set(k, (byMonth.get(k) ?? 0) + hours);
    }
    // The tracker's own billable set for its &advice (Keys tasks out), so
    // "concentration" and "gone quiet" agree with its pane (v1.81.0).
    if (billableClient.has(clientId) && !keysTasks.has(String(e.task_id)) && date >= daysFrom) {
      const k = `${clientId}|${date}`;
      byDay.set(k, (byDay.get(k) ?? 0) + hours);
    }
    // What a client report counts: billable, not pending (the tracker's report set).
    if (t.pending !== true) reportEntries.push({ clientId, date, hours });
  }

  const names = new Map<string, string>();
  if (freelancers.length) {
    const { data } = await sb.from("profiles").select("id, name").in("id", freelancers.map((f) => String(f.profile_id)));
    for (const p of (data as Row[] | null) ?? []) names.set(String(p.id), String(p.name));
  }

  // The client's payment terms (the tracker's 0065/0066), read on their own and
  // as `*`: naming a column the database doesn't have yet fails the whole select.
  const terms = new Map<string, ClientTerms>();
  {
    const { data, error } = await sb.from("clients").select("*");
    if (!error) for (const r of (data as Row[] | null) ?? []) terms.set(String(r.id), termsFromClientRow(r));
  }

  return {
    today,
    // The accountant's figures and the company facts: loaded HERE, on the server,
    // so signals.ts (which the client pane also imports) never names them.
    figures: { accountantYears: ACCOUNTANT_YEARS, facts: DEFAULT_FACTS },
    pnl: pnl.map(mapPnl),
    goalInputs,
    clients: clients.map((c) => ({
      id: String(c.id),
      name: String(c.name),
      billable: c.billable !== false,
      archived: c.archived === true,
      paymentTermsDays: terms.get(String(c.id))?.days,
      paymentTermsNet: terms.get(String(c.id))?.net,
    })),
    rates: rates.map(mapClientRate),
    hours: [...byMonth].map(([k, hours]) => {
      const [clientId, month] = k.split("|");
      return { clientId, month, hours };
    }),
    billableDays: [...byDay].map(([k, hours]) => {
      const [clientId, date] = k.split("|");
      return { clientId, date, hours };
    }),
    leadsOpen: (() => {
      if (!leads || !stages) return null;
      const open = new Set(stages.filter((st) => st.kind === "open").map((st) => String(st.id)));
      return leads.filter((l) => !l.stage_id || open.has(String(l.stage_id))).length;
    })(),
    periods: periods.map((p) => {
      const [clientId, from, to] = [String(p.client_id), String(p.date_from), String(p.date_to)];
      const mine = reportEntries.filter((e) => e.clientId === clientId);
      return {
        clientId,
        label: String(p.label),
        dateFrom: from,
        dateTo: to,
        paid: p.paid === true,
        hours: mine.filter((e) => e.date >= from && e.date <= to).reduce((t, e) => t + e.hours, 0),
        hoursSince: mine.filter((e) => e.date > to).reduce((t, e) => t + e.hours, 0),
      };
    }),
    lastMonthRows: [
      ...salaries.map((r) => ({ table: "salaries" as const, state: String(r.state), amount: Number(r.gross_amount), id: String(r.id), name: String(r.employee_name ?? ""), paid: r.paid_at != null })),
      ...freelance.map((r) => ({ table: "freelance" as const, state: String(r.state), amount: Number(r.amount), id: String(r.id), name: String(r.person_name ?? ""), paid: r.paid_at != null })),
      ...income.map((r) => ({ table: "income" as const, state: String(r.state), amount: Number(r.amount), id: String(r.id) })),
    ],
    olderUnpaid: [
      ...olderSalaries.filter(inWindow).map((r) => ({ table: "salaries" as const, month: monthKey(Number(r.year), Number(r.month)), amount: Number(r.gross_amount), id: String(r.id), name: String(r.employee_name ?? "") })),
      ...olderFreelance.filter(inWindow).map((r) => ({ table: "freelance" as const, month: monthKey(Number(r.year), Number(r.month)), amount: Number(r.amount), id: String(r.id), name: String(r.person_name ?? "") })),
    ],
    // ONE rule for "the client paid this month", the tracker's (lib/finance-paid.ts,
    // the same as SQL 0064): Client Reports and this pane can't disagree. This file
    // used to take any single paid row as the whole month.
    planPaid: monthsPaidFromPlan(
      planPaid.map((r) => ({ client_id: (r.client_id as string | null) ?? null, client_canon: String(r.client_canon), year: Number(r.year), month: Number(r.month), paid_at: (r.paid_at as string | null) ?? null })),
      clients.map((c) => ({ id: String(c.id), name: String(c.name) })),
    )
      .filter((r) => r.paid)
      .map((r) => ({ clientId: r.client_id, client: "", month: monthKey(r.year, r.month) })),
    payslips: { [monthKey(ly, lm)]: payslips },
    fxMonths: fx.filter((r) => r.usd_ils != null && r.eur_ils != null).map((r) => monthKey(Number(r.year), Number(r.month))),
    monthlyExpenses: monthly.filter((r) => r.description !== SYNTHETIC_YEARLY_MARKER).map((r) => ({ date: String(r.date), endDate: (r.end_date as string | null) ?? null, filedAt: (r.filed_at as string | null) ?? null })),
    freelancerCurrency: Object.fromEntries(freelancers.map((f) => [names.get(String(f.profile_id)) ?? "", String(f.currency)])),
    subscriptions: subs ? subscriptionsOf(subs, buildFxTable(fxAll)) : undefined,
    receiptsToAdd: receipts ? { count: receipts.length, newVendors: new Set(receipts.filter((r) => !r.vendor).map((r) => r.suggestedVendor.toLowerCase())).size } : undefined,
    toolMail: toolMail?.map((r) => ({
      id: String(r.id),
      account: String(r.account_email),
      vendor: String(r.vendor),
      kind: r.kind as ToolMail["kind"],
      date: studioToday(new Date(String(r.sent_at))),
      subject: String(r.subject ?? ""),
      amount: r.amount == null ? null : Number(r.amount),
      currency: (r.currency as string | null) ?? null,
    })),
  };
}

/** The latest wording run: whether it was today, and whether it failed. */
export async function lastWordingRun(sb: SupabaseClient, today: string): Promise<{ today: boolean; at: string; error: string | null } | null> {
  // The tools review logs its runs here too (model "tools-review/…"); they aren't the day's wording.
  const { data } = await sb.from(RUNS).select("run_at, error").not("model", "like", `${REVIEW_RUN}%`).order("run_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  return { today: studioToday(new Date(String(data.run_at))) === today, at: String(data.run_at), error: (data.error as string | null) ?? null };
}

/** The latest review: when, its summary, and its error if it failed. */
export interface ReviewState {
  at: string;
  summary: string | null;
  error: string | null;
}

export async function lastReview(sb: SupabaseClient): Promise<ReviewState | null> {
  const { data } = await sb.from(RUNS).select("run_at, ideas, error").like("model", `${REVIEW_RUN}%`).order("run_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const ideas = data.ideas as { summary?: string }[] | null;
  return { at: String(data.run_at), summary: ideas?.[0]?.summary ?? null, error: (data.error as string | null) ?? null };
}
