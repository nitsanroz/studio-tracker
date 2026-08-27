import type { NextConfig } from "next";

/**
 * ⚠️ THESE ARE THE HEADERS THAT DO NOT NEED A NONCE, AND THEY LIVE HERE RATHER
 * THAN IN `src/proxy.ts` ON PURPOSE: `headers()` covers **static assets and API
 * routes as well**, which the proxy's matcher deliberately skips, and it costs no
 * function invocation. The Content-Security-Policy is the one header that must be
 * per-request, because its nonce is — see `src/proxy.ts`.
 *
 * Closes the last open item from the v1.32.2 security review ("No CSP or security
 * headers — next.config.ts sets only devIndicators").
 */
const SECURITY_HEADERS = [
  // Stops a browser second-guessing a Content-Type. This is the header that turns
  // the upload allow-list into a real defence: v1.0.1 forces a safe type on every
  // stored file, and sniffing is how a "text/plain" upload gets run as HTML anyway.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // ⚠️ Belt to `frame-ancestors 'none'` in the CSP, kept for older browsers that
  // honour this and not that. If the app ever needs to be embedded, BOTH change.
  { key: "X-Frame-Options", value: "DENY" },
  // Send the full URL within our own origin, only the origin off-site. Report and
  // intake URLs carry an unguessable TOKEN in the path — leaking that in a
  // Referer to a client's own outbound link would hand over the whole report.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing in this app uses a camera, a microphone or a location.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // ⚠️ HSTS is 2 years with subdomains and preload-eligible. Vercel already
  // serves HTTPS everywhere and redirects; this makes a downgrade unattemptable
  // rather than merely unused.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // The floating dev-tools bubble overlaps the sidebar user card
  devIndicators: false,
  // Don't advertise the framework and its version to a scanner.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
