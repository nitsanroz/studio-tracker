// &advice's rule checks (v1.80.0). Each takes plain data and returns the
// findings it sees; the engine (`run.ts`) loads the data and keeps one
// `advice_items` row per finding.
//
// ⚠️ PURE ON PURPOSE — no clock, no database. `data.today` is the studio's date,
// which is what makes period ends, month starts and "7 days since" testable.
//
// ⚠️ NO AMOUNTS IN A FINDING. `facts`, `title` and `body` hold percentages, hours
// and dates only: the tracker never shows money (Nitsan, 2026-10-24). The P&L
// enters as revenues/expenses and leaves as one ratio.

import { formatHoursShort, parseISO, shiftDays, shortDate, shortRangeLabel, studioDate, toISODate } from "../format";
import { workdays as studioWorkdays } from "../vacation";
import { daysBetween, lastCompleteWeekEnd } from "../period-math";

export type AdviceKind = "now" | "heads" | "idea";

export interface Finding {
  /** signal + subject; the same finding on the next check is the same row */
  key: string;
  signal: string;
  kind: AdviceKind;
  area: string;
  clientId: string | null;
  /** bigger is worse; a snooze breaks when it rises */
  severity: number;
  facts: Record<string, string | number | null>;
  title: string;
  body: string;
  /** a reminder can be ticked done; advice can only be snoozed */
  reminder: boolean;
  /** where the action goes, and its label */
  href: string;
  action: string;
}

export interface AdviceData {
  /** the studio's today, yyyy-mm-dd */
  today: string;
  clients: { id: string; name: string; billable: boolean; archived: boolean; hourCap: number | null; keysTaskId: string | null }[];
  tasks: {
    id: string;
    clientId: string | null;
    sectionId: string | null;
    groupId: string | null;
    title: string;
    billable: boolean;
    pending?: boolean;
    assigneeId?: string | null;
    dueDate?: string | null;
    status?: string;
  }[];
  sections: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  /** non-legacy entries, at least the last four months */
  entries: { taskId: string; date: string; minutes: number; userId?: string }[];
  periods: { clientId: string; label: string; dateFrom: string; dateTo: string; hourCap: number | null; paid: boolean }[];
  /** active report links */
  reportLinks: { clientId: string; publishedAt: string | null; throughDate: string | null }[];
  /**
   * Each client's latest published estimate: when, every phase/group/line name
   * in it, the tasks its lines were turned into (`estimate_lines.task_id`), and
   * its counted hours (leads/estimate.ts `totals`).
   */
  estimates: { clientId: string; publishedAt: string; names: string[]; taskIds: string[]; hours: { min: number; max: number } }[];
  /** finance P&L months, as two numbers each — turned into a ratio here */
  pnl: { year: number; month: number; revenues: number; expenses: number }[];
  /** the month's pace against finance-admin's goal (hours-goal.ts), or null */
  pace: { soFar: number; expectedByNow: number } | null;

  /* ── one thing for every page (v1.80.0, Nitsan: "try to say something on each page") ── */
  /** the owner, for "your tasks" */
  ownerId?: string | null;
  /** active people, for first names */
  people?: { id: string; name: string }[];
  /** the weekly plan's designer columns (visible, tied to a profile) */
  planColumns?: { id: string; profileId: string }[];
  /** plan entries from ten days back to the end of next week; absences included */
  planEntries?: { date: string; columnId: string }[];
  /** the absence entries among them — the only ones that excuse a day without hours */
  absences?: { date: string; columnId: string }[];
  /** holidays and other marked days: nobody is expected to plan or log them */
  dayStates?: { dateFrom: string; dateTo: string }[];
  vacationPending?: { createdAt: string }[];
  intakePending?: { createdAt: string }[];
  /** open leads waiting on the studio: a reply owed since, or a next step due */
  leadsWaiting?: { company: string; replyOwedSince: string | null; stepDue: string | null }[];
  /** active candidates, by their last activity */
  candidates?: { lastActivityAt: string }[];
  freelancerPending?: { date: string; minutes: number; createdAt?: string }[];
}

const pct = (x: number) => Math.round(x * 100);

/** Hours as a number, as the app writes them: up to two decimals (308.75, not 308.8). Text uses `formatHoursShort`. */
const hrs = (minutes: number) => Number((minutes / 60).toFixed(2));
/** "1 request waits" / "2 requests wait" — the noun and verb that agree with n. */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Sun–Thu days from `from` to `to`, both included (vacation.ts counts them; holidays here are not taken out). */
export const workdayCount = (from: string, to: string) => studioWorkdays(from, to, []).length;

interface Index {
  /** a billable task of a billable client, Keys tasks never — the cap and estimate budgets */
  billable: Set<string>;
  /** the hours a client report counts: billable, non-pending (report-snapshot.ts's own filter) */
  report: Set<string>;
  tasksOf: Map<string, AdviceData["tasks"]>;
  entriesOf: Map<string, AdviceData["entries"]>;
}

