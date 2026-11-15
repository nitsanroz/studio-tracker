"use client";

import { atLeast, type Tier } from "@/lib/access";
import { NewClientsPrompt } from "@/components/finance/new-clients";

/**
 * What every finance page needs around it, inside the tracker's shell: the
 * new-clients prompt. (Discreet mode — PrivacyBlur — is mounted by AppShell for
 * the whole app.)
 *
 * It used to carry the finance pages' own row of links and the "Hide numbers"
 * switch. Both moved to the tracker's shell (Nitsan, 2026-11-15): the pages are
 * rows of the main menu under a "Finance" heading, or a view of the tracker page
 * they belong with (components/page-views.tsx), and Hide numbers sits beside the
 * bell for the whole app.
 */
export function FinanceShell({ tier, children }: { tier: Tier; children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* &advice is mounted once, by AppShell, for the whole app (the finance merge, stage 4). */}
      {atLeast(tier, "finance") && <NewClientsPrompt />}
    </>
  );
}
