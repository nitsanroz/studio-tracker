import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { service } from "@/lib/supabase/service";

/**
 * &advice is the OWNER's alone. Asked of the database's own `is_owner()` (0059 —
 * `role = 'admin' and position = 'owner'`, the vacation approver's test), so the
 * rule lives in one place. Not every admin: Michal is one and must not see it.
 *
 * Returns the service client when the caller is the owner, else the response
 * to send. The service key is fine past this point because the routes read
 * only advice and aggregate figures, and the check has been made here.
 */
export async function ownerOnly(): Promise<{ sb: SupabaseClient } | { res: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { res: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const { data: isOwner } = await supabase.rpc("is_owner");
  if (isOwner !== true) return { res: NextResponse.json({ error: "Owner only" }, { status: 403 }) };
  return { sb: service() };
}
