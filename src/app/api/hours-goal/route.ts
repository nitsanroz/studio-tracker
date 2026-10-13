import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/db";
import { HOURLY_TERMS, LINE, hoursGoal, type FormulaFreelancer, type GoalFreelancer, type GoalInputs, type PnlMonthly } from "@/lib/hours-goal";

/**
 * Admin-only: the studio's pace this month against the billable hours a
 * workday that cover its costs (the "Studio pace" strip on the admin home).
 *
 * The goal is finance-admin's (src/lib/hours-goal.ts mirrors it), worked out
 * here from the finance P&L with the service key — and the response carries
 * HOURS ONLY. Tracker admins include people without finance access (Michal),
 * so no ₪ figure — costs, rates, a freelancer's pay — ever leaves this route.
 *
 * Hours so far are read live from time_entries (billable task of a billable
 * client — the finance rollup's own definition), not from the P&L, whose
 * figure only refreshes when someone opens the finance app.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const sb = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // The studio's today, not the server's (Vercel runs in UTC).
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" })
    .format(new Date())
    .split("-")
    .map(Number);
  const today = new Date(y, m - 1, d);

  const { data: pnlRows, error } = await sb
    .from("finance_pnl_monthly")
    .select("year, month, line_item, value")
    .gte("year", y - 1)
    .lte("year", y)
    .in("line_item", Object.values(LINE));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [liveHours, inputs] = await Promise.all([billableHoursForMonth(sb, y, m), goalInputs(sb, y, m)]);
  const pnl: PnlMonthly[] = (pnlRows ?? [])
    .filter((r) => !(r.year === y && r.month === m && r.line_item === LINE.totalHours))
    .map((r) => ({ year: r.year, month: r.month, lineItem: r.line_item, value: Number(r.value) }));
  pnl.push({ year: y, month: m, lineItem: LINE.totalHours, value: liveHours });

  const g = hoursGoal(pnl, y, today, { inputs });
  if (!g) return NextResponse.json({ goal: null });
  return NextResponse.json({
    goal: {
      month: g.month,
      soFar: g.soFar,
      pace: g.actualPerDay,
      workdays: g.workdays,
      workdaysDone: g.workdaysDone,
      workdaysLeft: g.workdaysLeft,
      min: pick(g),
      goal: pick(g.profit),
      away: g.away,
    },
  });
}

const pick = (l: { hours: number; perDay: number; perWeek: number; expectedByNow: number; neededPerDay: number | null }) => ({
  hours: l.hours,
  perDay: l.perDay,
  perWeek: l.perWeek,
  expectedByNow: l.expectedByNow,
  neededPerDay: l.neededPerDay,
});

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
  const entries = profiles.length
    ? await fetchAll<{ user_id: string; date: string; minutes: number | null }>(sb, "time_entries", "user_id, date, minutes", (q) =>
        q.in("user_id", profiles).gte("date", startOfRange).lte("date", monthEnd).not("minutes", "is", null),
      )
    : [];

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
  const formulaFreelancers = await slidingRateFreelancers(sb, year, month, startOfRange, monthEnd, absentByProfile);
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
