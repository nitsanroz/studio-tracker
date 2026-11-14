import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { tierOf } from "@/lib/access";

/**
 * &advice is the OWNER's alone: tracker role admin + position owner + full
 * finance — `tierOf() === "owner"`, the same test as the database's
 * `is_finance_owner()`, which guards the store itself. Not every admin (Michal
 * is one and must not see it), and not every full-finance user.
 *
 * Returns the caller's OWN Supabase client. Since the finance merge (stage 4)
 * the pane reads amounts, so nothing here touches the service key: every table
 * the checks read is readable by the owner under RLS, and anyone else is
 * stopped twice — here, and by the policies.
 */
export async function ownerOnly(): Promise<{ sb: SupabaseClient } | { res: NextResponse }> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { res: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const { data: p } = await sb.from("profiles").select("role, position, finance_full_access, active").eq("id", user.id).maybeSingle();
  if (!p || p.active === false || tierOf(p) !== "owner") return { res: NextResponse.json({ error: "Owner only" }, { status: 403 }) };
  return { sb };
}