const indexes = new WeakMap<AdviceData, Index>();
/**
 * The lookups every client signal needs, built once per check — not once per
 * signal and client, which scanned every entry for every client in four places.
 */
function index(data: AdviceData): Index {
  const hit = indexes.get(data);
  if (hit) return hit;
  const client = new Map(data.clients.map((c) => [c.id, c]));
  const keys = new Set(data.clients.map((c) => c.keysTaskId).filter(Boolean));
  const ix: Index = { billable: new Set(), report: new Set(), tasksOf: new Map(), entriesOf: new Map() };
  const clientOfTask = new Map<string, string>();
  for (const t of data.tasks) {
    if (!t.clientId) continue;
    clientOfTask.set(t.id, t.clientId);
    const list = ix.tasksOf.get(t.clientId);
    if (list) list.push(t);
    else ix.tasksOf.set(t.clientId, [t]);
    if (t.billable && client.get(t.clientId)?.billable && !keys.has(t.id)) ix.billable.add(t.id);
    // Measured 2026-10-24: counting every task gave 98h where Client Reports said 81h (a Keys write-down).
    if (t.billable && !t.pending) ix.report.add(t.id);
  }
  for (const e of data.entries) {
    const c = clientOfTask.get(e.taskId);
    if (!c) continue;
    const list = ix.entriesOf.get(c);
    if (list) list.push(e);
    else ix.entriesOf.set(c, [e]);
  }
  indexes.set(data, ix);
  return ix;
}

/** Minutes logged on a client's tasks in `keep`, from `from` to `to` (open-ended without one). */
function minutesOn(data: AdviceData, clientId: string, keep: Set<string>, from: string, to = "9999-12-31"): number {
  let sum = 0;
  for (const e of index(data).entriesOf.get(clientId) ?? []) if (keep.has(e.taskId) && e.date >= from && e.date <= to) sum += e.minutes;
  return sum;
}

/** The billing period running today, and the cap that applies to it (the client's own, else the period's — as the report reads it). */
function currentCap(data: AdviceData, c: AdviceData["clients"][number]) {
  const period = data.periods.find((p) => p.clientId === c.id && p.dateFrom <= data.today && data.today <= p.dateTo);
  const cap = c.hourCap ?? period?.hourCap ?? null;
  return period && cap != null && cap > 0 ? { period, cap } : null;
}

const liveClients = (data: AdviceData) => data.clients.filter((c) => !c.archived);

/* ── Clients & budget ───────────────────────────────────────────────────── */

/**
 * The weekly hours report goes out on Sunday (Nitsan, 2026-10-24). It's due for
 * a client when:
 * - the week before that Sunday (Sun–Sat) had hours on the client — no hours,
 *   no report;
 * - nothing was published from three days before that Sunday on;
 * - no billing period ended within three days of it — then the monthly report
 *   and invoice went out instead.
 * One finding per client per Sunday; next week's is a new one, so last week's
 * resolves by itself. Ticks itself off when you publish.
 */
export function reportDue(data: AdviceData): Finding[] {
  const { report } = index(data);
  const weekEnd = lastCompleteWeekEnd(parseISO(data.today));
  const sunday = toISODate(shiftDays(parseISO(weekEnd), 1));
  const weekStart = toISODate(shiftDays(parseISO(weekEnd), -6));
  const sentFrom = toISODate(shiftDays(parseISO(sunday), -3));
  const [nearFrom, nearTo] = [sentFrom, toISODate(shiftDays(parseISO(sunday), 3))];
  const late = daysBetween(parseISO(sunday), parseISO(data.today));
  const out: Finding[] = [];
  for (const c of liveClients(data)) {
    const link = data.reportLinks.find((l) => l.clientId === c.id);
    if (!link) continue;
    const published = link.publishedAt ? studioDate(link.publishedAt) : null;
    if (published && published >= sentFrom) continue;
    if (data.periods.some((p) => p.clientId === c.id && p.dateTo >= nearFrom && p.dateTo <= nearTo)) continue;
    const minutes = minutesOn(data, c.id, report, weekStart, weekEnd);
    if (minutes <= 0) continue;
    const since = published ? daysBetween(parseISO(published), parseISO(data.today)) : null;
    out.push({
      key: `report-due:${c.id}:${sunday}`,
      signal: "report-due",
      kind: "now",
      area: "Client reports",
      clientId: c.id,
      severity: late >= 2 ? 2 : 1,
      facts: { client: c.name, weekStart, weekEnd, hours: hrs(minutes), lastPublished: published, daysSince: since },
      title: `Send ${c.name} this week's report`,
      body: `${formatHoursShort(minutes)} last week (${shortRangeLabel(weekStart, weekEnd)}).${since == null ? " Never published." : ` Last published ${since} days ago.`}`,
      reminder: true,
      href: `/client-reports?client=${c.id}`,
      action: "Open the report",
    });
  }
  return out;
}

