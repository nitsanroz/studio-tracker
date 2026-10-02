import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/app-origin";

/** The signed-in ADMIN's id, or the response to send instead. Role re-read server-side. */
export async function requireAdmin(): Promise<{ userId: string } | { response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { response: NextResponse.json({ error: "Admins only" }, { status: 403 }) };
  return { userId: user.id };
}

/**
 * Where Google sends the browser back to. ⚠️ From an ALLOWLIST, never the raw
 * Host header — it must equal a redirect URI registered on the OAuth client
 * anyway, and a forged Host must not be able to bounce a code elsewhere.
 */
export function callbackUrl(req: NextRequest): string {
  const origin = req.nextUrl.origin;
  const allowed = new Set([appOrigin(), "http://localhost:3000"]);
  return `${allowed.has(origin) ? origin : appOrigin()}/api/gmail/callback`;
}
