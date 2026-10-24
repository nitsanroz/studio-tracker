// The studio's pace against finance-admin's hours goal, worked out server-side
// from the finance P&L with the service key. Moved out of /api/hours-goal
// (v1.80.0) so &advice reads the SAME pace the Home banner shows — a second copy
// of these queries would drift from the first.
//
// ⚠️ SERVER ONLY. It reads finance tables; callers must pass on hours and
// percentages only, never ₪ (see the route's note).

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/db";
import { parseISO, studioToday } from "@/lib/format";
import { HOURLY_TERMS, LINE, hoursGoal, type FormulaFreelancer, type GoalFreelancer, type GoalInputs, type PnlMonthly } from "@/lib/hours-goal";

/**
 * This month's goal reading, or null when the P&L can't produce one. Throws on a
 * query error. `liveHours` = this month's billable hours when the caller already
 * has them (&advice loads the month's entries anyway), else they're fetched.
 */
export async function studioGoal(sb: SupabaseClient, liveHours?: number) {
  // The studio's today, not the server's (Vercel runs in UTC).
  const today = parseISO(studioToday());
  const [y, m] = [today.getFullYear(), today.getMonth() + 1];

  // None of the three needs another: side by side.
  const [{ data: pnlRows, error }, soFar, inputs] = await Promise.all([
    sb
      .from("finance_pnl_monthly")
      .select("year, month, line_item, value")
      .gte("year", y - 1)
      .lte("year", y)
      .in("line_item", Object.values(LINE)),
    liveHours ?? billableHoursForMonth(sb, y, m),
    goalInputs(sb, y, m),
  ]);
  if (error) throw new Error(error.message);
  const pnl: PnlMonthly[] = (pnlRows ?? [])
    .filter((r) => !(r.year === y && r.month === m && r.line_item === LINE.totalHours))
    .map((r) => ({ year: r.year, month: r.month, lineItem: r.line_item, value: Number(r.value) }));
  pnl.push({ year: y, month: m, lineItem: LINE.totalHours, value: soFar });

  return hoursGoal(pnl, y, today, { inputs });
}

const monthBounds = (year: number, month: number) => {
  const mm = String(month).padStart(2, "0");
  return [`${year}-${mm}-01`, `${year}-${mm}-${new Date(year, month, 0).getDate()}`] as const;
};

/** Billable hours logged this month: billable tasks of billable clients. */
async function billableHoursForMonth(sb: SupabaseClient, year: number, month: number): Promise<number> {
  const [from, to] = monthBounds(year, month);
  const entries = await fetchAll<{ task_id: string; minutes: number | null }>(sb, "time_entries", "task_id, minutes", (q) =>
    q.gte("date", from).lte("date", to).not("minutes", "is", null),
  );
  const taskIds = [...new Set(entries.map((e) => e.task_id))];
  const tasks: { id: string; client_id: string | null; billable: boolean }[] = [];
  for (let i = 0; i < taskIds.length; i += 100) {
    const { data } = await sb.from("tasks").select("id, client_id, billable").in("id", taskIds.slice(i, i + 100));
    tasks.push(...(data ?? []));
  }
  const clientIds = [...new Set(tasks.map((t) => t.client_id).filter((c): c is string => !!c))];
  const { data: clients } = clientIds.length
    ? await sb.from("clients").select("id, billable").in("id", clientIds)
    : { data: [] as { id: string; billable: boolean }[] };
  const billableClient = new Set((clients ?? []).filter((c) => c.billable).map((c) => c.id));
  const billableTask = new Set(tasks.filter((t) => t.billable && t.client_id && billableClient.has(t.client_id)).map((t) => t.id));
  return entries.reduce((t, e) => (billableTask.has(e.task_id) ? t + (e.minutes ?? 0) / 60 : t), 0);
}

/** Designers away (weekly plan) and hourly freelancers' pace — finance-admin's
 * getGoalInputs, mirrored. */
