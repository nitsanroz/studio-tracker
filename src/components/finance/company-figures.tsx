"use client";

import { createContext, useContext, useMemo } from "react";
import type { AccountantYear } from "@/lib/finance/accountant";
import type { CompanyFacts } from "@/lib/finance/scenarios/types";
import type { RateTerms } from "@/lib/finance/freelance-rate";

/**
 * The company's own figures that used to be constants in client code — the
 * accountant's yearly statements, and the balance-sheet facts Scenarios starts
 * from. As constants they sat in a JavaScript file any signed-in member could
 * download. Now a SERVER layout reads them after checking the viewer's tier and
 * hands them down here as props, so they travel only in the page of someone
 * allowed to see them:
 *
 *   accountantYears,
 *   hourlyTerms       `(full)/layout.tsx`       — full finance
 *   defaultFacts,
 *   factSource        `scenarios/layout.tsx`    — the owner
 *
 * The files holding the figures (lib/finance/accountant-years.ts and
 * scenarios/facts.ts) must never be imported by client code:
 * finance-leak-guard.test.ts fails if they are.
 */
export interface CompanyFigures {
  accountantYears: AccountantYear[];
  /** Hourly freelancers' sliding ₪ rates, by profile id (lib/finance/hourly-terms.ts). */
  hourlyTerms: Record<string, RateTerms>;
  defaultFacts: CompanyFacts | null;
  factSource: Partial<Record<keyof CompanyFacts, string>>;
}

const EMPTY: CompanyFigures = { accountantYears: [], hourlyTerms: {}, defaultFacts: null, factSource: {} };
const Ctx = createContext<CompanyFigures>(EMPTY);

/** Adds to whatever a layout above already provided. */
export function CompanyFiguresProvider({ value, children }: { value: Partial<CompanyFigures>; children: React.ReactNode }) {
  const above = useContext(Ctx);
  const merged = useMemo(() => ({ ...above, ...value }), [above, value]);
  return <Ctx.Provider value={merged}>{children}</Ctx.Provider>;
}

export const useCompanyFigures = (): CompanyFigures => useContext(Ctx);

/** Scenarios' starting facts. Only the owner's layout provides them. */
export function useDefaultFacts(): CompanyFacts {
  const { defaultFacts } = useContext(Ctx);
  if (!defaultFacts) throw new Error("Company facts are provided by the Scenarios layout, to the owner only.");
  return defaultFacts;
}
