import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  estimateCycle,
  egressLevel,
  combinedLevel,
  projectCycle,
  mergeSamples,
  type DaySample,
  type EgressState,
} from "@/lib/egress";

/**
 * Admin-only: how much of the org's 5 GB egress allowance this cycle has used.
 *
 * ⚠️ AN ESTIMATE, AND THE UI MUST SAY SO — read the header of `src/lib/egress.ts`
 * for why (Supabase has no public egress endpoint; this is request counts × a
 * calibrated bytes-per-request factor).
 *
 * ⚠️ THE QUOTA IS PER ORGANISATION, NOT PER PROJECT, which is why both project
 * refs are polled and summed. `Lomdoni` shares the org with `studio-tracker` and
 * its traffic counts against the same 5 GB — 850 requests over the week this was
 * built, so it is negligible today and would be invisible if it stopped being so.
 *
 * ⚠️ IT POLLS AT MOST EVERY `POLL_EVERY_HOURS`, not on every page load. Each poll
 * is two calls to Supabase's API and an admin may open the app twenty times a day;
 * the 7-day window means a poll every few hours loses nothing.
 *
 * ⚠️ NO CRON, deliberately: the Vercel account is Hobby (daily crons only, two
 * slots) and every 7-day poll backfills any gap shorter than a week, so a working
 * studio keeps this current just by using the app. A quiet fortnight shows as
 * `stale` rather than as a wrong number.
 */

const PROJECT_REFS = ["hjrhfifbmxduwacjzqdt", "hfwlixwsahfxcnujtvkj"]; // studio-tracker, Lomdoni
const SETTINGS_KEY = "egress_state";
const POLL_EVERY_HOURS = 6;

const EMPTY: EgressState = {
  seedBytes: 0,
  seedDate: "1970-01-01",
  seedCycleStart: "1970-01-01",
  samples: [],
  lastPolledAt: null,
};

/** Daily REST counts for one project over the last 7 days. */
async function pollProject(ref: string, token: string): Promise<DaySample[]> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/usage.api-counts?interval=7day`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  // ⚠️ Throw rather than return [] — an empty array is indistinguishable from "a
  // quiet week", and swallowing a 401 from an expired token is exactly how this
  // would go silently blind. The caller turns a throw into `stale`.
  if (!res.ok) throw new Error(`usage.api-counts ${ref}: ${res.status}`);
  const body = (await res.json()) as {
    result?: { timestamp?: string; total_rest_requests?: number }[];
  };
  return (body.result ?? [])
    .filter((r) => r.timestamp)
    .map((r) => ({ date: String(r.timestamp).slice(0, 10), rest: r.total_rest_requests ?? 0 }));
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  // Service role: `app_settings` is admin-write by RLS, and the poll must work the
  // same for any admin regardless of their own grants.
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: row } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  let state: EgressState = { ...EMPTY, ...((row?.value as Partial<EgressState>) ?? {}) };

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const stale = state.lastPolledAt
    ? Date.now() - new Date(state.lastPolledAt).getTime() > POLL_EVERY_HOURS * 3600_000
    : true;

  let pollError: string | null = null;
  if (token && stale) {
    try {
      const perProject = await Promise.all(PROJECT_REFS.map((r) => pollProject(r, token)));
      // Sum the projects per DAY before merging: the quota is org-wide, and a
      // sample list keyed by date must not hold one row per project.
      const byDate = new Map<string, number>();
      for (const list of perProject) {
        for (const s of list) byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.rest);
      }
      const incoming = [...byDate].map(([date, rest]) => ({ date, rest }));
      state = {
        ...state,
        samples: mergeSamples(state.samples, incoming),
        lastPolledAt: new Date().toISOString(),
      };
      await admin.from("app_settings").upsert({ key: SETTINGS_KEY, value: state }, { onConflict: "key" });
    } catch (e) {
      // Left for the UI to report as `stale`; `lastPolledAt` is deliberately NOT
      // advanced, so a failing token cannot look like a successful read.
      pollError = e instanceof Error ? e.message : "poll failed";
      console.error("[egress] poll failed", pollError);
    }
  }

  const now = new Date();
  const estimate = estimateCycle(state, now);
  // ⚠️ The forecast may RAISE the level but never soften it — see `combinedLevel`.
  const projection = projectCycle(state, estimate, now);
  return NextResponse.json({
    ...estimate,
    projection,
    level: combinedLevel(egressLevel(estimate, state.lastPolledAt, now), projection),
    lastPolledAt: state.lastPolledAt,
    tokenConfigured: !!token,
    pollError,
  });
}
