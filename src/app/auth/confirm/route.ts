import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

// Lands here from Supabase auth emails (password recovery, invites).
// Handles both PKCE (?code=) and token-hash (?token_hash=&type=) links,
// establishes a session cookie, then forwards to `next`.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  // ⚠️ A same-site PATH only. `${origin}${next}` with `next=@evil.com` (or `//`)
  // makes a URL whose host is the attacker's — an open redirect straight after a
  // valid sign-in link (found 2026-11-09).
  const asked = searchParams.get("next") ?? "/";
  const next = asked.startsWith("/") && !asked.startsWith("//") && !asked.startsWith("/\\") ? asked : "/";
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/reset?error=link`);
}
