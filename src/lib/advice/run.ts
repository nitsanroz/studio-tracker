// &advice's engine (v1.80.0): load what the signals need, run them, and bring
// `advice_items` in line with what they found. Called on every pane open (the
// live refresh) and by the daily run, which also asks Claude for wording.
//
// ⚠️ SERVER ONLY, SERVICE KEY ONLY. It reads finance tables and the owner-only
// advice tables; the routes that call it check the owner first. What it returns
// holds percentages, hours and dates — never an amount.

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertOk, fetchAll, isMissingSchema } from "@/lib/db";
import { parseISO, shiftDays, studioToday, toISODate } from "@/lib/format";
import { studioGoal } from "@/lib/hours-goal-server";
import { LINE, evenSpread } from "@/lib/hours-goal";
import { applyPlan, mapAdviceRow, mergeFindings, toDb, visible, type AdviceRow } from "./merge";
import { findAll, pulse, type AdviceData, type PulseTile } from "./signals";
import { totals, type EstimateLine } from "@/lib/leads/estimate";

type Row = Record<string, unknown>;

/** `today` moved by `n` days. */
const shift = (today: string, n: number) => toISODate(shiftDays(parseISO(today), n));

/** Six whole months back plus this one: the pulse's billable-share line and the 90-day unpaid window. */
function entriesFrom(today: string): string {
  const d = parseISO(today);
  return toISODate(new Date(d.getFullYear(), d.getMonth() - 6, 1));
}

export async function loadAdviceData(sb: SupabaseClient, today: string): Promise<AdviceData> {
  const [y] = today.split("-").map(Number);
  const [clients, tasks, sections, groups, entries, periods, links, pubs, pnlRows] = await Promise.all([
    fetchAll<Row>(sb, "clients", "id, name, billable, archived, hour_cap, keys_task_id"),
    fetchAll<Row>(sb, "tasks", "id, client_id, section_id, group_id, title, billable, pending, assignee_id, due_date, status"),
    fetchAll<Row>(sb, "sections", "id, name"),
    fetchAll<Row>(sb, "task_groups", "id, name"),
    // ~25 pages: in parallel, as boot does — paged one by one this was most of an open.
    fetchAll<Row>(
      sb,
      "time_entries",
      "task_id, user_id, date, minutes",
      (q) => q.gte("date", entriesFrom(today)).not("minutes", "is", null).eq("legacy", false),
      { parallel: 4 },
    ),
    fetchAll<Row>(sb, "client_billing_periods", "client_id, label, date_from, date_to, hour_cap, paid"),
    fetchAll<Row>(sb, "report_links", "client_id, published_at, through_date", (q) => q.eq("active", true)),
    fetchAll<Row>(sb, "estimate_publications", "estimate_id, published_at"),
    // ⚠️ Not fetchAll: it pages ORDER BY id, and finance_pnl_monthly has no id.
    // Two line items over two years is a few dozen rows.
    sb
      .from("finance_pnl_monthly")
      .select("year, month, line_item, value")
      .gte("year", y - 1)
      .in("line_item", [LINE.totalRevenues, LINE.totalExpenses])
      .then((res) => {
        assertOk("finance_pnl_monthly", res);
        return (res.data ?? []) as Row[];
      }),
  ]);

  // This month's billable hours, from the entries already in hand — the goal
  // would otherwise page through the same month of time_entries a second time.
  // Its definition: a billable task of a billable client (hours-goal-server.ts).
  const monthKey = today.slice(0, 7);
  const billableClient = new Set(clients.filter((c) => c.billable !== false).map((c) => String(c.id)));
  const billableTask = new Set(tasks.filter((t) => t.billable !== false && t.client_id && billableClient.has(String(t.client_id))).map((t) => String(t.id)));
  const liveHours = entries
    .filter((e) => String(e.date).startsWith(monthKey) && billableTask.has(String(e.task_id)))
    .reduce((h, e) => h + Number(e.minutes) / 60, 0);

  // The rest doesn't depend on itself — run it side by side.
  const [estimates, pages, goal] = await Promise.all([
    loadEstimates(sb, pubs),
    loadPageData(sb, today),
    // The pace is a nice-to-have: a finance hiccup must not take the pane down.
    studioGoal(sb, liveHours).catch(() => null),
  ]);

  const pnlByMonth = new Map<string, { year: number; month: number; revenues: number; expenses: number }>();
  for (const r of pnlRows) {
    const k = `${r.year}-${r.month}`;
    const m = pnlByMonth.get(k) ?? { year: Number(r.year), month: Number(r.month), revenues: 0, expenses: 0 };
    if (r.line_item === LINE.totalRevenues) m.revenues = Number(r.value);
    if (r.line_item === LINE.totalExpenses) m.expenses = Number(r.value);
    pnlByMonth.set(k, m);
  }

  // Home's pace chart spreads the month's goal evenly over its Sun–Thu days,
  // today included — `evenSpread`, shared, so the pane and Home's "7% behind
  // goal pace" chip never disagree by a point.
  const t = parseISO(today);
  const monthDays = Array.from({ length: new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate() }, (_, i) =>
    toISODate(new Date(t.getFullYear(), t.getMonth(), i + 1)),
  );
  const dueShare = evenSpread(monthDays)[t.getDate() - 1];

  return {
    today,
    ...pages,
    clients: clients.map((c) => ({
      id: String(c.id),
      name: String(c.name),
      billable: c.billable !== false,
      archived: Boolean(c.archived),
      hourCap: c.hour_cap == null ? null : Number(c.hour_cap),
      keysTaskId: (c.keys_task_id as string | null) ?? null,
    })),
    tasks: tasks.map((t) => ({
      id: String(t.id),
      clientId: (t.client_id as string | null) ?? null,
      sectionId: (t.section_id as string | null) ?? null,
      groupId: (t.group_id as string | null) ?? null,
      title: String(t.title ?? ""),
      billable: t.billable !== false,
      pending: t.pending === true,
      assigneeId: (t.assignee_id as string | null) ?? null,
      dueDate: (t.due_date as string | null) ?? null,
      status: String(t.status ?? ""),
    })),
    sections: sections.map((s) => ({ id: String(s.id), name: String(s.name) })),
    groups: groups.map((g) => ({ id: String(g.id), name: String(g.name) })),
    entries: entries.map((e) => ({ taskId: String(e.task_id), userId: (e.user_id as string | null) ?? undefined, date: String(e.date), minutes: Number(e.minutes) })),
    periods: periods.map((p) => ({
      clientId: String(p.client_id),
      label: String(p.label),
      dateFrom: String(p.date_from),
      dateTo: String(p.date_to),
      hourCap: p.hour_cap == null ? null : Number(p.hour_cap),
      paid: Boolean(p.paid),
    })),
    reportLinks: links.map((l) => ({
      clientId: String(l.client_id),
      publishedAt: (l.published_at as string | null) ?? null,
      throughDate: (l.through_date as string | null) ?? null,
    })),
    estimates,
    pnl: [...pnlByMonth.values()],
    pace: goal ? { soFar: goal.soFar, expectedByNow: goal.profit.hours * dueShare } : null,
  };
}

