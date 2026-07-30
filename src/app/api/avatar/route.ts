import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { classifyImage } from "@/lib/uploads";

// Upload the signed-in user's avatar (service role handles storage; caller is session-verified).
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Max 5MB" }, { status: 400 });
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
  const path = `${user.id}-${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("avatars")
    .upload(path, file, { contentType: cls.contentType, upsert: true });
  if (upErr) {
    console.error("avatar upload failed", upErr);
    return NextResponse.json({ error: "Upload failed" }, { status: 400 });
  }

  const { data: pub } = admin.storage.from("avatars").getPublicUrl(path);
  const { error: pErr } = await admin
    .from("profiles")
    .update({ avatar_url: pub.publicUrl })
    .eq("id", user.id);
  if (pErr) {
    console.error("avatar profile update failed", pErr);
    return NextResponse.json({ error: "Could not save your avatar" }, { status: 400 });
  }

  return NextResponse.json({ avatarUrl: pub.publicUrl });
}

// Remove avatar → back to initials.
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", user.id);
  if (error) {
    console.error("avatar clear failed", error);
    return NextResponse.json({ error: "Could not remove your avatar" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
