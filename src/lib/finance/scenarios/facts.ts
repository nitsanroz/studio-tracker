// Company facts the finance app doesn't hold — the balance sheet, the
// shareholder loan, tax constants. Prefilled from the accountant's signed 2025
// report and Nitsan's call with him (Yanir, Farkash & Co, report dated
// 2 Nov 2026; call 11 Nov 2026), each with its source, and editable on the
// page (finance_scenario_settings, reference/0023). Labelled estimates — the
// page always says "confirm with the accountant"; the full dividend-vs-salary
// calculator lives in finance360, not here.
//
// ⚠️ Never put the owner's personal (non-company) income here or in any
// scenario — Nitsan's call, 2026-11-11.

// ⚠️ SERVER ONLY — amounts. The owner’s Scenarios page gets these as props from
// its layout (useCompanyFigures()); the rules that carry no figure of ours are in
// facts-shared.ts.
import type { CompanyFacts } from "./types";

export const DEFAULT_FACTS: CompanyFacts = {
  cashToday: 342_701,
  cashAsOf: "2025-12-31",
  loan: 182_346,
  loanAsOf: "2025-12-31",
  loanInterest: 0.06,
  retained: 454_515,
  leaseholdLeft: 54_000,
  equipmentBook: 51_500,
  taxRefund: 17_000,
  taxRefundMonth: "2026-12",
  corporateTax: 0.23,
  dividendTax: 0.3,
  netShare: 0.7,
  bracketTop: 25_000,
  cashFloor: null,
  takeHomeFloor: null,
};

export const FACT_SOURCE: Partial<Record<keyof CompanyFacts, string>> = {
  cashToday: "Accountant's 2025 report: cash at 31 Dec 2025. Update it with today's bank balance.",
  loan: "2025 report: the owner owed the company ₪182,346 at 31 Dec 2025. 2026 withdrawals above salary are not in it.",
  loanInterest: "Accountant (call, Nov 2026): about 6% a year, added to the loan; not a deductible expense.",
  retained: "2025 report: retained earnings ₪454,515. The Arrangements Law forces distribution above ₪750K.",
  leaseholdLeft: "2025 report: ~₪54.8K of leasehold improvements left at the end of 2025, less 2026's depreciation. Written off in full the day the studio is left — a P&L cost, no cash.",
  equipmentBook: "2025 report: equipment ~₪51.5K on the books at the end of 2025 (less 2026 depreciation). Sold = an invoice; below book value is a loss.",
  taxRefund: "Accountant (call): a company tax refund of about ₪17K, expected within a month.",
  corporateTax: "Company tax 23%.",
  dividendTax: "Dividend tax 30% for a controlling shareholder — about 46% in all with company tax.",
  netShare: "Net salary ÷ gross, roughly. A labelled estimate — the payslip has the real figure.",
  bracketTop: "Accountant: salary is cheaper than dividend up to about ₪25K a month (the 35% bracket); above it they're nearly equal. You're pension-insured on ₪15K only.",
  cashFloor: "The least the company should hold. Empty = two months of today's costs.",
  takeHomeFloor: "The least you need at home a month, net. Every scenario is checked against it.",
};