/** A table a page signal reads that this database may not have yet: no rows, never a broken pane. */
async function soft(p: Promise<Row[]>): Promise<Row[]> {
  try {
    return await p;
  } catch (e) {
    if (isMissingSchema(e)) return [];
    throw e;
  }
}

/** What the per-page signals read: people, the plan, and the queues that wait on the owner. */
async function loadPageData(sb: SupabaseClient, today: string): Promise<Partial<AdviceData>> {
  const [profiles, columns, planRows, dayStates, vacation, intake, leads, stages, threads, candidates, logs] = await Promise.all([
    fetchAll<Row>(sb, "profiles", "id, name, role, position, active"),
    fetchAll<Row>(sb, "plan_columns", "id, profile_id, type, hidden", (q) => q.eq("type", "member")),
    fetchAll<Row>(sb, "plan_entries", "date, column_id, type", (q) => q.gte("date", shift(today, -10)).lte("date", shift(today, 14))),
    soft(fetchAll<Row>(sb, "plan_day_states", "date_from, date_to", (q) => q.gte("date_to", shift(today, -10)))),
    soft(fetchAll<Row>(sb, "vacation_requests", "created_at", (q) => q.eq("status", "pending"))),
    soft(fetchAll<Row>(sb, "task_requests", "created_at", (q) => q.eq("status", "pending"))),
    soft(fetchAll<Row>(sb, "leads", "id, company, stage_id, next_step_due", (q) => q.is("deleted_at", null))),
    soft(fetchAll<Row>(sb, "lead_stages", "id, kind")),
    soft(fetchAll<Row>(sb, "lead_threads", "lead_id, last_message_at", (q) => q.eq("reply_owed_by", "us"))),
    soft(fetchAll<Row>(sb, "candidates", "last_activity_at", (q) => q.eq("status", "active"))),
    soft(fetchAll<Row>(sb, "freelancer_logs", "date, minutes, created_at", (q) => q.eq("status", "pending"))),
  ]);
  const active = profiles.filter((p) => p.active !== false);
  const activeIds = new Set(active.map((p) => String(p.id)));
  const owner = profiles.find((p) => p.role === "admin" && p.position === "owner");
  const openStage = new Set(stages.filter((st) => st.kind === "open").map((st) => String(st.id)));
  const owedSince = new Map<string, string>();
  for (const t of threads) {
    const id = String(t.lead_id);
    const at = String(t.last_message_at ?? "");
    if (at && (!owedSince.has(id) || at < owedSince.get(id)!)) owedSince.set(id, at);
  }
  return {
    ownerId: owner ? String(owner.id) : null,
    people: active.map((p) => ({ id: String(p.id), name: String(p.name ?? "") })),
    planColumns: columns
      .filter((c) => !c.hidden && c.profile_id && activeIds.has(String(c.profile_id)))
      .map((c) => ({ id: String(c.id), profileId: String(c.profile_id) })),
    planEntries: planRows.map((e) => ({ date: String(e.date), columnId: String(e.column_id) })),
    absences: planRows.filter((e) => e.type === "absence").map((e) => ({ date: String(e.date), columnId: String(e.column_id) })),
    dayStates: dayStates.map((d) => ({ dateFrom: String(d.date_from), dateTo: String(d.date_to) })),
    vacationPending: vacation.map((v) => ({ createdAt: String(v.created_at) })),
    intakePending: intake.map((r) => ({ createdAt: String(r.created_at) })),
    leadsWaiting: leads
      // A lead with no stage is open, as the digest reads it.
      .filter((l) => !l.stage_id || openStage.has(String(l.stage_id)))
      .map((l) => ({
        company: String(l.company ?? ""),
        replyOwedSince: owedSince.get(String(l.id)) ?? null,
        stepDue: (l.next_step_due as string | null) ?? null,
      }))
      .filter((l) => l.replyOwedSince || l.stepDue),
    candidates: candidates.map((c) => ({ lastActivityAt: String(c.last_activity_at) })),
    freelancerPending: logs.map((l) => ({ date: String(l.date), minutes: Number(l.minutes), createdAt: String(l.created_at) })),
  };
}

