import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { classifyUpload, formatSize, MAX_INTAKE_BYTES } from "@/lib/uploads";

/**
 * Serves one candidate file — a CV, a portfolio PDF — to an ADMIN.
 *
 * ⚠️⚠️ WHY THIS IS NOT `/api/file`, WHICH ALREADY DOES EXACTLY THIS SHAPE OF JOB.
 * That route's own doc says it plainly: "any signed-in member may read any
 * attachment — the same rule as the tasks and time entries these files hang
 * off. This route deliberately does NOT try to be finer-grained than the rest
 * of the app." Studio-wide read visibility is the app's documented and
 * deliberate position (CLAUDE.md, Access control).
 *
 * Candidate data is the one place that rule does not hold. Every table behind
 * it carries `admin all` and NO `read all` (0039), because these are outside
 * people's CVs and two colleagues' written opinions of them. Adding
 * `candidate-files` to `PROXIED_BUCKETS` would have handed every designer in
 * the studio a way to fetch any applicant's CV with a URL — quietly, through a
 * route whose comment says that is fine, because for everything else it is.
 *
 * ⚠️ SO THE ADMIN CHECK HERE IS THE ENTIRE BOUNDARY. The bucket is private with
 * no anon policy and the browser never sees the service key. Do not add a
 * branch that skips it, and do not "unify" this with /api/file.
 *
 * ⚠️ The role is re-read from `profiles` SERVER-SIDE rather than trusted from
 * anything the caller sent, the same as /api/admin/* and /api/client-icon.
 */

const BUCKET = "candidate-files";

/** Long enough to follow a redirect, short enough to be useless if copied. */
const SIGNED_TTL = 60;

/**
 * ⚠️ Rejects traversal and absolute keys. The path is user input, and without
 * this the route would sign any object in the bucket for anyone who can guess
 * at a key — the same check `parseProxyRequest` makes for the public buckets.
 */
function safePath(p: string | null): string | null {
  if (!p) return null;
  const path = p.startsWith("/") ? p.slice(1) : p;
  if (!path || path.includes("..") || path.startsWith("http")) return null;
  return path;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const path = safePath(request.nextUrl.searchParams.get("p"));
  // ⚠️ One message for every refusal, and never the key back: this endpoint must
  // not become a way to test whether a given candidate's file exists.
  if (!path) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl, {
    status: 307,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Uploads a candidate's CV (or any other file about them) into the private
 * bucket, and hands back the path to store on a `candidate_links` row.
 *
 * ⚠️⚠️ A CV IS A FILE, NOT A LINK — Nitsan, 2026-09-28 — and this route exists
 * because the first version of the links editor took a URL and nothing else.
 * A CV arrives as a PDF attached to a mail; asking somebody to host it
 * somewhere first, so they can paste an address, is asking them not to bother.
 *
 * ⚠️ THE CONTENT-TYPE IS FORCED FROM OUR OWN ALLOWLIST, never taken from the
 * browser. `classifyUpload` is the same gate every other upload in this app
 * goes through, and it is what stops an `x.pdf` that is really HTML being
 * stored as active content on the studio's own storage domain (v1.0.1).
 *
 * ⚠️ The bucket is PRIVATE and created here on first use rather than by hand,
 * so the feature cannot half-exist on a fresh environment. Objects in it are
 * only ever reachable through the GET above, which is admin-gated.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const candidateId = String(form.get("candidateId") ?? "");
  if (!(file instanceof File) || !/^[0-9a-f-]{36}$/i.test(candidateId)) {
    return NextResponse.json({ error: "Nothing to upload" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_INTAKE_BYTES) {
    return NextResponse.json(
      { error: `That's ${formatSize(file.size)}, over the ${formatSize(MAX_INTAKE_BYTES)} limit.` },
      { status: 400 },
    );
  }
  const kind = classifyUpload(file);
  if (!kind.ok) {
    return NextResponse.json(
      { error: "That kind of file can't be stored here — PDFs, images and documents only." },
      { status: 400 },
    );
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // Idempotent: already-there is the normal case after the first upload ever.
  await admin.storage.createBucket(BUCKET, { public: false }).catch(() => undefined);

  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
  const path = `${candidateId}/${Date.now()}-${safeName}`;
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: kind.contentType, upsert: false });
  if (error) {
    return NextResponse.json({ error: "That file could not be stored." }, { status: 500 });
  }

  return NextResponse.json({
    path,
    url: `/api/candidate-file?p=${encodeURIComponent(path)}`,
    title: file.name,
  });
}