/**
 * A client's current billing period is filling its hour cap — or will by its
 * end, at the pace so far. The cap is the client's own (0033), else the
 * period's, exactly as the report reads it. Billable hours only; keys tasks out.
 */
export function capFilling(data: AdviceData): Finding[] {
  const { billable } = index(data);
  const out: Finding[] = [];
  for (const c of liveClients(data)) {
    const current = currentCap(data, c);
    if (!current) continue;
    const { period, cap } = current;
    const minutes = minutesOn(data, c.id, billable, period.dateFrom, period.dateTo);
    const used = minutes / 60 / cap;
    const done = workdayCount(period.dateFrom, data.today);
    const total = workdayCount(period.dateFrom, period.dateTo);
    const left = Math.max(0, total - done);
    const projected = done > 0 ? (used / done) * total : used;
    const severity = used >= 1.2 ? 4 : used >= 1 ? 3 : used >= 0.9 || projected >= 1 ? 2 : used >= 0.8 ? 1 : 0;
    if (severity === 0) continue;
    const over = used >= 1;
    out.push({
      key: `cap:${c.id}:${period.dateFrom}`,
      signal: "cap",
      kind: severity >= 2 ? "now" : "heads",
      area: "Budget",
      clientId: c.id,
      severity,
      facts: { client: c.name, period: period.label, usedPct: pct(used), projectedPct: pct(projected), workdaysLeft: left, capHours: cap },
      title: `${c.name} is at ${pct(used)}% of ${period.label}'s cap`,
      body: over
        ? `${formatHoursShort(minutes - cap * 60)} over the ${cap}h cap, with ${left} working days left. Worth telling them before more is logged.`
        : `${left} working days left. At this pace it closes at ${pct(projected)}% — worth a heads-up before it happens.`,
      reminder: true,
      href: `/client-reports?client=${c.id}`,
      action: over ? "Send an over-budget note" : "Send a heads-up",
    });
  }
  return out;
}

/**
 * A client's LAST ended billing period had hours and isn't marked paid, 7–45
 * days after it ended. Only the last one, and only in that window (Nitsan,
 * 2026-10-24): 'paid' was ticked on 54 of 176 old periods, so looking further
 * back nagged about months long settled.
 */
export function periodUnpaid(data: AdviceData): Finding[] {
  const { report } = index(data);
  const out: Finding[] = [];
  for (const c of liveClients(data)) {
    const p = data.periods.filter((x) => x.clientId === c.id && x.dateTo < data.today).sort((a, b) => b.dateTo.localeCompare(a.dateTo))[0];
    if (!p || p.paid) continue;
    const days = daysBetween(parseISO(p.dateTo), parseISO(data.today));
    if (days < 7 || days > 45) continue;
    const minutes = minutesOn(data, c.id, report, p.dateFrom, p.dateTo);
    if (minutes <= 0) continue;
    out.push({
      key: `unpaid:${c.id}:${p.dateFrom}`,
      signal: "unpaid",
      kind: "heads",
      area: "Billing",
      clientId: c.id,
      severity: days >= 30 ? 3 : days >= 14 ? 2 : 1,
      facts: { client: c.name, period: p.label, daysSinceEnd: days, hours: hrs(minutes) },
      title: `${c.name}: ${p.label} isn't marked paid`,
      body: `It ended ${days} days ago with ${formatHoursShort(minutes)} logged.`,
      reminder: true,
      href: `/client-reports?client=${c.id}`,
      action: "Open the billing periods",
    });
  }
  return out;
}

const STOP = new Set(["the", "and", "for", "with", "new", "design", "of", "to", "a", "v1", "v2", "v3", "של", "עם", "את", "על"]);

/** The words a name is made of, for matching tasks against an estimate. */
export function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * Work outside the estimate: hours since the client's latest published
 * estimate on tasks that came from none of its lines (`task_id`) and whose
 * title, section and group share no word with any phase, group or line of it.
 * Only clients WITH a published estimate — older clients are skipped (Nitsan,
 * 2026-10-24). It errs towards calling work in scope.
 */
