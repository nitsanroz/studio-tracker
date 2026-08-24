import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { MAX_INTAKE_BYTES, MAX_INTAKE_FILES, classifyUpload, formatSize } from "@/lib/uploads";
import { makeMintCap } from "@/lib/mint-cap";

/**
 * Mints a one-shot signed upload URL so the CLIENT'S BROWSER can put a file
 * straight into the `intake` bucket, instead of posting it through the API.
 *
 * ⚠️ WHY THIS EXISTS AT ALL: a Vercel serverless function refuses a request body
 * over 4.5MB before it runs, so every attachment that travelled through
 * /api/intake/[token] shared one 4.5MB budget with the whole form. A client lost
 * a brief to it (v1.19.2 — three screenshots, 4.3MB). Uploading direct to
 * storage takes the function out of the file path entirely, which is what lets
 * the per-file cap go UP to 25MB rather than down to 4.
 *
 * ⚠️ THIS IS AN UNAUTHENTICATED ENDPOINT and the only one in the app that hands
 * out write access to a bucket, so it is guarded four ways:
 *   1. the intake token must resolve to an ACTIVE link (same gate as the form);
 *   2. the extension must be on the allowlist BEFORE a URL is minted — there is
 *      no point issuing a URL for a file the submission will refuse;
 *   3. the size claimed must be within the cap, and the BUCKET carries the same
 *      limit, so a client lying here is still refused by storage;
 *   4. a per-link flood cap — on objects already in the bucket AND on the URLs
 *      this endpoint has handed out, because the first cannot see a burst of
 *      mints that have not been used yet (see `mints`).
 * The signed URL is single-use and names one path, so it cannot be replayed to
 * overwrite somebody else's file.
 */

// A link may mint this many uploads per window. Deliberately well above a real
// brief (5 files) — someone re-picking files after a mistake is normal, and the
// point is to stop a script, not to punish a client who changed their mind.
const FLOOD_WINDOW_MIN = 10;
const FLOOD_MAX = 40;

/**
 * Bounds the signed upload URLs this endpoint hands out — see `makeMintCap` for
 * why the storage count below cannot do it, and for what "best-effort" means
 * here.
 */
const mintCap = makeMintCap(FLOOD_MAX, FLOOD_WINDOW_MIN * 60_000);

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const sb = admin();

  const { data: link } = await sb
    .from("intake_links")
    .select("id, active")
    .eq("token", token)
    .maybeSingle();
  if (!link || !link.active) {
    return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { name?: unknown; size?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.slice(0, 200) : "";
  const size = typeof body?.size === "number" && Number.isFinite(body.size) ? body.size : -1;
  if (!name || size < 0) {
    return NextResponse.json({ error: "A file name and size are required" }, { status: 400 });
  }
  if (size > MAX_INTAKE_BYTES) {
    return NextResponse.json(
      { error: `That file is over the ${formatSize(MAX_INTAKE_BYTES)} limit.` },
      { status: 400 },
    );
  }
  // ⚠️ Checked here as well as in the browser: this endpoint is reachable
  // without the form, and handing out a write URL for a `.html` would put active
  // content on a public bucket served from our own domain.
  const cls = classifyUpload({ name } as File);
  if (!cls.ok) {
    return NextResponse.json({ error: "That file type isn't supported." }, { status: 400 });
  }

  // ⚠️ Flood cap counted from STORAGE, not from a table — an upload happens
  // before any `task_requests` row exists, so there is nothing else to count,
  // and adding a rate-limit table would mean a migration for a guard that the
  // bucket listing can answer directly.
  const { data: recent, error: listErr } = await sb.storage
    .from("intake")
    .list(link.id, { limit: FLOOD_MAX + 1, sortBy: { column: "created_at", order: "desc" } });
  /**
   * ⚠️ FAILS CLOSED, unlike the submission route's limiter, and the asymmetry is
   * the point: a refused upload is retried in seconds and loses nothing, whereas
   * refusing a SUBMISSION costs a client their brief. The error used to be
   * discarded, so a storage hiccup — or the 402 the project returns over quota —
   * turned this cap off silently on the app's only unauthenticated write path.
   */
  if (listErr) {
    console.error("intake upload flood check failed — refusing", listErr);
    return NextResponse.json(
      { error: "Could not start the upload — please try again in a moment." },
      { status: 503 },
    );
  }
  const since = Date.now() - FLOOD_WINDOW_MIN * 60_000;
  const fresh = (recent ?? []).filter((o) => new Date(o.created_at ?? 0).getTime() >= since);
  if (fresh.length >= FLOOD_MAX || mintCap.exceeded(link.id)) {
    return NextResponse.json(
      { error: "Too many uploads — please try again in a few minutes." },
      { status: 429 },
    );
  }

  // ⚠️ Namespaced under the LINK id and given a random segment: the submission
  // route later refuses any path outside this prefix, so one client's brief can
  // never claim a file another client uploaded.
  const safe = name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${link.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safe}`;

  const { data, error } = await sb.storage.from("intake").createSignedUploadUrl(path);
  if (error) {
    console.error("intake signed upload url failed", error);
    return NextResponse.json({ error: "Could not start the upload." }, { status: 500 });
  }

  return NextResponse.json({
    path: data.path,
    token: data.token,
    // The type the file must be stored as. The bucket allows only this set, so
    // the browser sending anything else is refused by storage.
    contentType: cls.contentType,
    maxFiles: MAX_INTAKE_FILES,
  });
}
