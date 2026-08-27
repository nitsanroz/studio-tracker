/**
 * ⚠️⚠️ THIS LAYOUT EXISTS SOLELY TO STOP THE CSP KILLING THE LOGIN PAGE, and
 * deleting it takes the front door down with it.
 *
 * `src/proxy.ts` serves a nonce-based `script-src` with `'strict-dynamic'`, which
 * makes browsers ignore `'self'` — so every script must carry the nonce. Next can
 * only stamp that while server-rendering a REQUEST, and `/login` was PRERENDERED
 * (`○` in the build output), meaning its script tags are baked at build time with
 * no nonce and the browser refuses all of them. The form would still paint and
 * then do nothing at all: no typing, no submit, no way into the studio.
 *
 * ⚠️ It has to live in a SERVER file. `page.tsx` here is `"use client"`, and route
 * segment config is ignored in a client module — a `dynamic` export added there
 * would look right, change nothing, and the page would stay broken.
 *
 * The cost is one render per visit on a page that is one form.
 */
export const dynamic = "force-dynamic";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
