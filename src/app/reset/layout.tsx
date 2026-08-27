/**
 * ⚠️ Same reason as `login/layout.tsx`, which carries the full explanation: the
 * nonce-based CSP in `src/proxy.ts` blocks the scripts of any PRERENDERED page,
 * and `/reset` and `/reset/update` were both `○` in the build output.
 *
 * ⚠️ This one covers BOTH, because segment config applies to child segments —
 * `/reset/update` needs no layout of its own. It is the page somebody lands on
 * from a password link, so a dead form there is an account nobody can recover.
 */
export const dynamic = "force-dynamic";

export default function ResetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