const num = (v: unknown) => (v == null ? null : Number(v));
/** An estimate_lines row in the shape leads/estimate.ts reads (estimates-data's mapper is client-only). */
const toLine = (r: Row): EstimateLine => ({
  id: String(r.id),
  estimateId: String(r.estimate_id),
  phaseId: (r.phase_id as string | null) ?? null,
  serviceItemId: null,
  name: String(r.name),
  description: null,
  category: (String(r.category ?? "") || "other") as EstimateLine["category"],
  kind: r.kind === "percent" ? "percent" : "hours",
  minHours: num(r.min_hours),
  maxHours: num(r.max_hours),
  percent: num(r.percent),
  percentOf: (r.percent_of as EstimateLine["percentOf"]) ?? null,
  optional: r.optional === true,
  altGroup: (r.alt_group as string | null) ?? null,
  chosen: r.chosen !== false,
  position: Number(r.position ?? 0),
  taskId: (r.task_id as string | null) ?? null,
  groupId: null,
});

/** Each client's latest published estimate: its names, the tasks made from it, and its counted hours. */
async function loadEstimates(sb: SupabaseClient, pubs: Row[]): Promise<AdviceData["estimates"]> {
  // Latest publication per estimate → its lead's client → every name in it.
  const latestByEstimate = new Map<string, string>();
  for (const p of pubs) {
    const id = String(p.estimate_id);
    const at = String(p.published_at);
    if (!latestByEstimate.has(id) || at > latestByEstimate.get(id)!) latestByEstimate.set(id, at);
  }
  const estimateIds = [...latestByEstimate.keys()];
  if (!estimateIds.length) return [];
  const estimates: AdviceData["estimates"] = [];
  const [ests, phases, egroups, lines] = await Promise.all([
    fetchAll<Row>(sb, "lead_estimates", "id, lead_id", (q) => q.in("id", estimateIds)),
    fetchAll<Row>(sb, "estimate_phases", "estimate_id, name", (q) => q.in("estimate_id", estimateIds)),
    fetchAll<Row>(sb, "estimate_groups", "estimate_id, name", (q) => q.in("estimate_id", estimateIds)),
    fetchAll<Row>(
      sb,
      "estimate_lines",
      "id, estimate_id, phase_id, name, category, kind, min_hours, max_hours, percent, percent_of, optional, alt_group, chosen, position, task_id",
      (q) => q.in("estimate_id", estimateIds),
    ),
  ]);
  const leadIds = [...new Set(ests.map((e) => String(e.lead_id)))];
  const leads = await fetchAll<Row>(sb, "leads", "id, client_id", (q) => q.in("id", leadIds).is("deleted_at", null));
  const clientOfLead = new Map(leads.filter((l) => l.client_id).map((l) => [String(l.id), String(l.client_id)]));
  // A client with several estimates: the most recently published one is the scope.
  const latestByClient = new Map<string, { estimateId: string; at: string }>();
  for (const e of ests) {
    const clientId = clientOfLead.get(String(e.lead_id));
    const at = latestByEstimate.get(String(e.id));
    if (!clientId || !at) continue;
    const cur = latestByClient.get(clientId);
    if (!cur || at > cur.at) latestByClient.set(clientId, { estimateId: String(e.id), at });
  }
  for (const [clientId, { estimateId, at }] of latestByClient) {
    const names = [...phases, ...egroups, ...lines].filter((r) => String(r.estimate_id) === estimateId).map((r) => String(r.name));
    const own = lines.filter((r) => String(r.estimate_id) === estimateId);
    // Only the fields `totals` reads; money is computed at rate 0 and never used.
    const counted = totals(own.map(toLine), 0, 0, null).totalHours;
    const taskIds = own.map((r) => r.task_id).filter((t): t is string => typeof t === "string");
    estimates.push({ clientId, publishedAt: at, names, taskIds, hours: counted });
  }
  return estimates;
}

