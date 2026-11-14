import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access-server";
import { atLeast } from "@/lib/access";
import { ACCOUNTANT_YEARS } from "@/lib/finance/accountant-years";
import { HOURLY_TERMS } from "@/lib/finance/hourly-terms";
import { CompanyFiguresProvider } from "@/components/finance/company-figures";

/**
 * Every finance page except Expenses: full finance access only. `(full)` is a
 * route group — it adds nothing to the URL. An admin without the flag is sent
 * to the one finance page they have, as the finance app's proxy used to do.
 *
 * The accountant's figures and the hourly freelancer's rate are handed down from here, after the check, rather
 * than imported by the pages — see components/finance/company-figures.tsx.
 */
export default async function FullFinanceLayout({ children }: { children: React.ReactNode }) {
  const { tier } = await getAccess();
  if (!atLeast(tier, "finance")) redirect("/finance/expenses");
  return <CompanyFiguresProvider value={{ accountantYears: ACCOUNTANT_YEARS, hourlyTerms: HOURLY_TERMS }}>{children}</CompanyFiguresProvider>;
}
