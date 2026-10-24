import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { studioGoal } from "@/lib/hours-goal-server";
import { service } from "@/lib/supabase/service";

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

  const sb = service();

  let g: Awaited<ReturnType<typeof studioGoal>>;
  try {
    g = await studioGoal(sb);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
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