async function goalInputs(sb: SupabaseClient, year: number, month: number): Promise<GoalInputs> {
  const [from, monthEnd] = monthBounds(year, month);
  const [fromYear, fromMonth] = month > 3 ? [year, month - 3] : [year - 1, month + 9];
  const ym = (yy: number, mm: number) => yy * 12 + mm;

  const [members, absences, pay] = await Promise.all([
    fetchAll<{ id: string; name: string; profile_id: string | null }>(sb, "plan_columns", "id, name, profile_id", (q) =>
      q.eq("type", "member"),
    ),
    fetchAll<{ date: string; column_id: string }>(sb, "plan_entries", "date, column_id", (q) =>
      q.eq("type", "absence").gte("date", from).lte("date", monthEnd),
    ),
    fetchAll<{ person_name: string; profile_id: string; year: number; month: number; amount: number | string }>(
      sb,
      "finance_freelance",
      "person_name, profile_id, year, month, amount",
      (q) => q.gte("year", fromYear).lte("year", year).not("profile_id", "is", null),
    ),
  ]);

  const profileOfColumn = new Map(members.map((c) => [c.id, c.profile_id]));
  const nameOfColumn = new Map(members.map((c) => [c.id, c.name]));
  const seen = new Set<string>();
  const absent: Record<string, number> = {};
  const awayByName = new Map<string, string[]>();
  const absentByProfile = new Map<string, string[]>();
  for (const e of absences) {
    const key = `${e.date}|${e.column_id}`;
    if (!profileOfColumn.has(e.column_id) || seen.has(key)) continue;
    seen.add(key);
    absent[e.date] = (absent[e.date] ?? 0) + 1;
    const name = nameOfColumn.get(e.column_id)!;
    awayByName.set(name, [...(awayByName.get(name) ?? []), e.date]);
    const pid = profileOfColumn.get(e.column_id);
    if (pid) absentByProfile.set(pid, [...(absentByProfile.get(pid) ?? []), e.date]);
  }

  const inRange = pay.filter((r) => ym(r.year, r.month) >= ym(fromYear, fromMonth) && ym(r.year, r.month) <= ym(year, month));
  const profiles = [...new Set(inRange.map((r) => r.profile_id))];
  const startOfRange = `${fromYear}-${String(fromMonth).padStart(2, "0")}-01`;
  // The sliding-rate freelancers need only the absences above — fetched beside these hours, not after.
  const [entries, formulaFreelancers] = await Promise.all([
    profiles.length
      ? fetchAll<{ user_id: string; date: string; minutes: number | null }>(sb, "time_entries", "user_id, date, minutes", (q) =>
          q.in("user_id", profiles).gte("date", startOfRange).lte("date", monthEnd).not("minutes", "is", null),
        )
      : [],
    slidingRateFreelancers(sb, year, month, startOfRange, monthEnd, absentByProfile),
  ]);

  const freelancers: GoalFreelancer[] = profiles.map((pid) => {
    const rows = inRange.filter((r) => r.profile_id === pid);
    const hoursIn = (yy: number, mm: number) =>
      entries
        .filter((e) => e.user_id === pid && Number(e.date.slice(0, 4)) === yy && Number(e.date.slice(5, 7)) === mm)
        .reduce((t, e) => t + (e.minutes ?? 0) / 60, 0);
    const payIn = (yy: number, mm: number) =>
      rows.filter((r) => r.year === yy && r.month === mm).reduce((t, r) => t + Number(r.amount), 0);
    const recent = [0, 1, 2].map((i) => {
      const n = ym(fromYear, fromMonth) + i - 1;
      const [yy, mm] = [Math.floor(n / 12), (n % 12) + 1];
      return { year: yy, month: mm, hours: hoursIn(yy, mm), pay: payIn(yy, mm) };
    });
    return {
      name: rows[rows.length - 1].person_name,
      planned: payIn(year, month),
      recent,
      soFar: hoursIn(year, month),
      absent: absentByProfile.get(pid) ?? [],
      terms: HOURLY_TERMS[pid],
    };
  });
  const away = [...awayByName].map(([name, dates]) => ({ name, dates: dates.sort() }));
  return { absent, away, freelancers, formulaFreelancers };
}