export function outOfScope(data: AdviceData): Finding[] {
  const { billable, tasksOf, entriesOf } = index(data);
  const sectionName = new Map(data.sections.map((s) => [s.id, s.name]));
  const groupName = new Map(data.groups.map((g) => [g.id, g.name]));
  const out: Finding[] = [];
  for (const c of liveClients(data)) {
    const est = data.estimates.find((e) => e.clientId === c.id);
    if (!est) continue;
    const scope = new Set(est.names.flatMap(words));
    const linked = new Set(est.taskIds);
    if (scope.size === 0 && linked.size === 0) continue;
    const since = studioDate(est.publishedAt);
    const minutesOf = new Map<string, number>();
    for (const e of entriesOf.get(c.id) ?? []) if (e.date >= since) minutesOf.set(e.taskId, (minutesOf.get(e.taskId) ?? 0) + e.minutes);
    let all = 0;
    const outside: { title: string; minutes: number }[] = [];
    for (const t of (tasksOf.get(c.id) ?? []).filter((x) => billable.has(x.id))) {
      const m = minutesOf.get(t.id) ?? 0;
      if (m <= 0) continue;
      all += m;
      const own = words([t.title, t.sectionId ? sectionName.get(t.sectionId) : "", t.groupId ? groupName.get(t.groupId) : ""].join(" "));
      if (!linked.has(t.id) && !own.some((w) => scope.has(w))) outside.push({ title: t.title, minutes: m });
    }
    const outMin = outside.reduce((t, o) => t + o.minutes, 0);
    if (all < 5 * 60 || outMin < 3 * 60) continue;
    const share = outMin / all;
    const severity = share >= 0.35 ? 3 : share >= 0.2 ? 2 : share >= 0.1 ? 1 : 0;
    if (severity === 0) continue;
    const top = outside.sort((a, b) => b.minutes - a.minutes).slice(0, 2).map((o) => `"${o.title}"`);
    out.push({
      key: `scope:${c.id}:${since}`,
      signal: "scope",
      kind: severity >= 2 ? "now" : "heads",
      area: "Scope",
      clientId: c.id,
      severity,
      facts: { client: c.name, outsidePct: pct(share), outsideHours: hrs(outMin), since, tasks: top.join(", ") },
      title: `${c.name}: ${pct(share)}% of hours went to work outside the estimate`,
      body: `${top.join(" and ")} ${top.length > 1 ? "aren't" : "isn't"} in the published estimate — ${formatHoursShort(outMin)} since ${since}. Tell them before the period closes.`,
      reminder: true,
      href: `/clients/${c.id}`,
      action: "Send an out-of-scope note",
    });
  }
  return out;
}

/**
 * Hours against the published estimate: billable hours on the client since it
 * was published, over the estimate's counted hours (the top of its range).
 * Nitsan, 2026-10-24: no client has an hour cap yet, so the estimate is the
 * budget that exists. Same steps as the cap.
 */
export function estimateBudget(data: AdviceData): Finding[] {
  const { billable } = index(data);
  const out: Finding[] = [];
  for (const c of liveClients(data)) {
    const est = data.estimates.find((e) => e.clientId === c.id);
    if (!est || est.hours.max <= 0) continue;
    const since = studioDate(est.publishedAt);
    const minutes = minutesOn(data, c.id, billable, since);
    const used = minutes / 60 / est.hours.max;
    const severity = used >= 1.2 ? 4 : used >= 1 ? 3 : used >= 0.9 ? 2 : used >= 0.8 ? 1 : 0;
    if (severity === 0) continue;
    const range = est.hours.min === est.hours.max ? `${est.hours.max}h` : `${est.hours.min}–${est.hours.max}h`;
    out.push({
      key: `estimate:${c.id}:${since}`,
      signal: "estimate",
      kind: severity >= 2 ? "now" : "heads",
      area: "Budget",
      clientId: c.id,
      severity,
      facts: { client: c.name, usedPct: pct(used), hours: hrs(minutes), estimated: range, since },
      title: `${c.name} has used ${pct(used)}% of the estimate's hours`,
      body: `${formatHoursShort(minutes)} since ${since}, against ${range} estimated.${used >= 1 ? " Worth telling them before more is logged." : ""}`,
      reminder: true,
      href: `/clients/${c.id}`,
      action: used >= 1 ? "Send an over-budget note" : "Send a heads-up",
    });
  }
  return out;
}

/* ── Studio money, as percentages ───────────────────────────────────────── */

const monthKey = (iso: string) => iso.slice(0, 7);
function monthsBefore(today: string, n: number): string[] {
  const d = parseISO(today);
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - (n - i), 1);
    return toISODate(m).slice(0, 7);
  });
}

/** Billable share per month (yyyy-mm → fraction and hours), all hours non-legacy. */
export function billableShareByMonth(data: AdviceData): Map<string, { share: number; minutes: number }> {
  const { billable } = index(data);
  const tot = new Map<string, [number, number]>();
  for (const e of data.entries) {
    const k = monthKey(e.date);
    const [b, a] = tot.get(k) ?? [0, 0];
    tot.set(k, [b + (billable.has(e.taskId) ? e.minutes : 0), a + e.minutes]);
  }
  return new Map([...tot].map(([k, [b, a]]) => [k, { share: a ? b / a : 0, minutes: a }]));
}

