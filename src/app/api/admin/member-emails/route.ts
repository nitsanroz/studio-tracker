import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Admin-only: { [profileId]: email } for every member.
//
// `profiles` has no email column — the address lives in auth.users, which only
// the service role can read. Reading it here rather than denormalising a copy
// into profiles means the Team page always shows the address the member actually
// signs in with, and there's no second field to drift or keep in sync.

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // perPage is capped server-side; 200 covers the studio with room to spare.
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  const emails: Record<string, string> = {};
  for (const u of data.users) if (u.email) emails[u.id] = u.email;
  return NextResponse.json({ emails });
}
