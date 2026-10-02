import { after, NextResponse, type NextRequest } from "next/server";
import { encryptToken } from "@/lib/gmail/crypto";
import { exchangeCode, getProfile, GMAIL_SCOPE, revokeToken, watch } from "@/lib/gmail/google";
import { callbackUrl, requireAdmin } from "@/lib/gmail/auth";
import { backfillOpenLeads, service } from "@/lib/gmail/sync";

export const maxDuration = 60;

/**
 * Google sends the admin back here with a code. We swap it for a refresh
 * token, store it ENCRYPTED against the signed-in admin, start the push watch,
 * and — after answering — search the mailbox for every open lead's history.
 *
 * ⚠️ THE MAILBOX MUST BE A @studionmore.com ONE. The consent screen is
 * Internal, so Google already refuses outside accounts; this is the same rule
 * stated where the row is written.
 */
export async function GET(req: NextRequest) {
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/settings?gmail=${q}`, req.nextUrl.origin));
    res.cookies.delete({ name: "gmail_oauth_state", path: "/api/gmail" });
    return res;
  };
  const who = await requireAdmin();
  if ("response" in who) return who.response;

  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  if (req.nextUrl.searchParams.get("error")) return back("cancelled");
  if (!state || state !== req.cookies.get("gmail_oauth_state")?.value || !code) return back("bad-state");

  try {
    const tok = await exchangeCode(code, callbackUrl(req));
    if (!tok.scope.split(" ").includes(GMAIL_SCOPE)) return back("no-scope");
    if (!tok.refreshToken) return back("no-refresh-token");
    const profile = await getProfile(tok.accessToken);
    if (!/@studionmore\.com$/i.test(profile.emailAddress)) {
      await revokeToken(tok.refreshToken);
      return back("wrong-domain");
    }
    const w = await watch(tok.accessToken);
    const sb = service();
    const { error } = await sb.from("gmail_accounts").upsert(
      {
        profile_id: who.userId,
        email: profile.emailAddress.toLowerCase(),
        refresh_token_enc: encryptToken(tok.refreshToken),
        history_id: w.historyId ?? profile.historyId,
        watch_expires_at: new Date(Number(w.expiration)).toISOString(),
        status: "ok",
        last_error: null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "profile_id" },
    );
    if (error) throw new Error(error.message);
    after(async () => {
      try {
        await backfillOpenLeads(sb);
      } catch (e) {
        console.error("[gmail] backfill after connect failed", e);
      }
    });
    return back("connected");
  } catch (e) {
    console.error("[gmail] connect failed", e);
    return back("failed");
  }
}
