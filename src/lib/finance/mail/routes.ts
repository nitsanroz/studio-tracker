import type { NextRequest } from "next/server";

/** The state cookie that ties Google's callback to the owner who clicked Connect. */
export const STATE_COOKIE = "finance_mail_state";

/**
 * Where Google sends the browser back to. ⚠️ From an ALLOWLIST, never the raw
 * Host header — each must be a redirect URI registered on the OAuth client.
 */
export function callbackUrl(req: NextRequest): string {
  const prod = "https://tracker.studionmore.com";
  const allowed = new Set([prod, "http://localhost:3000"]);
  const origin = req.nextUrl.origin;
  return `${allowed.has(origin) ? origin : prod}/api/finance/mail/callback`;
}