/** This month's billable share against the three months before. Quiet until 20h are in. */
export function billableShare(data: AdviceData): Finding[] {
  const byMonth = billableShareByMonth(data);
  const now = byMonth.get(monthKey(data.today));
  if (!now || now.minutes < 20 * 60) return [];
  const prev = monthsBefore(data.today, 3).map((k) => byMonth.get(k)).filter((m): m is { share: number; minutes: number } => !!m && m.minutes > 0);
  if (prev.length === 0) return [];
  const avg = prev.reduce((t, m) => t + m.share * m.minutes, 0) / prev.reduce((t, m) => t + m.minutes, 0);
  const drop = pct(avg) - pct(now.share);
  const severity = drop >= 15 ? 3 : drop >= 10 ? 2 : drop >= 5 ? 1 : 0;
  if (severity === 0) return [];
  return [
    {
      key: `billable:${monthKey(data.today)}`,
      signal: "billable",
      kind: "heads",
      area: "Studio",
      clientId: null,
      severity,
      facts: { sharePct: pct(now.share), averagePct: pct(avg), dropPts: drop },
      title: `Billable share is down to ${pct(now.share)}%`,
      body: `It averaged ${pct(avg)}% over the last three months — ${drop} points lower this month.`,
      reminder: false,
      href: "/reports",
      action: "See hours by client",
    },
  ];
}

/** The month against finance-admin's goal: behind by 10% or more. */
export function paceBehind(data: AdviceData): Finding[] {
  const p = data.pace;
  if (!p || p.expectedByNow <= 0) return [];
  const ratio = p.soFar / p.expectedByNow;
  const severity = ratio < 0.8 ? 2 : ratio < 0.9 ? 1 : 0;
  if (severity === 0) return [];
  return [
    {
      key: `pace:${monthKey(data.today)}`,
      signal: "pace",
      kind: "heads",
      area: "Studio",
      clientId: null,
      severity,
      facts: { pacePct: pct(ratio) },
      title: `The month is at ${pct(ratio)}% of the pace it needs`,
      body: `Billable hours so far are ${100 - pct(ratio)}% behind where the month's goal expects them today.`,
      reminder: false,
      href: "/",
      action: "Open Studio pace",
    },
  ];
}

/** Income ÷ costs per complete P&L month, oldest first. */
export function incomeCostSeries(data: AdviceData): { month: string; ratio: number }[] {
  const current = monthKey(data.today);
  return data.pnl
    .map((r) => ({ month: `${r.year}-${String(r.month).padStart(2, "0")}`, r }))
    .filter(({ month, r }) => month < current && r.expenses > 0 && r.revenues > 0)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(({ month, r }) => ({ month, ratio: r.revenues / r.expenses }));
}

/** The last complete month's income covering its costs: under 100%, or 10+ points below the three before. */
export function incomeVsCosts(data: AdviceData): Finding[] {
  const s = incomeCostSeries(data);
  if (s.length < 2) return [];
  const last = s[s.length - 1];
  const prev = s.slice(-4, -1);
  const avg = prev.reduce((t, m) => t + m.ratio, 0) / prev.length;
  const drop = pct(avg) - pct(last.ratio);
  const severity = last.ratio < 1 ? 2 : drop >= 10 ? 1 : 0;
  if (severity === 0) return [];
  return [
    {
      key: `income:${last.month}`,
      signal: "income",
      kind: "heads",
      area: "Studio",
      clientId: null,
      severity,
      facts: { month: last.month, coverPct: pct(last.ratio), averagePct: pct(avg) },
      title: last.ratio < 1 ? `Income covered ${pct(last.ratio)}% of costs in ${last.month}` : `Income vs costs fell to ${pct(last.ratio)}%`,
      body: `Against ${pct(avg)}% over the months before. Amounts are in the finance app.`,
      reminder: false,
      href: "/",
      action: "Open Home",
    },
  ];
}

export const SIGNALS = [
  reportDue,
  capFilling,
  estimateBudget,
  periodUnpaid,
  outOfScope,
  billableShare,
  paceBehind,
  incomeVsCosts,
  planGaps,
  missingHours,
  myOverdue,
  overdueTasks,
  vacationPending,
  intakePending,
  leadsWaiting,
  candidatesQuiet,
  freelancerLogs,
];

export function findAll(data: AdviceData): Finding[] {
  return SIGNALS.flatMap((s) => s(data));
}

/* ── One thing for every page ───────────────────────────────────────────── */

const firstName = (data: AdviceData, profileId: string) => (data.people ?? []).find((p) => p.id === profileId)?.name.split(" ")[0] ?? null;
const daysAgo = (data: AdviceData, value: string) => daysBetween(parseISO(studioDate(value)), parseISO(data.today));
const people = (list: [string, number][]) => list.map(([n, d]) => `${n} ${d}`).join(", ");

/**
 * A queue's key carries its NEWEST item. Ticking "2 requests wait" done hides
 * that pair; a new request makes a new key, so it shows instead of staying
 * hidden behind the earlier tick until the whole queue empties.
 */
