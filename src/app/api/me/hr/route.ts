import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in member's own HR details, for the first-sign-in "confirm your
 * details" step and later edits from Settings.
 *
 * member_hr stays admin-only at the RLS level because it holds sensitive PII
 * (national ID, address), so this route uses the service key behind a session
 * check and whitelists columns to a member's own record. Admins editing
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

/**
 * Per-field limits. Everything here is the member's own record, so the risk is
 * low — but `String(v)` with no bound let a caller push an unbounded blob into
 * a PII table and store junk in a field the admin UI renders as fact.
 * `max` caps length; `pattern`, where present, rejects the obviously wrong
 * shape. Anything not listed falls back to FALLBACK_MAX.
 */
const FALLBACK_MAX = 120;
const LIMITS: Partial<Record<(typeof FIELDS)[number], { max: number; pattern?: RegExp }>> = {
  national_id: { max: 20, pattern: /^[0-9A-Za-z\-/ ]+$/ },
  birth_date: { max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  personal_email: { max: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  phone: { max: 32, pattern: /^[0-9+()\-. ]+$/ },
  emergency_contact_phone: { max: 32, pattern: /^[0-9+()\-. ]+$/ },
  zip: { max: 12, pattern: /^[0-9A-Za-z\- ]+$/ },
  street: { max: 160 },
  city: { max: 80 },
};

/** Human field name for an error message, e.g. personal_email → "personal email". */
function label(field: string) {
  return field.replace(/_/g, " ");
}

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
  if (error) {
    console.error("me/hr read failed", error);
    return NextResponse.json({ error: "Could not load your details" }, { status: 400 });
  }

  return NextResponse.json({ details: data ?? null });
}

export async function PATCH(request: NextRequest) {
  const userId = await me();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // whitelist — anything not in FIELDS is dropped
  const patch: Record<string, string | null> = {};
  for (const f of FIELDS) {
    if (f in body) {
      const v = body[f];
      if (v === "" || v == null) {
        patch[f] = null;
        continue;
      }
      const value = String(v).trim();
      const rule = LIMITS[f];
      if (value.length > (rule?.max ?? FALLBACK_MAX)) {
        return NextResponse.json({ error: `Your ${label(f)} is too long` }, { status: 400 });
      }
      if (rule?.pattern && !rule.pattern.test(value)) {
        return NextResponse.json({ error: `That doesn't look like a valid ${label(f)}` }, { status: 400 });
      }
      patch[f] = value;
    }
  }
  if (body.confirm === true) patch.confirmed_at = new Date().toISOString();

  const { error } = await service()
    .from("member_hr")
    .upsert({ profile_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "profile_id" });
  if (error) {
    // Never echo the Postgres message: it names columns and constraints.
    console.error("me/hr upsert failed", error);
    return NextResponse.json({ error: "Could not save your details" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