/** Freelancers billed on a sliding rate through the tracker (AB) — finance-
 * admin's slidingRateFreelancers (actions.ts), mirrored. Read only: his terms,
 * his logs (not turned down), this month's charges, his planned amount
 * (matched by profile, else by name) and the month's official rate. */
async function slidingRateFreelancers(
  sb: SupabaseClient,
  year: number,
  month: number,
  from: string,
  monthEnd: string,
  absentByProfile: Map<string, string[]>,
): Promise<FormulaFreelancer[]> {
  const { data: people } = await sb.from("freelancers").select("profile_id, currency, rate_high, rate_low, hours_low, hours_high");
  if (!people?.length) return [];
  const ids = people.map((p) => p.profile_id as string);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const [{ data: profiles }, logs, { data: charges }, { data: planRows }, { data: fxRows }] = await Promise.all([
    sb.from("profiles").select("id, name").in("id", ids),
    fetchAll<{ profile_id: string; date: string; minutes: number }>(sb, "freelancer_logs", "profile_id, date, minutes", (q) =>
      q.in("profile_id", ids).neq("status", "rejected").gte("date", from).lte("date", monthEnd),
    ),
    sb.from("freelancer_charges").select("profile_id, amount, currency").in("profile_id", ids).neq("status", "rejected").gte("date", monthStart).lte("date", monthEnd),
    sb.from("finance_freelance").select("person_name, profile_id, amount").eq("year", year).eq("month", month),
    sb.from("fx_rates").select("year, month, usd_ils, eur_ils").lte("year", year).order("year", { ascending: false }).order("month", { ascending: false }),
  ]);
  const nameOf = new Map((profiles ?? []).map((p) => [p.id as string, p.name as string]));
  const fxRow = (fxRows ?? []).find((r) => r.year < year || (r.year === year && r.month <= month));
  const fxOf = (currency: string) => (currency === "ILS" ? 1 : Number((currency === "USD" ? fxRow?.usd_ils : fxRow?.eur_ils) ?? 0));
  const [fy, fm] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const recentMonths = [0, 1, 2].map((i) => {
    const n = fy * 12 + fm - 1 + i;
    return { year: Math.floor(n / 12), month: (n % 12) + 1 };
  });
  const hoursIn = (pid: string, y: number, m: number) =>
    logs
      .filter((l) => l.profile_id === pid && Number(l.date.slice(0, 4)) === y && Number(l.date.slice(5, 7)) === m)
      .reduce((t, l) => t + l.minutes / 60, 0);
  return people
    .map((p) => {
      const pid = p.profile_id as string;
      const name = nameOf.get(pid) ?? "";
      return {
        name,
        planned: (planRows ?? [])
          .filter((r) => r.profile_id === pid || (!r.profile_id && (r.person_name as string).trim().toLowerCase() === name.trim().toLowerCase()))
          .reduce((t, r) => t + Number(r.amount), 0),
        terms: {
          currency: p.currency as string,
          rateHigh: Number(p.rate_high),
          rateLow: Number(p.rate_low),
          hoursLow: Number(p.hours_low),
          hoursHigh: Number(p.hours_high),
        },
        fx: fxOf(p.currency as string),
        soFar: hoursIn(pid, year, month),
        charges: (charges ?? []).filter((c) => c.profile_id === pid && c.currency === p.currency).reduce((t, c) => t + Number(c.amount), 0),
        recent: recentMonths.map((r) => ({ ...r, hours: hoursIn(pid, r.year, r.month) })),
        absent: absentByProfile.get(pid) ?? [],
      };
    })
    .filter((f) => f.fx > 0);
}