const queueKey = (signal: string, stamps: string[]) => `${signal}:${stamps.reduce((a, b) => (b > a ? b : a), "")}`;

/** Sun–Thu dates from `from` to `to`, holidays and other marked days out — the Vacation page's own count. */
const studioDays = (data: AdviceData, from: string, to: string) => studioWorkdays(from, to, data.dayStates ?? []);

/** Weekly Plan: designers with 2+ open days next week — nothing planned, no absence. */
export function planGaps(data: AdviceData): Finding[] {
  const t = parseISO(data.today);
  const sunday = shiftDays(t, 7 - t.getDay());
  const [from, to] = [toISODate(sunday), toISODate(shiftDays(sunday, 4))];
  const days = studioDays(data, from, to);
  if (!days.length) return [];
  const planned = new Set((data.planEntries ?? []).map((e) => `${e.columnId}|${e.date}`));
  const open: [string, number][] = [];
  for (const c of data.planColumns ?? []) {
    const name = firstName(data, c.profileId);
    const n = days.filter((d) => !planned.has(`${c.id}|${d}`)).length;
    if (name && n >= 2) open.push([name, n]);
  }
  if (!open.length) return [];
  open.sort((a, b) => b[1] - a[1]);
  return [
    {
      key: `plan-gaps:${from}`,
      signal: "plan-gaps",
      kind: "heads",
      area: "Team",
      clientId: null,
      severity: 1,
      facts: { weekStart: from, open: people(open) },
      title: `Next week has open days: ${people(open.slice(0, 3))}${open.length > 3 ? "…" : ""}`,
      body: `${shortRangeLabel(from, to)}: days with nothing planned and no absence. ${open.length === 1 ? "One designer" : `${open.length} designers`} could take more.`,
      reminder: false,
      href: "/plan",
      action: "Open the weekly plan",
    },
  ];
}

/** Time Feed / Team: designers with 2+ workdays in the last week with no hours and no absence. */
export function missingHours(data: AdviceData): Finding[] {
  const yesterday = toISODate(shiftDays(parseISO(data.today), -1));
  const days = studioDays(data, toISODate(shiftDays(parseISO(data.today), -7)), yesterday);
  if (!days.length) return [];
  const away = new Set((data.absences ?? []).map((e) => `${e.columnId}|${e.date}`));
  const logged = new Set(data.entries.filter((e) => e.userId && e.minutes > 0).map((e) => `${e.userId}|${e.date}`));
  const missing: [string, number][] = [];
  for (const c of data.planColumns ?? []) {
    const name = firstName(data, c.profileId);
    // Only a planned absence excuses a day; marked days (holidays) are already out.
    const n = days.filter((d) => !logged.has(`${c.profileId}|${d}`) && !away.has(`${c.id}|${d}`)).length;
    if (name && n >= 2) missing.push([name, n]);
  }
  if (!missing.length) return [];
  missing.sort((a, b) => b[1] - a[1]);
  return [
    {
      key: `missing-hours:${yesterday}`,
      signal: "missing-hours",
      kind: "heads",
      area: "Team",
      clientId: null,
      severity: missing.some(([, n]) => n >= 4) ? 2 : 1,
      facts: { from: days[0], to: days[days.length - 1], missing: people(missing) },
      title: `Hours missing: ${people(missing.slice(0, 3))}${missing.length > 3 ? "…" : ""} days`,
      body: `Workdays from ${shortDate(days[0])} to ${shortDate(days[days.length - 1])} with nothing logged and no absence in the plan.`,
      reminder: true,
      href: "/feed",
      action: "Open the Time Feed",
    },
  ];
}

/** My Tasks: the owner's own tasks past their due date. */
export function myOverdue(data: AdviceData): Finding[] {
  if (!data.ownerId) return [];
  const late = data.tasks
    .filter((t) => t.assigneeId === data.ownerId && t.dueDate && t.dueDate < data.today && t.status !== "done" && !t.pending)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  if (!late.length) return [];
  const top = late.slice(0, 2).map((t) => `"${t.title}"`);
  return [
    {
      key: "my-overdue",
      signal: "my-overdue",
      kind: late.length >= 3 ? "now" : "heads",
      area: "My tasks",
      clientId: null,
      severity: late.length >= 5 ? 2 : 1,
      facts: { count: late.length, oldestDue: late[0].dueDate ?? null },
      title: `${late.length} of your tasks ${late.length === 1 ? "is" : "are"} past due`,
      body: `${top.join(", ")}${late.length > 2 ? ` and ${late.length - 2} more` : ""}. Close them, or move their dates.`,
      reminder: false,
      href: "/my-tasks",
      action: "Open My Tasks",
    },
  ];
}

