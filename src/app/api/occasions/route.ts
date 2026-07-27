import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Admin CRUD for custom occasions, plus the group on/off switches.
//
// Writes go through the caller's own session, not the service key: `occasions` has
// an admin-only write policy (migration 0015), so the database enforces the rule and
// this route can't be the thing that accidentally bypasses it. The session check
// below is for a clear error message, not for security.

export const dynamic = "force-dynamic";

const GROUPS = ["birthday", "anniversary", "holiday", "custom"] as const;

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin")
    return { error: NextResponse.json({ error: "Admins only" }, { status: 403 }) };
  return { supabase, userId: user.id };
}

export async function GET() {
  const { error, supabase } = await requireAdmin();
  if (error) return error;

  const [occasionsRes, settingRes] = await Promise.all([
    supabase!.from("occasions").select("id, title, date, recurring, icon").order("date"),
    supabase!.from("app_settings").select("value").eq("key", "occasion_groups").maybeSingle(),
  ]);
  // A missing `occasions` table (migration 0015 not applied) must not take the group
  // switches down with it — those live in app_settings, which already exists. Report
  // the custom list as unavailable and let the rest of the panel work.
  return NextResponse.json({
    occasions: occasionsRes.error ? [] : (occasionsRes.data ?? []),
    groups: settingRes.data?.value ?? null,
    customUnavailable: occasionsRes.error
      ? "Run migration 0015_occasions.sql to add custom occasions."
      : null,
  });
}

export async function POST(request: NextRequest) {
  const { error, supabase, userId } = await requireAdmin();
  if (error) return error;

  const body = await request.json();

  // Group toggles live in app_settings (key/jsonb), so they need no schema of their own.
  if (body.groups) {
    const value: Record<string, boolean> = {};
    for (const g of GROUPS) if (typeof body.groups[g] === "boolean") value[g] = body.groups[g];
    const { error: e } = await supabase!
      .from("app_settings")
      .upsert({ key: "occasion_groups", value }, { onConflict: "key" });
    if (e) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ ok: true, groups: value });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const date = typeof body.date === "string" ? body.date : "";
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "A title and a date (YYYY-MM-DD) are required." }, { status: 400 });
  }

  const { data, error: e } = await supabase!
    .from("occasions")
    .insert({
      title,
      date,
      recurring: body.recurring === true,
      icon: typeof body.icon === "string" && body.icon.trim() ? body.icon.trim().slice(0, 8) : "📅",
      created_by: userId,
    })
    .select("id, title, date, recurring, icon")
    .single();
  if (e) return NextResponse.json({ error: e.message }, { status: 400 });
  return NextResponse.json({ occasion: data });
}

export async function DELETE(request: NextRequest) {
  const { error, supabase } = await requireAdmin();
  if (error) return error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error: e } = await supabase!.from("occasions").delete().eq("id", id);
  if (e) return NextResponse.json({ error: e.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
