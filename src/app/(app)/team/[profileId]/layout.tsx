import { getAccess } from "@/lib/access-server";
import { atLeast } from "@/lib/access";
import { HOURLY_TERMS } from "@/lib/hourly-terms";
import { CompanyFiguresProvider } from "@/components/finance/company-figures";

// Decided per request from the viewer's own profile — never prerendered.
export const dynamic = "force-dynamic";

/**
 * A person's page carries their money tabs for full finance (Nitsan, 2026-11-15:
 * Profile and Pay & HR are one page). Those tabs need the hourly freelancers'
 * sliding rates, which must never sit in a file a member can download — so, as
 * under /finance, a SERVER layout hands them down after the tier check, and
 * anyone else's page never contains them (components/finance/company-figures.tsx).
 */
export default async function PersonLayout({ children }: { children: React.ReactNode }) {
  const { tier } = await getAccess();
  if (!atLeast(tier, "finance")) return children;
  return <CompanyFiguresProvider value={{ hourlyTerms: HOURLY_TERMS }}>{children}</CompanyFiguresProvider>;
}
