import { notFound } from "next/navigation";
import { getAccess } from "@/lib/access-server";
import { CompanyFiguresProvider } from "@/components/finance/company-figures";
import { ACCOUNTANT_YEARS } from "@/lib/finance/accountant-years";
import { HOURLY_TERMS } from "@/lib/hourly-terms";
import { DEFAULT_FACTS, FACT_SOURCE } from "@/lib/finance/scenarios/facts";
import { NICKNAMES } from "@/lib/finance/scenarios/nicknames";

/**
 * /advice is the OWNER's alone, like the pane it lays out in full: the page
 * shows amounts (what an hour sells for and costs), so not every admin — Michal
 * is one — and not every full-finance user. Anyone else gets a 404: they have
 * no reason to learn the page exists.
 *
 * This guard keeps the page shut; the data is shut separately — /api/advice
 * answers 403 to anyone but the owner, and the store's policy is
 * `is_finance_owner()`.
 */
export default async function AdviceLayout({ children }: { children: React.ReactNode }) {
  const { tier } = await getAccess();
  if (tier !== "owner") notFound();
  // Scenarios is a tab of this page (2026-11-16): the figures it starts from —
  // the company facts, the owner's nicknames for people, and what the
  // full-finance layout hands its pages — are given here, AFTER the owner check,
  // so no one else's page ever contains them (finance-leak-guard.test.ts).
  return (
    <CompanyFiguresProvider
      value={{ accountantYears: ACCOUNTANT_YEARS, hourlyTerms: HOURLY_TERMS, defaultFacts: DEFAULT_FACTS, factSource: FACT_SOURCE, nicknames: NICKNAMES }}
    >
      {children}
    </CompanyFiguresProvider>
  );
}
