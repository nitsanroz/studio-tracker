/**
 * The accountant's own figures per year (Yanir, Farkash & Co's audited
 * statements), kept apart from the studio's P&L and shown beside it on the
 * Overview — never fed into totals, plans or scenarios (Nitsan, 2026-11-11:
 * "what was won't be"; it's a secondary view, switchable).
 *
 * Why they differ from our P&L: the accountant books revenue by INVOICE, we
 * book by the month the work was done, so single years drift (2024 and 2025
 * differ by ±₪230–260K) while two years together agree within ~1%. He also
 * capitalises equipment and depreciates it, where our P&L expenses it.
 *
 * Source: the signed statements in finance360/raw/studio (2019–2020 from the
 * 5.7.2021 report, 2022–2023 from 11.7.2024, 2024–2025 from 2.11.2026).
 * 2021 is missing (no report in the mailbox). Add a year as each report
 * arrives. ILS, whole shekels.
 */
// ⚠️ SERVER ONLY — amounts. Client code reads these through useCompanyFigures()
// (components/finance/company-figures.tsx); the shape and sums are in accountant.ts.
import type { AccountantYear } from "./accountant";

export const ACCOUNTANT_YEARS: AccountantYear[] = [
  { year: 2019, revenue: 2_339_416, expenses: 2_013_568, operatingProfit: 325_848, pretaxProfit: 322_672, netProfit: 248_228, cash: 305_108, retained: 249_903 },
  { year: 2020, revenue: 2_069_222, expenses: 2_008_385, operatingProfit: 60_837, pretaxProfit: 82_859, netProfit: 60_588, cash: 372_473, retained: 310_491 },
  { year: 2022, revenue: 2_738_390, expenses: 2_497_617, operatingProfit: 240_773, pretaxProfit: 244_513, netProfit: 183_845, cash: 382_453, retained: 481_347 },
  // 2023: the pre-tax figure includes a ₪52,369 grant; ₪189,039 dividend was declared.
  { year: 2023, revenue: 2_801_841, expenses: 2_662_632, operatingProfit: 139_209, pretaxProfit: 204_088, netProfit: 154_232, cash: 367_282, retained: 446_540 },
  { year: 2024, revenue: 2_351_176, expenses: 2_339_557, operatingProfit: 11_619, pretaxProfit: 18_126, netProfit: 11_514, cash: 428_431, retained: 458_054 },
  { year: 2025, revenue: 2_619_037, expenses: 2_598_424, operatingProfit: 20_613, pretaxProfit: -2_287, netProfit: -3_539, cash: 342_701, retained: 454_515 },
];
