import { NextResponse, type NextRequest } from "next/server";
import { ownerOnly } from "@/lib/finance/advice/owner";
import { encryptToken } from "@/lib/finance/mail/crypto";
import { exchangeCode, getProfile, GMAIL_SCOPE } from "@/lib/finance/mail/google";
import { STATE_COOKIE, callbackUrl } from "@/lib/finance/mail/routes";
import { ACCOUNTS } from "@/lib/finance/mail/scan";

/**
 * Google's way back (v1.12.0). Checks the state cookie, swaps the code for a
 * refresh token, and keeps it encrypted. ⚠️ Only @studionmore.com mailboxes,
 * and only the read-only scope — anything else is refused and its token thrown
 * away, never stored. Not revoked at Google (2026-11-10): the client is the
 * tracker's, and a revoke drops the user's whole grant to it, the tracker's
 * own Gmail connection included.
 */
export async function GET(req: NextRequest) {
  const back = (result: string) => {
    const res = NextResponse.redirect(new URL(`/settings?tab=finance&mail=${result}`, req.url));
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/finance/mail" });
    return res;
  };
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  const p = req.nextUrl.searchParams;
  const state = req.cookies.get(STATE_COOKIE)?.value;
  if (p.get("error")) return back("declined");
  if (!state || state !== p.get("state") || !p.get("code")) return back("expired");
  try {
    const t = await exchangeCode(p.get("code")!, callbackUrl(req));
    if (!t.refreshToken) return back("no-token");
    if (t.scope.split(" ").some((s) => s !== GMAIL_SCOPE)) return back("wrong-scope");
    const { emailAddress } = await getProfile(t.accessToken);
    if (!/@studionmore\.com$/i.test(emailAddress)) return back("wrong-domain");
    const put = await auth.sb
      .from(ACCOUNTS)
      .upsert(
        { email: emailAddress.toLowerCase(), refresh_token_enc: encryptToken(t.refreshToken), status: "ok", last_error: null, connected_at: new Date().toISOString() },
        { onConflict: "email" },
      );
    if (put.error) return back(/does not exist|schema cache/i.test(put.error.message) ? "no-table" : "error");
    return back("connected");
  } catch {
    return back("error");
  }
}
