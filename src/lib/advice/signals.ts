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

/** One thing a finding is about, to open from the card: a task (opened in the task pane) or a page. */
export interface FindingLink {
  label: string;
  sub?: string;
  taskId?: string;
  href?: string;
}

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
  /** the things themselves (Nitsan, 2026-10-25: "link those 10 so I can check them instead of searching") */
  list?: FindingLink[];
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
  leadsWaiting?: { id?: string; company: string; replyOwedSince: string | null; stepDue: string | null }[];
  /** open leads, all of them — for "who could be the next anchor client" */
  leadsOpen?: number;
  /**
   * People paid by the hour they log (hours-goal.ts HOURLY_TERMS — Dima). They
   * work when there's work, so an unlogged or unplanned day isn't a gap (Nitsan, 2026-10-25).
   */
  hourly?: string[];
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

/** The studio's payment terms: an invoice goes out when its period ends and is due 14 days later (Nitsan, 2026-10-25). */
export const PAYMENT_TERMS_DAYS = 14;

/**
 * A client's LAST ended billing period had hours, isn't marked paid, and is past
 * its payment date — never before: inside the 14-day terms nothing is late.
 * Only the last period, and only until 60 days after it ended (Nitsan,
 * 2026-10-24): 'paid' was ticked on 54 of 176 old periods, so looking further
 * back nagged about months long settled.
 *
 * Crossed with the hours: work logged for them since the period ended is work
 * done on credit, and the note says how much.
 */
