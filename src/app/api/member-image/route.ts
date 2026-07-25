import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { classifyImage } from "@/lib/uploads";

/**
 * Upload / clear a member picture. Two kinds:
 *   kind=avatar → profiles.avatar_url (small round avatar)
 *   kind=photo  → profiles.photo_url  (studio cut-out portrait)
 *
 * Members may change their own; admins may change anyone's (targetId).
 * Session-verified; the service key never leaves the server.
 */

type Kind = "avatar" | "photo";
const COLUMN: Record<Kind, "avatar_url" | "photo_url"> = {
  avatar: "avatar_url",
  photo: "photo_url",
};

/** Resolve caller + the profile being edited, enforcing the admin rule. */
async function resolveTarget(targetId: string | null) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in", status: 401 as const };

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isAdmin = me?.role === "admin";
  const profileId = targetId && targetId !== user.id ? targetId : user.id;
  if (profileId !== user.id && !isAdmin) {
    return { error: "Admins only", status: 403 as const };
  }
  return { profileId };
}

function parseKind(value: string | null): Kind | null {
  return value === "avatar" || value === "photo" ? value : null;
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const kind = parseKind(String(form.get("kind") ?? "avatar"));
  if (!kind) return NextResponse.json({ error: "kind must be avatar or photo" }, { status: 400 });

  const target = await resolveTarget(form.get("targetId") ? String(form.get("targetId")) : null);
  if ("error" in target) return NextResponse.json({ error: target.error }, { status: target.status });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an image to upload" }, { status: 400 });
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "Image must be under 8MB" }, { status: 400 });
  }
  const cls = classifyImage(file);
  if (!cls.ok) {
    return NextResponse.json({ error: "Use a PNG, JPG, GIF or WebP image" }, { status: 400 });
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${kind}-${target.profileId}-${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("avatars")
    .upload(path, file, { contentType: cls.contentType, upsert: true });
  if (upErr) {
    console.error("member image upload failed", upErr);
    return NextResponse.json({ error: "Upload failed — try again" }, { status: 400 });
  }

  const { data: pub } = admin.storage.from("avatars").getPublicUrl(path);
  const { error: pErr } = await admin
    .from("profiles")
    .update({ [COLUMN[kind]]: pub.publicUrl })
    .eq("id", target.profileId);
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

  return NextResponse.json({ url: pub.publicUrl, kind, profileId: target.profileId });
}

export async function DELETE(request: NextRequest) {
  const url = new URL(request.url);
  const kind = parseKind(url.searchParams.get("kind"));
  if (!kind) return NextResponse.json({ error: "kind must be avatar or photo" }, { status: 400 });

  const target = await resolveTarget(url.searchParams.get("targetId"));
  if ("error" in target) return NextResponse.json({ error: target.error }, { status: target.status });

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { error } = await admin
    .from("profiles")
    .update({ [COLUMN[kind]]: null })
    .eq("id", target.profileId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, kind, profileId: target.profileId });
}
