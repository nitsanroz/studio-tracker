import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in member's own HR details, for the first-sign-in "confirm your
 * details" step and later edits from Settings.
 *
 * member_hr stays admin-only at the RLS level because it holds salary, so this
 * route uses the service key behind a session check and whitelists columns:
 * SALARY IS NEVER READ OUT TO, OR WRITABLE BY, THE MEMBER. Admins editing
 * someone else's HR record still go through the admin UI, not this route.
 */

const FIELDS = [
  "national_id",
  "gender",
  "birth_date",
  "personal_email",
  "phone",
  "street",
  "house_no",
  "floor",
  "apartment",
  "city",
  "zip",
  "marital_status",
  "emergency_contact_name",
  "emergency_contact_phone",
] as const;

async function me() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function GET() {
  const userId = await me();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data, error } = await service()
    .from("member_hr")
    .select([...FIELDS, "confirmed_at"].join(", "))
    .eq("profile_id", userId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ details: data ?? null });
}

export async function PATCH(request: NextRequest) {
  const userId = await me();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // whitelist — anything not in FIELDS (notably salary) is dropped
  const patch: Record<string, string | null> = {};
  for (const f of FIELDS) {
    if (f in body) {
      const v = body[f];
      patch[f] = v === "" || v == null ? null : String(v);
    }
  }
  if (body.confirm === true) patch.confirmed_at = new Date().toISOString();

  const { error } = await service()
    .from("member_hr")
    .upsert({ profile_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "profile_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
