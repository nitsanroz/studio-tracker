import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { updateWithOptional } from "@/lib/db";

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

  const { email, name, role, startDate, candidateId } = await request.json();
  if (!email || !name || !["admin", "designer"].includes(role)) {
    return NextResponse.json({ error: "email, name and role are required" }, { status: 400 });
  }
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (candidateId !== undefined && typeof candidateId !== "string") {
    return NextResponse.json({ error: "candidateId must be a string" }, { status: 400 });
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
    start_date: startDate || null,
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

  const warnings = candidateId ? await fromCandidate(admin, candidateId, created.user.id, name, user.id) : [];

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

/**
 * "Add to the team" from a hired candidate's page: carry what the application
 * told us into their HR file, mark the candidate hired, and link the two.
 *
 * ⚠️ RUNS AFTER THE ACCOUNT EXISTS, SO NOTHING HERE FAILS THE REQUEST. The
 * member is real by now; refusing would leave an account the admin was told
 * was not made, and a retry would collide on the email. Each step that misses
 * comes back as a line the page shows, so it can be finished by hand.
 *
 * ⚠️ ONLY EMAIL AND PHONE CROSS OVER — they are all an application holds that
 * `member_hr` has a column for. The candidate's email goes to PERSONAL email:
 * it is the address they applied from, and the account may use a studio one.
 */
async function fromCandidate(
  admin: SupabaseClient,
  candidateId: string,
  profileId: string,
  name: string,
  actorId: string,
): Promise<string[]> {
  const warnings: string[] = [];
  const { data: cand, error } = await admin
    .from("candidates")
    .select("email,phone")
    .eq("id", candidateId)
    .maybeSingle();
  if (error || !cand) return ["The candidate could not be read, so nothing was copied from it."];

  if (cand.email || cand.phone) {
    const { error: hrErr } = await admin.from("member_hr").upsert({
      profile_id: profileId,
      personal_email: cand.email ?? null,
      phone: cand.phone ?? null,
      updated_at: new Date().toISOString(),
    });
    if (hrErr) warnings.push("Their email and phone were not copied to HR details.");
  }

  const now = new Date().toISOString();
  // ⚠️ `profile_id` is 0061's and optional: without it they are still marked
  // hired, just not linked to their team page.
  const { error: cErr, degraded } = await updateWithOptional(
    admin,
    "candidates",
    { id: candidateId },
    {
      status: "archived",
      outcome: "hired",
      archived_at: now,
      archived_by: actorId,
      last_activity_at: now,
    },
    { profile_id: profileId },
  );
  if (cErr) warnings.push("The candidate was not marked as hired.");
  else if (degraded) warnings.push("Migration 0061 has not run, so the candidate is not linked to their team page.");

  await admin
    .from("candidate_events")
    .insert({ candidate_id: candidateId, kind: "joined_team", detail: name, actor_id: actorId });

  return warnings;
}