export function periodUnpaid(data: AdviceData): Finding[] {
  const { report } = index(data);
  const out: Finding[] = [];
  for (const c of liveClients(data)) {
    const p = data.periods.filter((x) => x.clientId === c.id && x.dateTo < data.today).sort((a, b) => b.dateTo.localeCompare(a.dateTo))[0];
    if (!p || p.paid) continue;
    const days = daysBetween(parseISO(p.dateTo), parseISO(data.today));
    const late = days - PAYMENT_TERMS_DAYS;
    if (late < 1 || days > 60) continue;
    const minutes = minutesOn(data, c.id, report, p.dateFrom, p.dateTo);
    if (minutes <= 0) continue;
    const due = toISODate(shiftDays(parseISO(p.dateTo), PAYMENT_TERMS_DAYS));
    const since = minutesOn(data, c.id, report, toISODate(shiftDays(parseISO(p.dateTo), 1)));
    const onCredit = since >= 5 * 60;
    out.push({
      key: `unpaid:${c.id}:${p.dateFrom}`,
      signal: "unpaid",
      kind: late >= 7 ? "now" : "heads",
      area: "Billing",
      clientId: c.id,
      severity: (late >= 21 ? 3 : late >= 7 ? 2 : 1) + (onCredit && late >= 7 ? 1 : 0),
      facts: { client: c.name, period: p.label, dueDate: due, daysLate: late, hours: hrs(minutes), hoursSince: hrs(since) },
      title: `${c.name}: ${p.label} is ${late} ${late === 1 ? "day" : "days"} past its payment date`,
      body:
        `${formatHoursShort(minutes)} in the period; payment was due ${shortDate(due)} (${PAYMENT_TERMS_DAYS}-day terms).` +
        (onCredit
          ? ` The team has logged ${formatHoursShort(since)} for them since — a polite nudge now, before more work goes out on credit.`
          : " If it's paid, tick it; if not, a short reminder."),
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

// Billable share is NOT here: Home shows it, and the pane isn't a second
// dashboard (Nitsan, 2026-10-25) — it says what the figures mean together.

/**
 * The month behind finance-admin's goal by 10% or more — and where the hours to
 * win it back are. Home's banner already says HOW FAR behind; this says what to
 * do: the unplanned designer-days of the next two workdays, and the billable
 * clients with estimate hours left to spend.
 */
export function paceBehind(data: AdviceData): Finding[] {
  const p = data.pace;
  if (!p || p.expectedByNow <= 0) return [];
  const ratio = p.soFar / p.expectedByNow;
  const severity = ratio < 0.8 ? 2 : ratio < 0.9 ? 1 : 0;
  if (severity === 0) return [];
  const t = parseISO(data.today);
  const monthEnd = toISODate(new Date(t.getFullYear(), t.getMonth() + 1, 0));
  const left = studioDays(data, data.today, monthEnd).length;
  const openDays = openPlanDays(data).reduce((n, o) => n + o.days.length, 0);
  const room = estimateRoom(data).slice(0, 2);
  const where = [
    openDays ? `${plural(openDays, "designer-day", "designer-days")} in the next two workdays ${openDays === 1 ? "is" : "are"} still unplanned` : "",
    room.length ? `${room.map((r) => `${r.name} has ${Math.round(r.minutes / 60)}h`).join(" and ")} left on ${room.length === 1 ? "its" : "their"} estimate` : "",
  ].filter(Boolean);
  return [
    {
      key: `pace:${monthKey(data.today)}`,
      signal: "pace",
      kind: "heads",
      area: "Studio",
      clientId: null,
      severity,
      facts: { pacePct: pct(ratio), workdaysLeft: left, openDays },
      title: `${100 - pct(ratio)}% behind the month's pace, ${plural(left, "workday", "workdays")} left`,
      body: where.length
        ? `Where to win it back: ${where.join("; ")}. Billable work in those gaps is the cheapest catch-up there is.`
        : "Every designer is planned and no estimate has hours to spare — the gap closes only with new work. Worth chasing the open leads this week.",
      reminder: false,
      href: openDays ? "/plan" : "/leads",
      action: openDays ? "Open the weekly plan" : "Open Leads",
    },
  ];
}

/**
 * Billable clients being worked on now (hours in the last 30 days) whose
 * published estimate still has hours in it: the top of the range less what's
 * been logged since. Most room first. An estimate with no recent hours may be a
 * quote never won (measured 2026-10-25: one read "762h left"), so it isn't room.
 */
function estimateRoom(data: AdviceData): { name: string; minutes: number }[] {
  const { billable } = index(data);
  const recent = toISODate(shiftDays(parseISO(data.today), -30));
  return liveClients(data)
    .flatMap((c) => {
      const est = data.estimates.find((e) => e.clientId === c.id);
      if (!c.billable || !est || est.hours.max <= 0 || minutesOn(data, c.id, billable, recent) <= 0) return [];
      const left = est.hours.max * 60 - minutesOn(data, c.id, billable, studioDate(est.publishedAt));
      return left >= 5 * 60 ? [{ name: c.name, minutes: left }] : [];
    })
    .sort((a, b) => b.minutes - a.minutes);
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
  paceBehind,
  incomeVsCosts,
  concentration,
  clientQuiet,
  planGaps,
  missingHours,
  internalHeavy,
  myOverdue,
  overdueTasks,
  dueUnassigned,
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

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (iso: string) => WEEKDAY[parseISO(iso).getDay()];
/** "Nadav", "Nadav and Aki", "Nadav, Aki and Dana". */
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/**
 * A short, stable name for a set of ids. A team finding's key carries WHO it is
 * about, so dismissing "Nadav and Aki" stays dismissed while it's still them —
 * and someone new joining it is a new finding that shows.
 */
function hashOf(ids: string[]): string {
  let h = 5381;
  for (const ch of [...ids].sort().join(",")) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}
/** The plan's designer columns, hourly freelancers out (they work when there's work). */
const salaried = (data: AdviceData) => {
  const hourly = new Set(data.hourly ?? []);
  return (data.planColumns ?? []).filter((c) => !hourly.has(c.profileId));
};
const isOpenTask = (t: AdviceData["tasks"][number]) => !t.pending && t.status !== "done";

/** The next `n` workdays after today: Sun–Thu, holidays and other marked days out. */
function nextWorkdays(data: AdviceData, n: number): string[] {
  const from = toISODate(shiftDays(parseISO(data.today), 1));
  return studioDays(data, from, toISODate(shiftDays(parseISO(data.today), 14))).slice(0, n);
}

/**
 * Who has nothing planned in the next two workdays (no entry, no absence). The
 * studio plans a day or two ahead (Nitsan, 2026-10-25) — next week being empty
 * on a Sunday is normal, tomorrow being empty is not.
 */
export function openPlanDays(data: AdviceData): { profileId: string; name: string; days: string[] }[] {
  const days = nextWorkdays(data, 2);
  const planned = new Set((data.planEntries ?? []).map((e) => `${e.columnId}|${e.date}`));
  return salaried(data).flatMap((c) => {
    const name = firstName(data, c.profileId);
    const open = days.filter((d) => !planned.has(`${c.id}|${d}`));
    return name && open.length ? [{ profileId: c.profileId, name, days: open }] : [];
  });
}

/** Weekly Plan: designers with nothing planned in the next two workdays — and what they have due. */
export function planGaps(data: AdviceData): Finding[] {
  const days = nextWorkdays(data, 2);
  const open = openPlanDays(data);
  if (!days.length || !open.length) return [];
  const soon = toISODate(shiftDays(parseISO(data.today), 7));
  const dueOf = (id: string) => data.tasks.filter((t) => t.assigneeId === id && isOpenTask(t) && t.dueDate && t.dueDate >= data.today && t.dueDate <= soon).length;
  const tomorrow = toISODate(shiftDays(parseISO(data.today), 1));
  const dayWord = (d: string) => (d === tomorrow ? "tomorrow" : weekday(d));
  const first = open.filter((o) => o.days.includes(days[0]));
  const lines = open.map((o) => {
    const due = dueOf(o.profileId);
    return `${o.name} — ${o.days.map(weekday).join(", ")}${due ? ` (${plural(due, "task", "tasks")} due this week)` : ""}`;
  });
  const anyDue = open.some((o) => dueOf(o.profileId) > 0);
  return [
    {
      key: `plan-gaps:${days[0]}:${hashOf(open.map((o) => `${o.profileId}:${o.days.join("+")}`))}`,
      signal: "plan-gaps",
      kind: first.length ? "now" : "heads",
      area: "Team",
      clientId: null,
      severity: first.length ? 2 : 1,
      facts: { days: days.join(","), open: open.map((o) => `${o.name} ${o.days.length}`).join(", ") },
      title: first.length
        ? `Nothing planned ${dayWord(days[0])} for ${andList(first.map((o) => o.name))}`
        : `Nothing planned ${dayWord(days[1] ?? days[0])} for ${andList(open.map((o) => o.name))}`,
      body: `${lines.join(". ")}.${anyDue ? " Their own due tasks are the obvious first fill." : " Worth deciding now — a day nobody planned tends to go to internal work."}`,
      reminder: false,
      href: "/plan",
      action: "Open the weekly plan",
    },
  ];
}

/** Time Feed / Team: designers with 2+ workdays in the last week with no hours and no absence. Hourly freelancers aren't counted. */
export function missingHours(data: AdviceData): Finding[] {
  const yesterday = toISODate(shiftDays(parseISO(data.today), -1));
  const days = studioDays(data, toISODate(shiftDays(parseISO(data.today), -7)), yesterday);
  if (!days.length) return [];
  const away = new Set((data.absences ?? []).map((e) => `${e.columnId}|${e.date}`));
  const logged = new Set(data.entries.filter((e) => e.userId && e.minutes > 0).map((e) => `${e.userId}|${e.date}`));
  const missing: { id: string; name: string; n: number }[] = [];
  for (const c of salaried(data)) {
    const name = firstName(data, c.profileId);
    // Only a planned absence excuses a day; marked days (holidays) are already out.
    const n = days.filter((d) => !logged.has(`${c.profileId}|${d}`) && !away.has(`${c.id}|${d}`)).length;
    if (name && n >= 2) missing.push({ id: c.profileId, name, n });
  }
  if (!missing.length) return [];
  missing.sort((a, b) => b.n - a.n);
  const list = missing.map((m) => [m.name, m.n] as [string, number]);
  const t = parseISO(data.today);
  return [
    {
      // The week and the people: dismissed stays dismissed for them this week.
      key: `missing-hours:${toISODate(shiftDays(t, -t.getDay()))}:${hashOf(missing.map((m) => m.id))}`,
      signal: "missing-hours",
      kind: "heads",
      area: "Team",
      clientId: null,
      severity: missing.some((m) => m.n >= 4) ? 2 : 1,
      facts: { from: days[0], to: days[days.length - 1], missing: people(list) },
      title: `Hours missing: ${people(list.slice(0, 3))}${list.length > 3 ? "…" : ""} days`,
      body: `Workdays from ${shortDate(days[0])} to ${shortDate(days[days.length - 1])} with nothing logged and no absence in the plan. Hours filled in a week later are guesses — and Sunday's client reports go out on them.`,
      reminder: true,
      href: "/feed",
      action: "Open the Time Feed",
    },
  ];
}

/** Tasks as card links: title, then client and due date. */
function taskLinks(data: AdviceData, tasks: AdviceData["tasks"]): FindingLink[] {
  const name = new Map(data.clients.map((c) => [c.id, c.name]));
  return tasks.map((t) => ({
    label: t.title || "Untitled task",
    sub: [t.clientId ? name.get(t.clientId) : null, t.dueDate ? `due ${shortDate(t.dueDate)}` : null, t.assigneeId ? firstName(data, t.assigneeId) : "nobody on it"]
      .filter(Boolean)
      .join(" · "),
    taskId: t.id,
  }));
}

/** My Tasks: the owner's own tasks past their due date. */
export function myOverdue(data: AdviceData): Finding[] {
  if (!data.ownerId) return [];
  const late = data.tasks
    .filter((t) => t.assigneeId === data.ownerId && t.dueDate && t.dueDate < data.today && isOpenTask(t))
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  if (!late.length) return [];
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
      body: `The oldest was due ${shortDate(late[0].dueDate!)}. Close the ones that are done and move the dates that slipped — the team reads your dates as the real ones.`,
      reminder: false,
      href: "/my-tasks",
      action: "Open My Tasks",
      list: taskLinks(data, late),
    },
  ];
}

/**
 * Clients: open tasks due in the last 60 days, studio-wide — each one linked,
 * and read for a pattern: one person holding most of them is a load problem,
 * many with nobody on them is a planning one.
 */
export function overdueTasks(data: AdviceData): Finding[] {
  const horizon = toISODate(shiftDays(parseISO(data.today), -60));
  const live = new Map(liveClients(data).map((c) => [c.id, c.name]));
  const late = data.tasks
    .filter((t) => t.clientId && live.has(t.clientId) && isOpenTask(t) && t.dueDate && t.dueDate < data.today && t.dueDate >= horizon)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  if (!late.length) return [];
  const byClient = new Map<string, number>();
  const byPerson = new Map<string, number>();
  for (const t of late) {
    byClient.set(t.clientId!, (byClient.get(t.clientId!) ?? 0) + 1);
    if (t.assigneeId) byPerson.set(t.assigneeId, (byPerson.get(t.assigneeId) ?? 0) + 1);
  }
  const list = [...byClient].sort((a, b) => b[1] - a[1]).map(([id, n]) => [live.get(id)!, n] as [string, number]);
  const total = late.length;
  const nobody = late.filter((t) => !t.assigneeId).length;
  const [topId, topN] = [...byPerson].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const top = topId ? firstName(data, topId) : null;
  const pattern = [
    top && topN >= 3 && topN / total >= 0.4 ? `${topN} of them are ${top}'s — too much on one desk, or dates nobody moved?` : "",
    nobody >= 2 ? `${nobody} have nobody on them.` : "",
  ].filter(Boolean);
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
      body: `${people(list.slice(0, 4))}${list.length > 4 ? "…" : ""}. ${pattern.length ? pattern.join(" ") : "Close what's done and move what slipped, so the client timelines stay honest."}`,
      reminder: false,
      href: "/clients",
      action: "Open Clients",
      list: taskLinks(data, late),
    },
  ];
}

/** Clients / Plan: open client tasks due in the next 7 days with nobody on them. */
export function dueUnassigned(data: AdviceData): Finding[] {
  const live = new Set(liveClients(data).map((c) => c.id));
  const soon = toISODate(shiftDays(parseISO(data.today), 7));
  const tasks = data.tasks
    .filter((t) => t.clientId && live.has(t.clientId) && isOpenTask(t) && !t.assigneeId && t.dueDate && t.dueDate >= data.today && t.dueDate <= soon)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  if (!tasks.length) return [];
  const inTwo = toISODate(shiftDays(parseISO(data.today), 2));
  const urgent = tasks.filter((t) => t.dueDate! <= inTwo).length;
  const open = openPlanDays(data);
  return [
    {
      key: `unassigned:${hashOf(tasks.map((t) => t.id))}`,
      signal: "unassigned",
      kind: urgent ? "now" : "heads",
      area: "Delivery",
      clientId: null,
      severity: urgent ? 2 : 1,
      facts: { count: tasks.length, urgent },
      title: `${plural(tasks.length, "task due this week has", "tasks due this week have")} nobody on ${tasks.length === 1 ? "it" : "them"}`,
      body: open.length
        ? `${andList(open.map((o) => o.name))} ${open.length === 1 ? "has" : "have"} open days in the plan — a natural match.`
        : "Everyone is planned for the next two days, so these need a decision: who, or a later date.",
      reminder: false,
      href: "/plan",
      action: "Open the weekly plan",
      list: taskLinks(data, tasks),
    },
  ];
}

/* ── Insights: figures from different pages, read together ──────────────── */

/** Billable minutes per client from `from` to `to` (keys tasks and internal clients out). */
function billableByClient(data: AdviceData, from: string, to = data.today): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of liveClients(data)) {
    const m = minutesOn(data, c.id, index(data).billable, from, to);
    if (m > 0) out.set(c.id, m);
  }
  return out;
}

