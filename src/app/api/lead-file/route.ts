import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { classifyUpload, formatSize, MAX_INTAKE_BYTES } from "@/lib/uploads";

/**
 * Offer files — the PDF a client actually received — for ADMINS only.
 *
 * ⚠️ MODELLED ON `/api/candidate-file`, AND FOR THE SAME REASON IT IS NOT
 * `/api/file`: that route lets any signed-in member read any attachment, which
 * is right for task files and wrong for what the studio is quoting a prospect.
 * The admin check here is the whole boundary; the bucket is private.
 *
 * ⚠️ ONE DIFFERENCE FROM THE CANDIDATE ROUTE: THE BYTES NEVER PASS THROUGH
 * HERE. POST hands back a SIGNED UPLOAD URL and the browser sends the file
 * straight to storage — the intake form's approach — because Vercel refuses a
 * function body over ~4.5MB and an offer deck with mockups in it is routinely
 * bigger than that.
 */

const BUCKET = "lead-files";
const SIGNED_TTL = 60;

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function isAdmin(): Promise<"none" | "user" | "admin"> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "none";
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return profile?.role === "admin" ? "admin" : "user";
}

function safePath(p: string | null): string | null {
  if (!p) return null;
  const path = p.startsWith("/") ? p.slice(1) : p;
  if (!path || path.includes("..") || path.startsWith("http")) return null;
  return path;
}

export async function GET(request: NextRequest) {
  const who = await isAdmin();
  if (who === "none") return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (who !== "admin") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const path = safePath(request.nextUrl.searchParams.get("p"));
  if (!path) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await service().storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 307, headers: { "Cache-Control": "no-store" } });
}

/**
 * Starts an upload: checks the name and size, returns a one-time signed URL.
 *
 * ⚠️ THE CONTENT-TYPE IS OURS, from `classifyUpload`'s allowlist, never the
 * browser's — the rule every upload in this app follows (v1.0.1).
 */
export async function POST(request: NextRequest) {
  const who = await isAdmin();
  if (who === "none") return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (who !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { leadId?: unknown; name?: unknown; size?: unknown }
    | null;
  const leadId = typeof body?.leadId === "string" ? body.leadId : "";
  const name = typeof body?.name === "string" ? body.name.slice(0, 200) : "";
  const size = typeof body?.size === "number" && Number.isFinite(body.size) ? body.size : -1;
  if (!/^[0-9a-f-]{36}$/i.test(leadId) || !name || size < 0) {
    return NextResponse.json({ error: "Nothing to upload" }, { status: 400 });
  }
  if (size === 0) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  if (size > MAX_INTAKE_BYTES) {
    return NextResponse.json(
      { error: `That's ${formatSize(size)}, over the ${formatSize(MAX_INTAKE_BYTES)} limit.` },
      { status: 400 },
    );
  }
  const kind = classifyUpload({ name } as File);
  if (!kind.ok) {
    return NextResponse.json(
      { error: "That kind of file can't be stored here — PDFs, images and documents only." },
      { status: 400 },
    );
  }

  const admin = service();
  // Idempotent: already-there is the normal case after the first upload ever.
  await admin.storage.createBucket(BUCKET, { public: false }).catch(() => undefined);

  const safeName = name.replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
  const path = `${leadId}/${Date.now()}-${safeName}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("lead-file signed upload url failed", error);
    return NextResponse.json({ error: "Could not start the upload." }, { status: 500 });
  }
  return NextResponse.json({
    path: data.path,
    token: data.token,
    contentType: kind.contentType,
    url: `/api/lead-file?p=${encodeURIComponent(data.path)}`,
  });
}
