/**
 * Builds the app's Content-Security-Policy string.
 *
 * ⚠️ THIS LIVES IN `src/lib` SO IT CAN BE TESTED. `src/proxy.ts` imports
 * `next/server`, which the node-environment vitest setup has no business loading;
 * keeping the policy a pure string function means `csp.test.ts` can assert the
 * dev/production difference directly. `proxy.ts` is the only caller.
 */

/** ⚠️ Read from env rather than hardcoded: the browser talks to Supabase for
 *  REST, auth, storage and realtime, and a wrong origin here is a dead app. */
const SUPABASE_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "";
  }
})();

export function policy(nonce: string, isDev: boolean): string {
  const supa = SUPABASE_ORIGIN;
  const wss = supa.replace(/^https:/, "wss:");
  return [
    `default-src 'self'`,
    // ⚠️ 'strict-dynamic' makes browsers IGNORE 'self' here: every script must
    // carry the nonce or be loaded by one that does. Next stamps its own
    // framework and chunk scripts automatically, and this app loads no
    // third-party script at all — no analytics, no tag manager, no CDN.
    // ⚠️ 'unsafe-eval' is DEV ONLY: React uses eval to rebuild server stacks for
    // better errors. Neither React nor Next needs it in production.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // ⚠️⚠️ STYLES GET 'unsafe-inline' AND DELIBERATELY NO NONCE. A nonce in
    // `style-src` does NOT cover inline `style="…"` ATTRIBUTES — those fall under
    // `style-src-attr`, which inherits from here — and adding a nonce would make
    // browsers ignore 'unsafe-inline' entirely. This app positions every Gantt
    // bar, timeline row and chart element with inline styles, so that combination
    // would blank the Timeline, the charts and the client's shared plan.
    `style-src 'self' 'unsafe-inline'`,
    // Supabase storage is needed because the PUBLIC report and Gantt pages render
    // a client's mark from a server-signed `/object/sign/` URL (v1.35.0), which is
    // on Supabase's origin rather than ours. `data:`/`blob:` cover generated art.
    `img-src 'self' data: blob:${supa ? ` ${supa}` : ""}`,
    `font-src 'self'`,
    // wss: is Supabase realtime. Present even though realtime is unused today —
    // the client library opens it, and a blocked socket logs errors on every page.
    `connect-src 'self'${supa ? ` ${supa} ${wss}` : ""}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    // The intake form posts to our own API; nothing should be able to retarget it.
    `form-action 'self'`,
    // ⚠️ Nothing in this app is meant to be embedded, and the client report is a
    // page strangers open — framing it is how a convincing fake gets built.
    // ⚠️⚠️ OMITTED IN DEV ON PURPOSE, AND DO NOT "TIDY" THIS BACK TO AN
    // UNCONDITIONAL 'none'. Claude Code's preview pane renders localhost inside an
    // IFRAME, so 'none' makes the browser refuse to paint the app while the server
    // is answering in 27ms — which reads as "localhost:3000 is not responding" and
    // sent me chasing dev-server restarts and build dirs for two rounds on
    // 2026-08-27. Dev is a local origin nobody can reach; production keeps 'none'.
    isDev ? "" : `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ]
    .filter(Boolean)
    .join("; ");
}