/**
 * One client carrying the studio: 40%+ of the last 90 days' billable hours. Read
 * with the leads — the answer to concentration is a second anchor client.
 */
export function concentration(data: AdviceData): Finding[] {
  const by = billableByClient(data, toISODate(shiftDays(parseISO(data.today), -90)));
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  if (total < 100 * 60) return [];
  const [id, minutes] = [...by].sort((a, b) => b[1] - a[1])[0];
  const share = minutes / total;
  if (share < 0.4) return [];
  const c = data.clients.find((x) => x.id === id)!;
  const leads = data.leadsOpen ?? 0;
  return [
    {
      key: `concentration:${id}:${monthKey(data.today)}`,
      signal: "concentration",
      kind: "idea",
      area: "Studio",
      clientId: id,
      severity: share >= 0.55 ? 2 : 1,
      facts: { client: c.name, sharePct: pct(share), hours: hrs(minutes) },
      title: `${c.name} is ${pct(share)}% of the studio's billable work`,
      body:
        `${formatHoursShort(minutes)} of the last 90 days' billable hours. If they paused, that much of the studio would stop with them.` +
        (leads ? ` ${plural(leads, "lead is", "leads are")} open — which could become the second anchor?` : " No leads are open — a good month to start conversations."),
      reminder: false,
      href: "/leads",
      action: "Open Leads",
    },
  ];
}

