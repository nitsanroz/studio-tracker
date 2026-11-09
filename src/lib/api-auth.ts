import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

type SessionClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The signed-in ADMIN, or the response to send instead — 401 "Not signed in",
 * 403 "Admins only". The role is re-read from `profiles` on every request, never
 * trusted from the client.
 *
 * ONE copy of the check that ~10 routes had written out by hand (2026-11-09).
 * Returns the session client and the user too: a route may go on to read with
 * the caller's own RLS, or use their email (the intake receipt's reply-to).
 *
 * ⚠️ Not for routes that must answer a non-admin with 404 instead of 403 (the
 * candidate-file / lead-file GETs, so a member can't learn a file exists) —
 * those keep their own check.
 */
export async function requireAdmin(): Promise<
  { userId: string; user: User; supabase: SessionClient } | { response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { response: NextResponse.json({ error: "Admins only" }, { status: 403 }) };
  return { userId: user.id, user, supabase };
}
