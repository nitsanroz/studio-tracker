import { NextResponse } from "next/server";
import { service } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/api-auth";

// Admin-only: { [profileId]: email } for every member.
//
// `profiles` has no email column — the address lives in auth.users, which only
// the service role can read. Reading it here rather than denormalising a copy
// into profiles means the Team page always shows the address the member actually
// signs in with, and there's no second field to drift or keep in sync.

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const admin = service();

  // perPage is capped server-side; 200 covers the studio with room to spare.
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  const emails: Record<string, string> = {};
  for (const u of data.users) if (u.email) emails[u.id] = u.email;
  return NextResponse.json({ emails });
}
