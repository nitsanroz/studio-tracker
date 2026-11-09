import type { NextRequest } from "next/server";
import { appOrigin } from "@/lib/app-origin";

/** Moved to `@/lib/api-auth` (2026-11-09); re-exported for the gmail routes. */
export { requireAdmin } from "@/lib/api-auth";

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
