import { NextResponse, type NextRequest } from "next/server";
import { policy } from "@/lib/csp";

/**
 * Per-request Content Security Policy with a nonce.
 *
 * ⚠️⚠️ THE FILE IS `proxy.ts`, NOT `middleware.ts`. This Next version renamed it,
 * and training data says otherwise — see
 * `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`.
 * ⚠️ This is the app's FIRST request-level hook. It sets headers and nothing else:
 * auth stays where it is (`(app)/layout.tsx`), because moving an access decision
 * into a file that runs on every request is a much bigger change than the header
 * it would ride along with.
 *
 * ⚠️ WHY A NONCE IS AFFORDABLE HERE, since the docs warn it forces dynamic
 * rendering: measured against the real build, **35 of 39 routes were already
 * dynamic**. The only prerendered pages were `/login`, `/reset`, `/reset/update`
 * and `/_not-found`, and the three real ones now call `connection()` to opt in.
 * ⚠️ IF A NEW PAGE IS PRERENDERED, ITS SCRIPTS WILL BE BLOCKED — Next can only
 * stamp the nonce while server-rendering a request, so a static page emits
 * unnonced inline scripts that this policy then refuses, and the page loads as
 * dead HTML. **Check `npm run build` for `○` and add `await connection()`.**
 */

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = policy(nonce, process.env.NODE_ENV === "development");

  // ⚠️ The nonce has to reach the RENDERER, and it does so on the request
  // headers: Next parses `Content-Security-Policy` off the request and stamps
  // the value it finds onto its own script tags. Setting it only on the response
  // would ship a policy whose nonce nothing matches — a blank page.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // ⚠️ API routes are excluded: they return JSON, so a CSP buys nothing, and
      // running this on `/api/file`'s redirect would add work to every avatar.
      // Static assets and the image optimiser are excluded for the same reason.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      // Prefetches from next/link are skipped per the Next docs — a prefetched
      // document is not rendered, so a nonce minted for it is wasted.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
