import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAccess } from "@/lib/access-server";
import { atLeast } from "@/lib/access";
import { FinanceShell } from "@/components/finance/finance-shell";

const HOLD_BOOT =
  'try{if(localStorage.getItem("finance-privacy-hold")==="1")document.documentElement.dataset.privacy="pending"}catch(e){}';

// Decided per request from the viewer's own profile — never prerendered.
export const dynamic = "force-dynamic";

/**
 * The server gate for everything under /finance.
 *
 * A member gets the app's 404: they have no finance at all, and no reason to
 * learn which pages exist. An admin without full finance (Michal) gets past
 * here but only as far as Expenses — every other page sits under `(full)/`,
 * whose layout asks for the finance tier, and Scenarios asks for the owner.
 *
 * This is the app half. The database half is the finance tables' own RLS: the
 * pages read with the viewer's session, so nothing comes back that the
 * policies wouldn't give them, whatever this file does.
 */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const { tier } = await getAccess();
  if (!atLeast(tier, "admin")) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <div className="finance-canvas">
      {/* Hide numbers, on a reload: before the first paint, so not one amount
          shows while the page boots. "pending" hides EVERY digit until
          PrivacyBlur has marked the amounts and narrows it to "held". The key
          is PRIVACY_HOLD_KEY in lib/finance/privacy.ts. It carries the CSP
          nonce (src/proxy.ts), or the policy would refuse it. */}
      {/* As an HTML string, not a <script> element: it must run while the server's
          HTML is parsed, and never on a client-side render — where React refuses
          script elements and logs an error. PrivacyBlur covers that case itself. */}
      <span hidden suppressHydrationWarning dangerouslySetInnerHTML={{ __html: `<script${nonce ? ` nonce="${nonce}"` : ""}>${HOLD_BOOT}</script>` }} />
      <FinanceShell tier={tier}>{children}</FinanceShell>
    </div>
  );
}