export async function loadRows(sb: SupabaseClient): Promise<AdviceRow[]> {
  return (await fetchAll<Row>(sb, "advice_items", "*")).map(mapAdviceRow);
}

export interface AdviceView {
  today: string;
  items: AdviceRow[];
  pulse: PulseTile[];
  /** how many are snoozed or done right now, for the footer */
  hidden: number;
  /** null when Claude wording is on; otherwise why not, in a few words */
  wordingOff: string | null;
}

/** Run every rule and write the result: the pane's view, plus every stored row for the daily run. */
export async function runCheck(sb: SupabaseClient): Promise<{ view: AdviceView; rows: AdviceRow[] }> {
  const today = studioToday();
  const now = new Date().toISOString();
  const wordingOn = !!process.env.ANTHROPIC_API_KEY;
  const [data, rows, lastRun] = await Promise.all([
    loadAdviceData(sb, today),
    loadRows(sb),
    // Only read when it can matter: without a key the footer says so anyway.
    wordingOn ? sb.from("advice_runs").select("error").order("run_at", { ascending: false }).limit(1).maybeSingle() : null,
  ]);
  const findings = findAll(data);
  const plan = mergeFindings(rows, findings, now);

  // Inserts come back with their ids; updates and resolves run side by side.
  const [inserted] = await Promise.all([
    plan.insert.length
      ? sb
          .from("advice_items")
          .insert(plan.insert.map(toDb))
          .select("*")
          .then((res) => {
            assertOk("advice_items", res);
            return (res.data ?? []).map(mapAdviceRow);
          })
      : [],
    ...plan.update.map((u) =>
      sb
        .from("advice_items")
        .update(toDb(u.patch))
        .eq("id", u.id)
        .then((res) => assertOk("advice_items", res)),
    ),
    plan.resolve.length
      ? sb
          .from("advice_items")
          .update({ resolved_at: now })
          .in("id", plan.resolve)
          .then((res) => assertOk("advice_items", res))
      : null,
  ]);

  const fresh = applyPlan(rows, plan, inserted, now);
  const shown = visible(fresh, today);
  return {
    rows: fresh,
    view: {
      today,
      items: shown,
      pulse: pulse(data, findings),
      hidden: fresh.filter((r) => !r.resolvedAt).length - shown.length,
      wordingOff: !wordingOn ? "Plain wording — no Claude API key" : lastRun?.data?.error ? "Plain wording — the last Claude run failed" : null,
    },
  };
}

/** What the pane shows, after a fresh check. */
export async function checkNow(sb: SupabaseClient): Promise<AdviceView> {
  return (await runCheck(sb)).view;
}
