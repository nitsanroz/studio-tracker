import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Admin-only: create a team member (auth user + profile).
// The caller's session is verified server-side; the service key never leaves the server.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { email, name, role } = await request.json();
  if (!email || !name || !["admin", "designer"].includes(role)) {
    return NextResponse.json({ error: "email, name and role are required" }, { status: 400 });
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { error: pErr } = await admin.from("profiles").insert({
    id: created.user.id,
    name,
    role,
    active: true,
  });
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

  // Every new member gets a weekly-plan column automatically
  const { data: cols } = await admin
    .from("plan_columns")
    .select("position")
    .neq("type", "waiting_list")
    .order("position", { ascending: false })
    .limit(1);
  await admin.from("plan_columns").insert({
    name: name.split(" ")[0],
    profile_id: created.user.id,
    type: "member",
    position: (cols?.[0]?.position ?? 0) + 1,
  });

  return NextResponse.json({
    id: created.user.id,
    note: "Account created — the member sets a password via 'Forgot password' on the login page.",
  });
}