/**
 * A client gone quiet: 15h+ a month over the three months before, under 40% of
 * that in the last 30 days. Often the moment to propose the next phase — before
 * someone else does.
 */
export function clientQuiet(data: AdviceData): Finding[] {
  const d = (n: number) => toISODate(shiftDays(parseISO(data.today), n));
  const before = billableByClient(data, d(-120), d(-31));
  const recent = billableByClient(data, d(-30));
  const out: Finding[] = [];
  for (const [id, m] of before) {
    const monthly = m / 3;
    const last = recent.get(id) ?? 0;
    if (monthly < 15 * 60 || last >= monthly * 0.4) continue;
    const c = data.clients.find((x) => x.id === id)!;
    out.push({
      key: `client-quiet:${id}:${monthKey(data.today)}`,
      signal: "client-quiet",
      kind: "idea",
      area: "Clients",
      clientId: id,
      severity: last === 0 ? 2 : 1,
      facts: { client: c.name, monthlyHours: hrs(monthly), lastHours: hrs(last) },
      title: `${c.name} has gone quiet`,
      body: `About ${Math.round(monthly / 60)}h a month over the three months before; ${last ? formatHoursShort(last) : "nothing"} in the last 30 days. A natural moment to check in — is there a next phase to propose?`,
      reminder: false,
      href: `/clients/${id}`,
      action: "Open the client",
    });
  }
  return out;
}

