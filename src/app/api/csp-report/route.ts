import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/app-origin";
import {
  EMPTY_STORE,
  keepViolation,
  mergeReports,
  parseReports,
  type ReportStore,
} from "@/lib/csp-reports";

/**
 * Where the browser posts Content-Security-Policy violations.
 *
 * ⚠️ WHY: v1.39.0's CSP immediately caught a live dependency nobody knew about —
 * 17 avatars still served from Everhour's retired CloudFront CDN — and it was found
 * only because somebody happened to have the console open. Without a sink, the next
 * unknown third party breaks silently in a colleague's browser and reaches us as
 * "the app looks wrong". This is the alarm for that.
 *
 * ⚠️⚠️ POST IS UNAUTHENTICATED AND HAS TO BE. Browsers send violation reports
 * without credentials, so this is the one write path in the app any stranger can
 * reach. Everything about it is therefore bounded:
 *   · `Content-Length`/body capped at `MAX_BODY` before parsing;
 *   · reports attributed to a page that is not ours are dropped (`keepViolation`);
 *   · extension noise dropped — it is the bulk of real report traffic;
 *   · distinct signatures CAPPED, repeats THROTTLED, so a flood cannot turn into
 *     one Supabase write per request. Egress is this project's tightest
 *     constraint — see `src/lib/egress.ts`.
 * ⚠️ It always answers 204, whatever happened. A report endpoint that returned
 * errors would tell an attacker which inputs do something.
 *
 * ⚠️ GET IS ADMIN-ONLY and is how anyone actually reads this. There is no UI yet;
 * `/api/csp-report` in a signed-in admin's browser is the intended way to look.
 *
 * ⚠️ NOT COVERED BY THE CSP ITSELF — `src/proxy.ts`'s matcher excludes `/api`,
 * which is what we want: a policy on a JSON endpoint buys nothing, and a violation
 * report that itself triggered a violation would loop.
 */

const SETTINGS_KEY = "csp_reports";
/** Generous for a report (they are ~1 KB) and small enough to be cheap to refuse. */
const MAX_BODY = 16 * 1024;

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Origins whose pages we accept reports about.
 *
 * ⚠️ The REQUEST's own origin is included so this works on localhost and on
 * preview deployments; `appOrigin()` is included so production is covered even if
 * a request arrives with an odd Host. Both are ours — see `src/lib/app-origin.ts`
 * for why a Host header alone is not trusted in this codebase.
 */
function allowedOrigins(req: NextRequest): string[] {
  const set = new Set<string>([appOrigin()]);
  try {
    set.add(new URL(req.url).origin);
  } catch {
    /* keep appOrigin only */
  }
  return [...set];
}

export async function POST(req: NextRequest) {
  // 204 on every path below. `void` the work rather than reporting it.
  const done = new NextResponse(null, { status: 204 });

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return done;

  let text: string;
  try {
    text = await req.text();
  } catch {
    return done;
  }
  // Re-check: `content-length` can lie or be absent under chunked encoding.
  if (!text || text.length > MAX_BODY) return done;

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return done;
  }

  const origins = allowedOrigins(req);
  const violations = parseReports(payload).filter((v) => keepViolation(v, origins));
  if (violations.length === 0) return done;

  try {
    const db = admin();
    const { data: row } = await db
      .from("app_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    const existing: ReportStore = { ...EMPTY_STORE, ...((row?.value as Partial<ReportStore>) ?? {}) };
    const { store, changed } = mergeReports(existing, violations, new Date());
    // ⚠️ The whole point of `changed`: a known violation repeating every few
    // seconds must not cost a write every few seconds.
    if (changed) {
      await db.from("app_settings").upsert({ key: SETTINGS_KEY, value: store }, { onConflict: "key" });
      // Also to the server log, so a violation is visible in Vercel's runtime logs
      // without anyone remembering this endpoint exists.
      for (const v of violations) {
        console.warn("[csp] blocked", v.directive, v.blocked, "on", v.documentUri);
      }
    }
  } catch (e) {
    // Never surfaced to the caller — see the 204 note above.
    console.error("[csp] could not record report", e instanceof Error ? e.message : e);
  }
  return done;
}

/** Admin-only: what has been refused, most recent first. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { data: row } = await admin()
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  const store: ReportStore = { ...EMPTY_STORE, ...((row?.value as Partial<ReportStore>) ?? {}) };
  return NextResponse.json(store);
}
