import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { classifyImage } from "@/lib/uploads";

/**
 * Upload a client's mark (migration 0023).
 *
 * Modelled on /api/avatar, with two differences that matter:
 *  · **it checks the caller is an admin**, because this writes a row in
 *    `clients` — a table members may read but never write. The service-role key
 *    below bypasses RLS entirely, so this check IS the access control, not a
 *    convenience on top of it.
 *  · it reuses the existing `avatars` bucket under a `client/` prefix rather
 *    than needing a new bucket provisioned by hand in the Supabase dashboard.
 *
 * `classifyImage` is the same allowlist the other upload routes use: the stored
 * Content-Type is forced server-side, so an SVG or an HTML file renamed .png
 * can't be served back as active content from the studio's own domain.
 */
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Admins only" }, { status: 403 }) };
  }
  return { user };
}

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const form = await request.formData();
  const file = form.get("file");
  const clientId = form.get("clientId");
  if (typeof clientId !== "string" || !clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: "Max 2MB" }, { status: 400 });
  }
  const cls = classifyImage(file);
  if (!cls.ok) {
    return NextResponse.json({ error: "Use a PNG, JPG, GIF or WebP image" }, { status: 400 });
  }

  const admin = serviceClient();
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  // Date.now() in the path is cache-busting: the same client re-uploading would
  // otherwise keep serving the previous mark from the CDN.
  const path = `client/${clientId}-${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("avatars")
    .upload(path, file, { contentType: cls.contentType, upsert: true });
  if (upErr) {
    console.error("client icon upload failed", upErr);
    return NextResponse.json({ error: "Upload failed" }, { status: 400 });
  }

  const { data: pub } = admin.storage.from("avatars").getPublicUrl(path);
  const { error: cErr } = await admin
    .from("clients")
    .update({ icon_url: pub.publicUrl })
    .eq("id", clientId);
  if (cErr) {
    console.error("client icon save failed", cErr);
    return NextResponse.json({ error: "Could not save the icon" }, { status: 400 });
  }

  return NextResponse.json({ iconUrl: pub.publicUrl });
}

/** Clear the uploaded mark → back to the preset glyph, or the initial. */
export async function DELETE(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const { clientId } = await request.json();
  if (typeof clientId !== "string" || !clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  const { error } = await serviceClient()
    .from("clients")
    .update({ icon_url: null })
    .eq("id", clientId);
  if (error) {
    console.error("client icon clear failed", error);
    return NextResponse.json({ error: "Could not remove the icon" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
