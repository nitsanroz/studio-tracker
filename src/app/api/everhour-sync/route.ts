import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isoDaysAgo, runEverhourSync } from "@/lib/everhour-sync";

// Pull recent Everhour time entries into the tracker while the team is still
// logging there. Two entry points:
//   • GET  — the Vercel cron; authorized by the CRON_SECRET bearer Vercel injects.
//   • POST — the admin "Sync Everhour" button; authorized by the caller's session.
// Insert-only and idempotent (keyed by everhour_id), so running it often is safe.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_LOOKBACK_DAYS = 3;

async function doSync(lookbackDays: number) {
  const apiKey = process.env.EVERHOUR_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "EVERHOUR_API_KEY is not set on this environment." },
      { status: 500 },
    );
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const from = isoDaysAgo(lookbackDays);
  const to = isoDaysAgo(0);
  try {
    const summary = await runEverhourSync(admin, apiKey, from, to);
    if (summary.skippedNoMatch > 0) {
      // not an error — but say what was missed so it can't silently rot
      console.warn(
        `everhour-sync: ${summary.skippedNoMatch} entries skipped (unmapped task/user)`,
        summary.unmatchedTasks,
      );
    }
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error("everhour-sync failed", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

function lookbackFrom(request: NextRequest) {
  const raw = Number(new URL(request.url).searchParams.get("days"));
  return Number.isFinite(raw) && raw > 0 && raw <= 90 ? Math.floor(raw) : DEFAULT_LOOKBACK_DAYS;
}

// Cron (Vercel injects `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set).
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return doSync(lookbackFrom(request));
}

// Manual button — admins only.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  return doSync(lookbackFrom(request));
}
