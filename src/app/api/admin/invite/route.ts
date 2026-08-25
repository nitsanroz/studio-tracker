import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/app-origin";

// Admin-only: send a member their "set your password" link.
//
// Why this exists instead of supabase.auth.resetPasswordForEmail():
//   • resetPasswordForEmail() from the browser uses the PKCE flow, which stores
//     a code_verifier in the *calling* browser. An admin-sent link therefore only
//     worked if the member opened it in the admin's own browser — otherwise
//     /auth/confirm couldn't exchange the code and bounced them to /reset.
//   • Supabase's built-in auth mailer is capped at ~2 emails/hour, which makes
//     onboarding a team impossible.
// generateLink() mints the token server-side WITHOUT sending anything, so we mail
// it ourselves through Resend (already verified for studionmore.com) and hand the
// member a `token_hash` link. /auth/confirm redeems that with verifyOtp(), which
// carries no browser state and works on any device.

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { profileId, email: emailArg } = await request.json();
  if (!profileId && !emailArg) {
    return NextResponse.json({ error: "profileId or email is required" }, { status: 400 });
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // Prefer resolving the address from auth.users — `profiles` doesn't store it,
  // so asking the admin to retype it was a chance to mistype it.
  let email = emailArg as string | undefined;
  if (profileId) {
    const { data, error } = await admin.auth.admin.getUserById(profileId);
    if (error || !data.user?.email) {
      return NextResponse.json({ error: "No account found for that member." }, { status: 404 });
    }
    email = data.user.email;
  }

  // Admin-gated, so the Host header here is far less reachable than on the
  // intake route — but this builds a PASSWORD-SET link, which is the last URL
  // that should be host-controlled. Same fixed origin, same reasoning.
  const origin = appOrigin();
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: email!,
    options: { redirectTo: `${origin}/auth/confirm?next=/reset/update` },
  });
  if (linkErr || !link.properties?.hashed_token) {
    return NextResponse.json(
      { error: linkErr?.message ?? "Could not generate a link." },
      { status: 400 },
    );
  }

  const url = `${origin}/auth/confirm?token_hash=${link.properties.hashed_token}&type=recovery&next=/reset/update`;

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "RESEND_API_KEY is not set on this environment." }, { status: 500 });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.INTAKE_FROM_EMAIL || "Studio&more Tracker <onboarding@resend.dev>",
      to: [email],
      subject: "Set your password — Studio&more Tracker",
      html: `<div style="font-family:Helvetica,Arial,sans-serif;color:#06112f;line-height:1.5">
  <h2 style="color:#06112f">Welcome to the Studio&amp;more Tracker</h2>
  <p>Click below to choose your password. The link works once, on any device, and expires in 24 hours.</p>
  <p style="margin:28px 0">
    <a href="${url}" style="background:#0b43ed;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Set your password</a>
  </p>
  <p style="font-size:13px;color:#5b6484">If the button doesn't work, paste this into your browser:<br>
    <span style="word-break:break-all">${url}</span></p>
  <p style="font-size:13px;color:#5b6484">Didn't expect this? You can ignore the email — nothing changes until you set a password.</p>
</div>`,
    }),
  });

  if (!res.ok) {
    console.error("invite email failed", await res.text());
    return NextResponse.json({ error: "The link was created but the email failed to send." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, email });
}
