import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ownerOnly } from "@/lib/finance/advice/owner";
import { authUrl, mailConfigured } from "@/lib/finance/mail/google";
import { STATE_COOKIE, callbackUrl } from "@/lib/finance/mail/routes";

/**
 * Connect a mailbox for &advice's billing-mail scan (v1.12.0), owner only:
 * off to Google's consent screen (read-only scope), with `?hint=` as the
 * suggested account. The random state goes in an httpOnly cookie and must come
 * back on the callback.
 */
export async function GET(req: NextRequest) {
  const auth = await ownerOnly();
  if ("res" in auth) return auth.res;
  if (!mailConfigured()) return NextResponse.redirect(new URL("/finance/settings?mail=not-configured", req.url));
  const state = randomBytes(24).toString("base64url");
  const hint = req.nextUrl.searchParams.get("hint") ?? undefined;
  const res = NextResponse.redirect(authUrl(callbackUrl(req), state, hint && /@studionmore\.com$/i.test(hint) ? hint : undefined));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/finance/mail", maxAge: 600 });
  return res;
}