/** Clients: tasks past their due date in the last 60 days, studio-wide, by client. */
export function overdueTasks(data: AdviceData): Finding[] {
  const horizon = toISODate(shiftDays(parseISO(data.today), -60));
  const live = new Map(liveClients(data).map((c) => [c.id, c.name]));
  const byClient = new Map<string, number>();
  for (const t of data.tasks) {
    if (!t.clientId || !live.has(t.clientId) || t.pending || t.status === "done" || !t.dueDate) continue;
    if (t.dueDate >= data.today || t.dueDate < horizon) continue;
    byClient.set(t.clientId, (byClient.get(t.clientId) ?? 0) + 1);
  }
  const total = [...byClient.values()].reduce((a, b) => a + b, 0);
  if (!total) return [];
  const list = [...byClient].sort((a, b) => b[1] - a[1]).map(([id, n]) => [live.get(id)!, n] as [string, number]);
  return [
    {
      key: "overdue",
      signal: "overdue",
      kind: "heads",
      area: "Delivery",
      clientId: null,
      severity: total >= 10 ? 2 : 1,
      facts: { count: total, clients: people(list) },
      title: `${total} ${total === 1 ? "task is" : "tasks are"} past due across ${list.length} ${list.length === 1 ? "client" : "clients"}`,
      body: `${people(list.slice(0, 4))}${list.length > 4 ? "…" : ""}. Due in the last 60 days and not done.`,
      reminder: false,
      href: "/clients",
      action: "Open Clients",
    },
  ];
}

/**
 * A queue that waits on the owner: how many, how old the oldest, and when it
 * turns urgent. Vacation, intake and freelancer logs differ only in these.
 */
function queueFinding(
  data: AdviceData,
  q: {
    signal: string;
    area: string;
    href: string;
    action: string;
    /** each waiting item's own date (what makes it old) and stamp (what makes it new) */
    items: { date: string; stamp: string }[];
    /** "Do now" from this many days old; severity 2 from `severeAt` */
    nowAt: number;
    severeAt: number;
    title: (n: number) => string;
    body: (oldest: number) => string;
    facts?: Finding["facts"];
  },
): Finding[] {
  if (!q.items.length) return [];
  const oldest = Math.max(...q.items.map((i) => daysAgo(data, i.date)));
  return [
    {
      key: queueKey(q.signal, q.items.map((i) => i.stamp)),
      signal: q.signal,
      kind: oldest >= q.nowAt ? "now" : "heads",
      area: q.area,
      clientId: null,
      severity: oldest >= q.severeAt ? 2 : 1,
      facts: { count: q.items.length, oldestDays: oldest, ...q.facts },
      title: q.title(q.items.length),
      body: q.body(oldest),
      reminder: true,
      href: q.href,
      action: q.action,
    },
  ];
}

const ago = (days: number) => (days === 0 ? "today" : `${days} days ago`);

/** Vacation: requests waiting for the owner's decision. */
export function vacationPending(data: AdviceData): Finding[] {
  return queueFinding(data, {
    signal: "vacation",
    area: "Team",
    href: "/vacation",
    action: "Open Vacation",
    items: (data.vacationPending ?? []).map((v) => ({ date: v.createdAt, stamp: v.createdAt })),
    nowAt: 2,
    severeAt: 5,
    title: (n) => `${plural(n, "vacation request waits", "vacation requests wait")} for you`,
    body: (oldest) => `The oldest was sent ${ago(oldest)}.`,
  });
}

/** Intake: client briefs not yet reviewed. */
export function intakePending(data: AdviceData): Finding[] {
  return queueFinding(data, {
    signal: "intake",
    area: "Intake",
    href: "/intake-queue",
    action: "Open Intake",
    items: (data.intakePending ?? []).map((r) => ({ date: r.createdAt, stamp: r.createdAt })),
    nowAt: 2,
    severeAt: 4,
    title: (n) => `${plural(n, "client brief waits", "client briefs wait")} for review`,
    body: (oldest) => `The oldest came in ${ago(oldest)}.`,
  });
}

/** Leads: replies the studio owes, and next steps past their date. */
export function leadsWaiting(data: AdviceData): Finding[] {
  const list = data.leadsWaiting ?? [];
  const owed = list.filter((l) => l.replyOwedSince && daysAgo(data, l.replyOwedSince) >= 2);
  const steps = list.filter((l) => l.stepDue && l.stepDue < data.today);
  if (!owed.length && !steps.length) return [];
  const names = [...new Set([...owed, ...steps].map((l) => l.company))];
  const parts = [owed.length ? `${plural(owed.length, "reply", "replies")} owed for 2+ days` : "", steps.length ? `${plural(steps.length, "next step", "next steps")} overdue` : ""].filter(Boolean);
  return [
    {
      key: queueKey("leads", [...owed.map((l) => l.replyOwedSince ?? ""), ...steps.map((l) => `${l.stepDue}|${l.company}`)]),
      signal: "leads",
      kind: owed.length ? "now" : "heads",
      area: "Leads",
      clientId: null,
      severity: owed.length >= 3 ? 2 : 1,
      facts: { replies: owed.length, steps: steps.length, leads: names.slice(0, 4).join(", ") },
      title: `${plural(names.length, "lead waits", "leads wait")} on you`,
      body: `${parts.join(", ")}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}.`,
      reminder: true,
      href: "/leads",
      action: "Open Leads",
    },
  ];
}

