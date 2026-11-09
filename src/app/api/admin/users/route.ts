import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cleanPosition } from "@/lib/candidates/convert";
import { convertBlocked, finishConversion } from "@/lib/candidates/convert-server";
import { service } from "@/lib/supabase/service";

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

  const { email, name, role, startDate, candidateId, position } = await request.json();
  if (!email || !name || !["admin", "designer"].includes(role)) {
    return NextResponse.json({ error: "email, name and role are required" }, { status: 400 });
  }
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (candidateId !== undefined && typeof candidateId !== "string") {
    return NextResponse.json({ error: "candidateId must be a string" }, { status: 400 });
  }

  const admin = service();

  // "Convert to a team member" from a candidate: refuse a second conversion
  // before an account exists (convert-server.ts).
  if (candidateId) {
    const blocked = await convertBlocked(admin, candidateId);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
  }

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
    start_date: startDate || null,
    // Job title, from a candidate's role — never "owner" (cleanPosition says
    // why). Left out when empty, so Team → Add user writes what it always did.
    ...(cleanPosition(position) ? { position: cleanPosition(position) } : {}),
  });
  if (pErr) {
    // Don't leave a sign-in with no person behind it: the retry would then fail
    // with "already registered" and the account could never be finished.
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: pErr.message }, { status: 400 });
  }

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

  const warnings = candidateId
    ? await finishConversion(admin, "member", candidateId, created.user.id, name, user.id)
    : [];

  return NextResponse.json({
    id: created.user.id,
    warnings,
    // Point at the admin button, not "Forgot password": that self-service path
    // goes through Supabase's own auth mailer (rate-capped, and dead whenever
    // SMTP is misconfigured), whereas "Send password link" uses /api/admin/invite
    // → Resend, and produces a link that opens on any device.
    note: "Account created — use 'Send password link' on the member's page to let them set a password.",
  });
}

