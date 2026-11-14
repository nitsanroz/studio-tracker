import { NextResponse, type NextRequest } from "next/server";
import { ownerOnly } from "@/lib/finance/advice/owner";
import { mailConfigured } from "@/lib/finance/mail/google";
import { ACCOUNTS, mailAccounts } from "@/lib/finance/mail/scan";

/** Settings' list of mailboxes (v1.12.0), owner only — never a token. 503 before reference/0015. */
export async function GET() {
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  const accounts = await mailAccounts(auth.sb);
  if (!accounts) return NextResponse.json({ error: "A table is missing — has reference/0015_finance_mail.sql been run?" }, { status: 503 });
  return NextResponse.json({ configured: mailConfigured(), accounts });
}

/**
 * Disconnect `?email=`: the stored key is deleted, so finance can't read that
 * mailbox any more. What was read stays.
 *
 * ⚠️ Google is NOT asked to revoke (Nitsan, 2026-11-10). Finance signs in with
 * the TRACKER's Google client, and revoking a token drops that user's whole grant
 * to the client — so disconnecting nitsan@ here would silently stop the tracker's
 * Leads mail sync for nitsan@ too. To withdraw the access itself, remove the app
 * at myaccount.google.com → Security → Third-party access.
 */
export async function DELETE(req: NextRequest) {
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  const email = req.nextUrl.searchParams.get("email")?.toLowerCase();
  if (!email) return NextResponse.json({ error: "Which mailbox?" }, { status: 400 });
  const del = await auth.sb.from(ACCOUNTS).delete().eq("email", email);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