/** Candidates: active ones with no activity for two weeks. Counts only — no names leave the server. */
export function candidatesQuiet(data: AdviceData): Finding[] {
  const quiet = (data.candidates ?? []).filter((c) => daysAgo(data, c.lastActivityAt) >= 14);
  if (!quiet.length) return [];
  return [
    {
      key: "candidates",
      signal: "candidates",
      kind: "heads",
      area: "Hiring",
      clientId: null,
      severity: 1,
      facts: { count: quiet.length },
      title: `${plural(quiet.length, "candidate has", "candidates have")} gone quiet`,
      body: "Active, with no activity for two weeks or more. Move them on, or archive them.",
      reminder: false,
      href: "/candidates",
      action: "Open Candidates",
    },
  ];
}

/** Freelancers: logged hours waiting to be filed on a client and task. */
export function freelancerLogs(data: AdviceData): Finding[] {
  const list = data.freelancerPending ?? [];
  const minutes = list.reduce((t, l) => t + l.minutes, 0);
  return queueFinding(data, {
    signal: "freelancer-logs",
    area: "Freelancers",
    href: "/freelancers",
    action: "Open Freelancers",
    items: list.map((l) => ({ date: l.date, stamp: l.createdAt ?? l.date })),
    nowAt: 7,
    severeAt: 14,
    title: (n) => `${plural(n, "freelancer log waits", "freelancer logs wait")} for review`,
    body: (oldest) => `${formatHoursShort(minutes)}, the oldest from ${ago(oldest)}. They count as tracker hours once filed.`,
    facts: { hours: hrs(minutes) },
  });
}

/* ── The pane's figures ─────────────────────────────────────────────────── */

export interface PulseTile {
  label: string;
  /** a percentage (unit "%") or a count (unit ""), or null when there is nothing to show */
  value: number | null;
  unit: "%" | "";
  /** the figure it's compared with, same unit */
  against: number | null;
  /** oldest first, same unit */
  series: number[];
  good: boolean;
  note: string;
}

/** `findings` = this check's, so the cap tile counts them instead of running the cap check again. */
export function pulse(data: AdviceData, findings: Finding[] = findAll(data)): PulseTile[] {
  const byMonth = billableShareByMonth(data);
  const months = [...monthsBefore(data.today, 6), monthKey(data.today)];
  const share = months.map((k) => byMonth.get(k)).filter((m): m is { share: number; minutes: number } => !!m && m.minutes > 0);
  const nowShare = byMonth.get(monthKey(data.today));
  const prevShare = share.slice(0, -1);
  const avgShare = prevShare.length ? prevShare.slice(-3).reduce((t, m) => t + m.share, 0) / prevShare.slice(-3).length : null;

  const income = incomeCostSeries(data).slice(-7);
  const lastIncome = income.at(-1) ?? null;
  const beforeIncome = income.at(-2) ?? null;

  const pace = data.pace && data.pace.expectedByNow > 0 ? data.pace.soFar / data.pace.expectedByNow : null;

  const capped = liveClients(data).filter((c) => currentCap(data, c)).length;
  const over = findings.filter((f) => f.signal === "cap" && f.severity >= 3).length;

  return [
    {
      label: "Billable share",
      unit: "%",
      value: nowShare ? pct(nowShare.share) : null,
      against: avgShare == null ? null : pct(avgShare),
      series: share.map((m) => pct(m.share)),
      good: !nowShare || avgShare == null || nowShare.share >= avgShare - 0.05,
      note: avgShare == null ? "this month" : `vs ${pct(avgShare)}% average`,
    },
    {
      label: "Studio pace",
      unit: "%",
      value: pace == null ? null : pct(pace),
      // Measured against the goal itself; the note says so, and there's no "+N pts" to show.
      against: null,
      series: [],
      good: pace == null || pace >= 0.9,
      note: "of where the goal expects today",
    },
    {
      label: "Income vs costs",
      unit: "%",
      value: lastIncome ? pct(lastIncome.ratio) : null,
      against: beforeIncome ? pct(beforeIncome.ratio) : null,
      series: income.map((m) => pct(m.ratio)),
      good: !lastIncome || lastIncome.ratio >= 1,
      note: lastIncome ? `income ÷ costs, ${lastIncome.month}` : "no finance months yet",
    },
    // With no client capped there is nothing to count — the tile drops out.
    ...(capped === 0
      ? []
      : [{ label: "Over cap", unit: "" as const, value: over, against: null, series: [], good: over === 0, note: `of ${capped} capped clients` }]),
  ];
}
