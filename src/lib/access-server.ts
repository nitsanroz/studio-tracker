import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isMissingSchema, DbError } from "@/lib/db";
import { atLeast, tierOf, type Tier } from "@/lib/access";

type SessionClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The signed-in viewer's tier, re-read from `profiles` on every request with
 * their own session — never trusted from the client, never under `?viewAs=`.
 *
 * Returns the SESSION client, not the service one: finance reads go through the
 * viewer's own RLS, so a wrong answer here still can't hand over a row the
 * database wouldn't. Nothing under `lib/finance` may reach for the service key
 * (`finance-leak-guard.test.ts`).
 */
export async function getAccess(): Promise<{ tier: Tier; user: User | null; supabase: SessionClient }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { tier: "member", user: null, supabase };
  const { data, error } = await supabase
    .from("profiles")
    .select("role, position, finance_full_access, active")
    .eq("id", user.id)
    .maybeSingle();
  // A database without the finance flag has no finance tier to give.
  if (error && !isMissingSchema(new DbError("profiles", error.message, error.code))) throw error;
  if (!data || data.active === false) return { tier: "member", user, supabase };
  return { tier: tierOf(data), user, supabase };
}

/**
 * For a finance API route: the caller at `min` or above, or the response to
 * send. A member is answered 404, not 403 — they have no reason to learn the
 * route exists.
 */
export async function requireTier(
  min: Exclude<Tier, "member">,
): Promise<{ tier: Tier; user: User; supabase: SessionClient } | { response: NextResponse }> {
  const { tier, user, supabase } = await getAccess();
  if (!user) return { response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (tier === "member") return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (!atLeast(tier, min)) return { response: NextResponse.json({ error: "No access" }, { status: 403 }) };
  return { tier, user, supabase };
}
