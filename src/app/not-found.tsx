import Link from "next/link";
import { connection } from "next/server";

/**
 * The 404 page — and the reason it exists at all is the `connection()` call.
 *
 * ⚠️⚠️ WITHOUT IT, `/_not-found` IS PRERENDERED AND ITS SCRIPTS ARE BLOCKED BY OUR
 * OWN CSP. Next can only stamp the per-request nonce while server-rendering, so a
 * static page ships unnonced inline scripts, and `script-src`'s `'strict-dynamic'`
 * makes the browser ignore `'self'` and refuse them. Verified on production before
 * this file existed: the live 404 served **one script tag carrying no nonce**.
 * `src/proxy.ts` warns about exactly this — "IF A NEW PAGE IS PRERENDERED, ITS
 * SCRIPTS WILL BE BLOCKED … check `npm run build` for `○`".
 *
 * ⚠️ Next's default 404 had no links or buttons, so nothing a person could click
 * was broken — which is precisely why it survived unnoticed. It was a landmine,
 * not an outage: the moment this page gained the "back to the studio" link it now
 * has, that link would have been dead on a real 404 and fine in dev.
 *
 * ⚠️ `connection()` is the documented way to opt out of prerendering when a page
 * uses no request-time API of its own — see
 * `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md`.
 * `export const dynamic` is NOT usable here the way it is for `/login` and
 * `/reset`: those got a `layout.tsx` because their pages are `"use client"`, and
 * segment config on a client page is silently ignored. This file is a server
 * component, so the call belongs in it.
 *
 * ⚠️ Deliberately plain: no store access, no session read, no `useData`. A 404 is
 * reachable by strangers and by a signed-out person mistyping a URL, and it must
 * render when nothing else in the app can.
 */
export default async function NotFound() {
  await connection(); // prerendering stops here — see above
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center shadow-card">
        <p className="font-heading text-sm font-semibold text-muted">404</p>
        <h1 className="mt-1 font-heading text-lg text-foreground">This page does not exist</h1>
        <p className="mt-2 text-sm text-muted">
          The link may be out of date, or the page may have moved.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Back to the studio
        </Link>
      </div>
    </main>
  );
}
