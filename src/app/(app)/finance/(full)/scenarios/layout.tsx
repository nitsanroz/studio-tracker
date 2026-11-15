import { getAccess } from "@/lib/access-server";
import { LangProvider } from "@/components/finance/scenarios/lang";
import { CompanyFiguresProvider } from "@/components/finance/company-figures";
import { DEFAULT_FACTS, FACT_SOURCE } from "@/lib/finance/scenarios/facts";
import { NICKNAMES } from "@/lib/finance/scenarios/nicknames";

/**
 * Scenarios is the OWNER's alone (Nitsan, 2026-11-11: "exposed only to me and
 * not to Michal") — not every full-finance user. The sidebar hides the link,
 * this guard keeps the page itself shut, and RLS on its tables
 * (is_finance_owner()) is the real boundary. Michal never gets this far: the
 * `(full)` layout above sends an admin without full finance to Expenses.
 *
 * The company facts the page starts from (cash, the shareholder loan, retained
 * earnings) are handed down from here, after the check — a non-owner's page
 * never contains them.
 */
export default async function ScenariosLayout({ children }: { children: React.ReactNode }) {
  const { tier } = await getAccess();
  if (tier !== "owner") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-sm rounded-2xl border border-border bg-surface p-8 text-center">
          <p className="font-medium">Owner only</p>
          <p className="mt-1 text-sm text-muted">This page is for the studio’s owner.</p>
        </div>
      </div>
    );
  }
  // English or Hebrew, chosen on the page (components/scenarios/lang.tsx).
  return (
    <CompanyFiguresProvider value={{ defaultFacts: DEFAULT_FACTS, factSource: FACT_SOURCE, nicknames: NICKNAMES }}>
      <LangProvider>{children}</LangProvider>
    </CompanyFiguresProvider>
  );
}
