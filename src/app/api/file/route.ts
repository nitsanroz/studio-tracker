import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseProxyRequest } from "@/lib/storage-url";
import { mustDownload, opensInline } from "@/lib/uploads";
import { service } from "@/lib/supabase/service";

/**
 * Serves one object out of a PRIVATE storage bucket to a signed-in member.
 *
 * ⚠️⚠️ THIS ROUTE IS THE ACCESS CONTROL. The bucket it reads from has no anon
 * policy and the client of this route never sees the service key — so the session
 * check below is the entire boundary between "a colleague opening a client's
 * brief" and "anybody with the URL". Do not add a branch that skips it.
 *
 * ⚠️ IT REDIRECTS TO A SHORT-LIVED SIGNED URL RATHER THAN STREAMING THE BYTES.
 * Streaming would put every attachment download through a serverless function —
 * paying for the bandwidth twice and capping a 30MB file on the function's own
 * limits. A 307 lets the browser fetch from storage directly. The cost is that
 * the signed URL becomes visible to the person who was already authorised to
 * read it, which is not a leak; `SIGNED_TTL` keeps the window small.
 *
 * ⚠️ Studio-wide READ visibility is the app's documented position (see the Access
 * control section of CLAUDE.md), so any signed-in member may read any attachment
 * — the same rule as the tasks and time entries these files hang off. This route
 * deliberately does NOT try to be finer-grained than the rest of the app; if that
 * ever changes it changes at the RLS level first, not here.
 */

/** Long enough for a browser to follow the redirect, short enough to be useless if copied. */
const SIGNED_TTL = 60;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const q = request.nextUrl.searchParams;
  const target = parseProxyRequest(q.get("b"), q.get("p"));
  // ⚠️ One message for every refusal, and never the bucket or key back: this
  // endpoint must not become a way to test whether an object exists.
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = service();
  // An .html attachment is SAVED, never opened as a page on the storage origin
  // — on top of its stored octet-stream type (see `classifyTaskAttachment`).
  let download = mustDownload(target.path);
  // ⚠️ And anything whose STORED type isn't one we choose — the browser set it
  // when uploading directly (see `opensInline`). `avatars` is written only by our
  // own routes, which set the type themselves, so its images skip the lookup.
  if (!download && target.bucket !== "avatars") {
    const { data: meta } = await admin.storage.from(target.bucket).info(target.path);
    download = !opensInline(meta?.contentType);
  }
  const { data, error } = await admin.storage
    .from(target.bucket)
    .createSignedUrl(target.path, SIGNED_TTL, download ? { download: true } : undefined);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // `no-store`: the redirect carries a URL that stops working in a minute, so a
  // cached 307 would hand a browser a dead link for as long as the cache lives.
  return NextResponse.redirect(data.signedUrl, {
    status: 307,
    headers: { "Cache-Control": "no-store" },
  });
}
