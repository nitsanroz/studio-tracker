import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { runWeeklyPlanSync } from "@/lib/weekly-plan-sync";

// One-way bridge: pull the studio's Google-Sheet weekly plan (published as CSV)
// into plan_entries. Two entry points:
//   • GET  — the Vercel cron; authorized by the CRON_SECRET bearer Vercel injects.
//   • POST — the admin "Sync from sheet" button; authorized by the caller's session.
// The published CSV URL lives in WEEKLY_PLAN_CSV_URL (not a secret, but env-configured
// so it can change without a deploy).

export const dynamic = "force-dynamic";

async function doSync() {
  const url = process.env.WEEKLY_PLAN_CSV_URL;
  if (!url) {
    return NextResponse.json(
      { error: "WEEKLY_PLAN_CSV_URL is not set. Publish the weekly-plan tab to the web as CSV and set that env var." },
      { status: 500 },
    );
  }

  let csvText: string;
  try {
    const res = await fetch(url, { redirect: "follow", cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `Sheet fetch failed (${res.status}). Check the published CSV link.` }, { status: 502 });
    }
    csvText = await res.text();
  } catch (e) {
    return NextResponse.json({ error: `Could not reach the sheet: ${(e as Error).message}` }, { status: 502 });
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  try {
    const summary = await runWeeklyPlanSync(admin, csvText);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// Cron (Vercel injects `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set).
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return doSync();
}

// Manual button — admins only.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  return doSync();
}