/**
 * Team: designers whose last four weeks went mostly (50%+) to internal work —
 * worth knowing when the month is behind pace, or when clients wait.
 */
export function internalHeavy(data: AdviceData): Finding[] {
  const from = toISODate(shiftDays(parseISO(data.today), -28));
  const { billable } = index(data);
  const tot = new Map<string, [number, number]>();
  for (const e of data.entries) {
    if (!e.userId || e.date < from) continue;
    const [b, a] = tot.get(e.userId) ?? [0, 0];
    tot.set(e.userId, [b + (billable.has(e.taskId) ? e.minutes : 0), a + e.minutes]);
  }
  const heavy = salaried(data).flatMap((c) => {
    const [b, a] = tot.get(c.profileId) ?? [0, 0];
    const name = firstName(data, c.profileId);
    const internal = a ? 1 - b / a : 0;
    return name && a >= 20 * 60 && internal >= 0.5 ? [{ id: c.profileId, name, internal }] : [];
  });
  if (!heavy.length) return [];
  heavy.sort((a, b) => b.internal - a.internal);
  const behind = data.pace && data.pace.expectedByNow > 0 && data.pace.soFar / data.pace.expectedByNow < 0.9;
  return [
    {
      key: `internal:${monthKey(data.today)}:${hashOf(heavy.map((h) => h.id))}`,
      signal: "internal",
      kind: "idea",
      area: "Team",
      clientId: null,
      severity: 1,
      facts: { people: heavy.map((h) => `${h.name} ${pct(h.internal)}%`).join(", ") },
      title: `${andList(heavy.map((h) => h.name))}: mostly internal work this month`,
      body:
        `${heavy.map((h) => `${h.name} ${pct(h.internal)}%`).join(", ")} of the last four weeks went to non-billable tasks.` +
        (behind ? " With the month behind pace, that's where billable hours could come from." : " By plan — or room for client work?"),
      reminder: false,
      href: "/team",
      action: "Open Team",
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
      list: [...owed, ...steps]
        .filter((l, i, all) => all.findIndex((x) => x.company === l.company) === i)
        .map((l) => ({
          label: l.company,
          sub: [l.replyOwedSince && daysAgo(data, l.replyOwedSince) >= 2 ? `reply owed ${ago(daysAgo(data, l.replyOwedSince))}` : null, l.stepDue && l.stepDue < data.today ? `next step due ${shortDate(l.stepDue)}` : null]
            .filter(Boolean)
            .join(" · "),
          href: l.id ? `/leads/${l.id}` : "/leads",
        })),
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

/**
 * Which page a figure belongs to (context.ts picks them): the pane shows the
 * figures of the page you're on, never Home's own again (Nitsan, 2026-10-25 —
 * billable share and the pace live on Home).
 */
export type TileScope = "money" | "billing" | "concentration" | "plan" | "team" | "client";

export interface PulseTile {
  label: string;
  /** a percentage, a count or hours, or null when there is nothing to show */
  value: number | null;
  unit: "%" | "" | "h";
  /** the figure it's compared with, same unit */
  against: number | null;
  /** oldest first, same unit */
  series: number[];
  good: boolean;
  note: string;
  /** what the figure is and how it's counted — the tile's hover box */
  help: string;
  scope: TileScope;
  clientId: string | null;
}

/** The last `n` 30-day windows, oldest first: [from, to] each. */
function windows(today: string, n: number): [string, string][] {
  const d = (k: number) => toISODate(shiftDays(parseISO(today), k));
  return Array.from({ length: n }, (_, i) => [d(-30 * (n - i) + 1), d(-30 * (n - i - 1))] as [string, string]);
}

/** `findings` = this check's, so the cap tile counts them instead of running the cap check again. */
export function pulse(data: AdviceData, findings: Finding[] = findAll(data)): PulseTile[] {
  const tiles: PulseTile[] = [];
  const studio = { clientId: null };

  const income = incomeCostSeries(data).slice(-7);
  const lastIncome = income.at(-1) ?? null;
  tiles.push({
    ...studio,
    scope: "money",
    label: "Income vs costs",
    unit: "%",
    value: lastIncome ? pct(lastIncome.ratio) : null,
    against: income.at(-2) ? pct(income.at(-2)!.ratio) : null,
    series: income.map((m) => pct(m.ratio)),
    good: !lastIncome || lastIncome.ratio >= 1,
    note: lastIncome ? `income ÷ costs, ${lastIncome.month}` : "no finance months yet",
    help: "Each finished month's income divided by its costs, from the finance app. Over 100% the month paid for itself. The line is the last seven months; the change is against the month before.",
  });

  // Concentration: the biggest client's share of billable hours, per 30 days.
  const wins = windows(data.today, 6);
  const shares = wins.map(([f, t]) => {
    const by = billableByClient(data, f, t);
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    const top = [...by].sort((a, b) => b[1] - a[1])[0];
    return total && top ? { id: top[0], share: top[1] / total } : null;
  });
  const by90 = billableByClient(data, toISODate(shiftDays(parseISO(data.today), -90)));
  const total90 = [...by90.values()].reduce((a, b) => a + b, 0);
  const top90 = [...by90].sort((a, b) => b[1] - a[1])[0];
  const topName = top90 ? data.clients.find((c) => c.id === top90[0])?.name : null;
  tiles.push({
    ...studio,
    scope: "concentration",
    label: "Biggest client",
    unit: "%",
    value: total90 && top90 ? pct(top90[1] / total90) : null,
    against: null,
    series: shares.filter((s): s is { id: string; share: number } => !!s).map((s) => pct(s.share)),
    good: !total90 || !top90 || top90[1] / total90 < 0.4,
    note: topName ? `${topName}, last 90 days` : "no billable hours yet",
    help: "The share of the studio's billable hours that went to its single biggest client over the last 90 days. Over 40% means one client's pause would empty much of the studio. The line is each 30 days, whoever was biggest then.",
  });

  const capped = liveClients(data).filter((c) => currentCap(data, c)).length;
  if (capped) {
    const over = findings.filter((f) => f.signal === "cap" && f.severity >= 3).length;
    tiles.push({
      ...studio,
      scope: "billing",
      label: "Over cap",
      unit: "",
      value: over,
      against: null,
      series: [],
      good: over === 0,
      note: `of ${capped} capped clients`,
      help: "Clients whose billable hours in the current billing period have passed its hour cap. Keys tasks don't count.",
    });
  }

  // The next two workdays, planned: designer-days with an entry or an absence.
  const next = nextWorkdays(data, 2);
  const team = salaried(data);
  if (next.length && team.length) {
    const open = openPlanDays(data).reduce((n, o) => n + o.days.length, 0);
    const all = next.length * team.length;
    tiles.push({
      ...studio,
      scope: "plan",
      label: "Next 2 days planned",
      unit: "%",
      value: pct((all - open) / all),
      against: null,
      series: [],
      good: open === 0,
      note: `${all - open} of ${all} designer-days`,
      help: `The next two workdays (${next.map(shortDate).join(", ")}) for every designer in the plan: the share that has something planned or an absence. Hourly freelancers aren't counted — they work when there's work.`,
    });
  }

  // Days with hours, per 7-day week: logged or away, over designer-workdays.
  if (team.length) {
    const away = new Set((data.absences ?? []).map((e) => `${e.columnId}|${e.date}`));
    const logged = new Set(data.entries.filter((e) => e.userId && e.minutes > 0).map((e) => `${e.userId}|${e.date}`));
    const weeks = Array.from({ length: 6 }, (_, i) => {
      const to = toISODate(shiftDays(parseISO(data.today), -1 - 7 * (5 - i)));
      const days = studioDays(data, toISODate(shiftDays(parseISO(to), -6)), to);
      let done = 0;
      for (const c of team) for (const d of days) if (logged.has(`${c.profileId}|${d}`) || away.has(`${c.id}|${d}`)) done++;
      return days.length ? done / (days.length * team.length) : null;
    }).filter((x): x is number => x != null);
    const last = weeks.at(-1);
    if (last != null)
      tiles.push({
        ...studio,
        scope: "team",
        label: "Days with hours",
        unit: "%",
        value: pct(last),
        against: weeks.length >= 2 ? pct(weeks.at(-2)!) : null,
        series: weeks.map(pct),
        good: last >= 0.9,
        note: "last 7 days, every designer",
        help: "Of every designer's workdays in the last seven days, the share with hours logged or an absence in the plan. Holidays are out; hourly freelancers aren't counted. The line is the last six weeks.",
      });
  }

  // Each client's own figures, for its page and its Client Reports tab.
  const { billable } = index(data);
  for (const c of liveClients(data)) {
    if (!c.billable) continue;
    const monthly = wins.map(([f, t]) => minutesOn(data, c.id, billable, f, t));
    if (!monthly.some((m) => m > 0)) continue;
    const [now, ...before] = [monthly.at(-1)!, ...monthly.slice(-4, -1)];
    const avg = before.reduce((a, b) => a + b, 0) / before.length;
    const scope = { scope: "client" as const, clientId: c.id };
    tiles.push({
      ...scope,
      label: "Last 30 days",
      unit: "h",
      value: Math.round(now / 60),
      against: null,
      series: monthly.map((m) => Math.round(m / 60)),
      good: !avg || now >= avg * 0.6,
      note: avg ? `vs ~${Math.round(avg / 60)}h per 30 days before` : "new this month",
      help: `Billable hours on ${c.name} in the last 30 days (keys tasks out). The line is each 30 days over six; the note is the average of the three before.`,
    });
    const mine = by90.get(c.id) ?? 0;
    tiles.push({
      ...scope,
      label: "Share of the studio",
      unit: "%",
      value: total90 ? pct(mine / total90) : null,
      against: null,
      series: wins.map(([f, t]) => {
        const by = billableByClient(data, f, t);
        const tot = [...by.values()].reduce((a, b) => a + b, 0);
        return tot ? pct((by.get(c.id) ?? 0) / tot) : 0;
      }),
      good: !total90 || mine / total90 < 0.4,
      note: "of billable hours, last 90 days",
      help: `${c.name}'s part of all the studio's billable hours over the last 90 days. Over 40% is a lot of the studio resting on one client.`,
    });
    const est = data.estimates.find((e) => e.clientId === c.id);
    if (est && est.hours.max > 0) {
      const since = studioDate(est.publishedAt);
      const used = minutesOn(data, c.id, billable, since) / 60 / est.hours.max;
      tiles.push({
        ...scope,
        label: "Estimate used",
        unit: "%",
        value: pct(used),
        against: null,
        series: [],
        good: used < 0.9,
        note: `of ${est.hours.max}h, since ${shortDate(since)}`,
        help: `Billable hours since the latest estimate was published (${shortDate(since)}), against the top of its range. Past 100% the client is getting more than they were quoted.`,
      });
    }
  }
  return tiles;
}
