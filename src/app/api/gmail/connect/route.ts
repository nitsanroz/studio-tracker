import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authUrl, googleConfigured } from "@/lib/gmail/google";
import { callbackUrl, requireAdmin } from "@/lib/gmail/auth";

/**
 * Starts "Connect Gmail": sends the admin to Google's consent screen.
 *
 * ⚠️ THE `state` IS A ONE-TIME RANDOM VALUE IN AN httpOnly COOKIE, checked by
 * the callback. Without it anybody could send an admin a link that completes
 * an OAuth flow they started — attaching THEIR mailbox to the admin's account.
 */
export async function GET(req: NextRequest) {
  const who = await requireAdmin();
  if ("response" in who) return who.response;
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/settings?gmail=not-configured", req.nextUrl.origin));
  }
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl(callbackUrl(req), state));
  res.cookies.set("gmail_oauth_state", state, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/gmail",
    maxAge: 600,
  });
  return res;
}
