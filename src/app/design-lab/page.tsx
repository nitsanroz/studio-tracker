import { notFound } from "next/navigation";
import { DesignLab } from "./lab";

/**
 * A throwaway sandbox for the UI revamp: three design directions drawn over the
 * same fixture screens, switched from a floating bar. Nothing here reads the
 * database — every figure is a hard-coded fixture in `lab.tsx`.
 *
 * ⚠️ DEV ONLY. It lives outside `(app)`, so nothing gates it on a session; the
 * `notFound()` below is what keeps it off production (the /motion-preview route
 * was deleted for exactly this reason — "public by construction").
 *
 * `force-dynamic` because a prerendered page's scripts carry no CSP nonce and
 * the browser refuses them (see `src/app/login/layout.tsx`).
 */
export const dynamic = "force-dynamic";

export default function DesignLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DesignLab />;
}
